-- SPEC-010 §5 (AC-7, AC-9…AC-11, AC-17, AC-19…AC-21): przyznanie karnetu (prezent) — baza.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000010a1', 'grant-admin@example.test'),
  ('00000000-0000-0000-0000-0000000010b1', 'grant-staff@example.test'),
  ('00000000-0000-0000-0000-0000000010c1', 'obdarowany@example.test'),
  ('00000000-0000-0000-0000-0000000010c2', 'druga@example.test');
update public.profiles set role = 'admin', full_name = 'Ada Admin' where id = '00000000-0000-0000-0000-0000000010a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000010b1';

insert into public.products (id, kind, name, price, entries, is_active) values
  ('00000000-0000-0000-0000-0000000010f1', 'entries', 'Karnet 10 wejść G', 120000, 10, false),
  ('00000000-0000-0000-0000-0000000010f2', 'entries', 'Karnet 1 wejście G', 15000, 1, true);
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000010e0', 'Prezenty G');
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, ticket_price, capacity) values
  ('00000000-0000-0000-0000-0000000010e1', 'Zawody G', '00000000-0000-0000-0000-0000000010e0',
   public.range_today() + 3, public.range_today() + 4, 'published', 'paid', 5000, 1),
  ('00000000-0000-0000-0000-0000000010e2', 'Minione G', '00000000-0000-0000-0000-0000000010e0',
   public.range_today() - 10, null, 'published', 'paid', 5000, null),
  ('00000000-0000-0000-0000-0000000010e3', 'Szkic G', '00000000-0000-0000-0000-0000000010e0',
   public.range_today() + 3, null, 'draft', 'paid', 5000, null),
  ('00000000-0000-0000-0000-0000000010e4', 'Bezpłatne G', '00000000-0000-0000-0000-0000000010e0',
   public.range_today() + 3, null, 'published', 'free', null, null);

-- ===== Uprawnienia: tylko admin =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', public.range_today(), gen_random_uuid())$$, '42501', 'forbidden', 'AC-7: obsługa nie przyznaje karnetu');
select throws_ok($$select public.cancel_pass_grant(gen_random_uuid())$$, '42501', 'forbidden',
  'AC-19: obsługa nie anuluje przyznania');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', public.range_today(), gen_random_uuid())$$, '42501', 'forbidden', 'AC-7: klient nie przyznaje sobie karnetu');
reset role;

-- ===== AC-7: przyznanie produktu (także ukrytego) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
create temp table g1 as select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  '  Nagroda — zawody X  ', public.range_today() + 30, '00000000-0000-0000-0000-0000000010aa') as r;
reset role;

select is((select r ->> 'duplicate' from g1), 'false', 'AC-7: nowe przyznanie (duplicate = false)');
select ok((select r ->> 'order_number' from g1) ~ '^SV-[0-9]{4}-[0-9]{6,}$', 'AC-7: numer zamówienia SV-RRRR-NNNNNN');
select is(
  (select row(payment_method, amount, status, item_name, created_by, user_id, on_site_method, invoice_requested)::text
     from public.orders where id = (select (r ->> 'order_id')::uuid from g1)),
  row('gift', 0, 'paid', 'Karnet 10 wejść G', '00000000-0000-0000-0000-0000000010a1'::uuid,
      '00000000-0000-0000-0000-0000000010c1'::uuid, null::text, false)::text,
  'AC-7: zamówienie gift, 0 zł, opłacone, nazwa produktu, created_by = admin');
select ok((select paid_at is not null from public.orders where id = (select (r ->> 'order_id')::uuid from g1)),
  'AC-7: paid_at ustawione');
select is((select reason from public.order_grants where order_id = (select (r ->> 'order_id')::uuid from g1)),
  'Nagroda — zawody X', 'AC-7: powód (po obcięciu spacji) w order_grants');
select is(
  (select row(kind, entries_left, status, expires_on)::text from public.user_passes
     where order_id = (select (r ->> 'order_id')::uuid from g1)),
  row('entries', 10, 'active', public.range_today() + 30)::text,
  'AC-7: uprawnienie z wybraną datą „Ważny do”');
select is(
  (select changes ->> 'reason' from public.audit_log
     where action = 'pass_grant' and target_user_id = '00000000-0000-0000-0000-0000000010c1'
       and changes ->> 'order_id' = (select r ->> 'order_id' from g1)),
  'Nagroda — zawody X', 'AC-7: audit_log pass_grant z powodem');
select is(
  (select actor_id from public.audit_log where action = 'pass_grant' and changes ->> 'order_id' = (select r ->> 'order_id' from g1)),
  '00000000-0000-0000-0000-0000000010a1'::uuid, 'AC-7: audit_log — autor przyznania');
select is(
  (select changes ->> 'expires_on' from public.audit_log where action = 'pass_grant' and changes ->> 'order_id' = (select r ->> 'order_id' from g1)),
  (public.range_today() + 30)::text, 'AC-7: audit_log — expires_on');

-- ===== AC-9: idempotencja =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
create temp table g1b as select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda — zawody X', public.range_today() + 30, '00000000-0000-0000-0000-0000000010aa') as r;
reset role;
select is((select r ->> 'duplicate' from g1b), 'true', 'AC-9: ponowienie → duplicate = true');
select is((select r ->> 'order_id' from g1b), (select r ->> 'order_id' from g1), 'AC-9: ponowienie zwraca istniejące zamówienie');
select is((select count(*)::integer from public.orders where request_key = '00000000-0000-0000-0000-0000000010aa'), 1,
  'AC-9: tylko jedno zamówienie');
select is((select count(*)::integer from public.audit_log where action = 'pass_grant'
  and target_user_id = '00000000-0000-0000-0000-0000000010c1'), 1, 'AC-9: jeden wpis w dzienniku');

-- ===== Walidacja =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  '  ab  ', public.range_today(), gen_random_uuid())$$, '22023', 'invalid_grant_reason', 'AC-7: powód krótszy niż 3 znaki po trim');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  repeat('x', 301), public.range_today(), gen_random_uuid())$$, '22023', 'invalid_grant_reason', 'AC-7: powód dłuższy niż 300 znaków');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  null, public.range_today(), gen_random_uuid())$$, '22023', 'invalid_grant_reason', 'AC-7: brak powodu');
select lives_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c2', '00000000-0000-0000-0000-0000000010f2', null,
  'abc', public.range_today(), gen_random_uuid())$$, 'AC-7: „Ważny do” = dziś, powód 3 znaki — dozwolone');
select lives_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c2', '00000000-0000-0000-0000-0000000010f2', null,
  repeat('x', 300), (public.range_today() + interval '5 years')::date, gen_random_uuid())$$,
  'AC-7: „Ważny do” = dziś + 5 lat, powód 300 znaków — dozwolone');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', public.range_today() - 1, gen_random_uuid())$$, '22023', 'invalid_expires_on', 'AC-7: „Ważny do” w przeszłości');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', (public.range_today() + interval '5 years')::date + 1, gen_random_uuid())$$, '22023', 'invalid_expires_on',
  'AC-7: „Ważny do” dalej niż dziś + 5 lat');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', null, gen_random_uuid())$$, '22023', 'invalid_expires_on', 'AC-7: produkt bez „Ważny do”');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1',
  '00000000-0000-0000-0000-0000000010e1', 'Nagroda', public.range_today(), gen_random_uuid())$$, '22023', 'invalid_request',
  'AC-7: produkt i wydarzenie naraz');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', null, '00000000-0000-0000-0000-0000000010e1',
  'Nagroda', public.range_today(), gen_random_uuid())$$, '22023', 'invalid_request', 'AC-7: wejściówka z „Ważny do”');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', public.range_today(), null)$$, '22023', 'invalid_request', 'AC-9: brak request_key');
select throws_ok($$select public.grant_pass(gen_random_uuid(), '00000000-0000-0000-0000-0000000010f1', null,
  'Nagroda', public.range_today(), gen_random_uuid())$$, 'P0002', 'user_not_found', 'AC-7: osoba bez konta');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', gen_random_uuid(), null,
  'Nagroda', public.range_today(), gen_random_uuid())$$, 'P0002', 'product_not_found', 'AC-7: nieistniejący produkt');

-- ===== AC-11: wydarzenie niedostępne =====

select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', null, '00000000-0000-0000-0000-0000000010e2',
  'Nagroda', null, gen_random_uuid())$$, 'P0001', 'sales_closed', 'AC-11: wydarzenie zakończone');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', null, '00000000-0000-0000-0000-0000000010e3',
  'Nagroda', null, gen_random_uuid())$$, 'P0001', 'event_unavailable', 'AC-11: wydarzenie nieopublikowane');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c1', null, '00000000-0000-0000-0000-0000000010e4',
  'Nagroda', null, gen_random_uuid())$$, 'P0001', 'event_unavailable', 'AC-11: wydarzenie bezpłatne');

-- ===== AC-7, AC-10: wejściówka w limicie miejsc =====

create temp table g2 as select public.grant_pass('00000000-0000-0000-0000-0000000010c1', null, '00000000-0000-0000-0000-0000000010e1',
  'Nagroda za zawody', null, gen_random_uuid()) as r;
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c2', null, '00000000-0000-0000-0000-0000000010e1',
  'Nagroda', null, gen_random_uuid())$$, 'P0001', 'sold_out', 'AC-10: prezent wlicza się do limitu miejsc');
reset role;

select is(
  (select row(o.item_name, o.amount, o.payment_method, p.kind, p.valid_until)::text
     from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select (r ->> 'order_id')::uuid from g2)),
  row('Wejściówka: Zawody G', 0, 'gift', 'event_ticket', public.range_today() + 4)::text,
  'AC-7: wejściówka — nazwa jak przy zakupie, ważna do ostatniego dnia wydarzenia');
select is(public.event_seats_left('00000000-0000-0000-0000-0000000010e1'), 0, 'AC-10: wolne miejsca po prezencie = 0');

-- ===== AC-17: prezent bez faktury i bez anulowania ze zwrotem =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$select public.cancel_order(%L)$$, (select r ->> 'order_id' from g1)), 'P0001', 'order_is_gift',
  'AC-17: cancel_order odrzuca prezent');
select throws_ok(format($$select public.set_order_invoice_details(%L, '5260250995', 'Firma SA', 'ul. Długa 1, Warszawa', 'manual')$$,
  (select r ->> 'order_id' from g1)), 'P0001', 'invoice_not_available', 'AC-17: set_order_invoice_details odrzuca prezent');
reset role;
select throws_ok(format($$update public.orders set invoice_requested = true, invoice_nip = '5260250995',
  invoice_company_name = 'Firma SA', invoice_company_address = 'ul. Długa 1, Warszawa', invoice_data_source = 'manual'
  where id = %L$$, (select r ->> 'order_id' from g1)), '23514', null, 'AC-17: check orders_gift_no_invoice');
select throws_ok($$insert into public.orders (user_id, product_id, item_name, amount, payment_method)
  values ('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', 'X', 0, 'tpay')$$,
  '23514', null, 'check orders_gift_amount: kwota 0 tylko dla prezentu');
select throws_ok($$insert into public.orders (user_id, product_id, item_name, amount, payment_method)
  values ('00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f1', 'X', 100, 'gift')$$,
  '23514', null, 'check orders_gift_amount: prezent zawsze 0');

-- ===== RLS order_grants, admin_list_orders =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.order_grants), 0, 'RLS: klient nie widzi powodu przyznania');
select is((select count(*)::integer from public.orders where payment_method = 'gift'), 2, 'RLS: klient widzi własne zamówienia „Prezent”');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.order_grants), 0, 'RLS: obsługa nie widzi powodu przyznania');
select throws_ok($$insert into public.order_grants (order_id, reason) values (gen_random_uuid(), 'abc')$$, '42501', null,
  'RLS: brak zapisu do order_grants dla klientów');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.order_grants where order_id = (select (r ->> 'order_id')::uuid from g1)), 1,
  'RLS: admin widzi powód przyznania');
select is(
  (select row(payment_method, amount, grant_reason, grant_cancel_note, seller_name)::text
     from public.admin_list_orders(p_method => 'gift') where id = (select (r ->> 'order_id')::uuid from g1)),
  row('gift', 0, 'Nagroda — zawody X', null::text, 'Ada Admin')::text,
  'admin_list_orders: filtr gift, powód, kto przyznał');
select is((select count(*)::integer from public.admin_list_orders(p_method => 'gift') where item_name like '%G'), 4,
  'admin_list_orders: filtr metody gift');

-- ===== AC-19: anulowanie przyznania częściowo wykorzystanego karnetu =====

reset role;
update public.user_passes set entries_left = 7 where order_id = (select (r ->> 'order_id')::uuid from g1);
set local role authenticated;
select is(public.cancel_pass_grant((select (r ->> 'order_id')::uuid from g1), '  Pomyłka  '), 'cancelled',
  'AC-19: cancel_pass_grant zwraca cancelled');
reset role;
select is(
  (select row(o.status, o.cancelled_at is not null, o.refunded_at, p.status, p.entries_left)::text
     from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select (r ->> 'order_id')::uuid from g1)),
  row('cancelled', true, null::timestamptz, 'cancelled', 7)::text,
  'AC-19: zamówienie i uprawnienie anulowane mimo zużycia, licznik bez zmian, bez zwrotu');
select is((select cancel_note from public.order_grants where order_id = (select (r ->> 'order_id')::uuid from g1)), 'Pomyłka',
  'AC-19: notatka anulowania w order_grants');
select is(
  (select changes ->> 'note' from public.audit_log where action = 'pass_grant_cancel'
     and changes ->> 'order_id' = (select r ->> 'order_id' from g1)),
  'Pomyłka', 'AC-19: audit_log pass_grant_cancel');

-- ===== AC-20: anulowane uprawnienie niedostępne, miejsce zwolnione =====

select is((select count(*)::integer from public.passes_valid_on('00000000-0000-0000-0000-0000000010c1', public.range_today())
  where order_id = (select (r ->> 'order_id')::uuid from g1)), 0, 'AC-20: anulowany karnet nie jest ważny');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$select public.cancel_pass_grant(%L)$$, (select r ->> 'order_id' from g2)), 'AC-20: anulowanie wejściówki');
select lives_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000010c2', null, '00000000-0000-0000-0000-0000000010e1',
  'Nagroda', null, gen_random_uuid())$$, 'AC-20: anulowana wejściówka zwalnia miejsce w limicie');

-- AC-19: wykorzystany karnet (`used_up`) zostaje `used_up`, zamówienie → `cancelled`.
create temp table g3 as select public.grant_pass('00000000-0000-0000-0000-0000000010c2', '00000000-0000-0000-0000-0000000010f2', null,
  'Nagroda', public.range_today(), gen_random_uuid()) as r;
reset role;
update public.user_passes set entries_left = 0 where order_id = (select (r ->> 'order_id')::uuid from g3);
set local role authenticated;
select public.cancel_pass_grant((select (r ->> 'order_id')::uuid from g3));
select is(
  (select row(o.status, p.status)::text from public.orders o join public.user_passes p on p.order_id = o.id
     where o.id = (select (r ->> 'order_id')::uuid from g3)),
  row('cancelled', 'used_up')::text, 'AC-19: wykorzystany karnet zostaje used_up, zamówienie anulowane');

-- ===== AC-21 i inne błędy cancel_pass_grant =====

select throws_ok(format($$select public.cancel_pass_grant(%L)$$, (select r ->> 'order_id' from g1)), 'P0001', 'order_not_paid',
  'AC-21: ponowne anulowanie → order_not_paid');
select throws_ok($$select public.cancel_pass_grant(gen_random_uuid())$$, 'P0002', 'order_not_found', 'AC-19: brak zamówienia');
select throws_ok(format($$select public.cancel_pass_grant(%L, %L)$$, (select r ->> 'order_id' from g1), repeat('x', 301)),
  '22023', 'invalid_note', 'AC-19: notatka dłuższa niż 300 znaków');
reset role;
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, status, paid_at) values
  ('00000000-0000-0000-0000-0000000010d1', '00000000-0000-0000-0000-0000000010c1', '00000000-0000-0000-0000-0000000010f2',
   'Karnet 1 wejście G', 15000, 'tpay', 'paid', now());
set local role authenticated;
select throws_ok($$select public.cancel_pass_grant('00000000-0000-0000-0000-0000000010d1')$$, 'P0001', 'order_not_gift',
  'AC-19: zamówienie inne niż prezent');
reset role;

select * from finish();
rollback;
