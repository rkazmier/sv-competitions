-- SPEC-012 US-9 (AC-46…AC-50, AC-52): „Odstąp od umowy” w /konto/ — submit_withdrawal, my_withdrawals,
-- filtr „Zgłoszone odstąpienia”, „Zleć zwrot”, nieudany zwrot → zgłoszenie `new`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000041a1', 'request-admin@example.test'),
  ('00000000-0000-0000-0000-0000000041c1', 'request-client@example.test'),
  ('00000000-0000-0000-0000-0000000041c2', 'request-other@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000041a1';

insert into public.products (id, kind, name, price, entries, day_type) values
  ('00000000-0000-0000-0000-0000000041f1', 'entries', 'Karnet 3 wejść R', 10000, 3, null),
  ('00000000-0000-0000-0000-0000000041f2', 'single_entry', 'Wejście weekendowe R', 5000, null, 'weekend');

-- r1: ilościowy, 1 z 3 użyte, 3 dni temu; r2: wejście jednorazowe nieużyte, 14 dni temu; r3: ilościowy w całości użyty;
-- r4: ilościowy nieużyty, 15 dni temu (po oknie); r6: ilościowy na miejscu.
create temp table r (name text primary key, id uuid, product uuid, method text, days_ago integer);
insert into r values
  ('r1', '00000000-0000-0000-0000-0000000041d1', '00000000-0000-0000-0000-0000000041f1', 'tpay', 3),
  ('r2', '00000000-0000-0000-0000-0000000041d2', '00000000-0000-0000-0000-0000000041f2', 'tpay', 14),
  ('r3', '00000000-0000-0000-0000-0000000041d3', '00000000-0000-0000-0000-0000000041f1', 'tpay', 1),
  ('r4', '00000000-0000-0000-0000-0000000041d4', '00000000-0000-0000-0000-0000000041f1', 'tpay', 15),
  ('r6', '00000000-0000-0000-0000-0000000041d6', '00000000-0000-0000-0000-0000000041f1', 'on_site', 2);
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, on_site_method, tpay_title, created_at)
  select r.id, '00000000-0000-0000-0000-0000000041c1', r.product, p.name, p.price, r.method,
         case when r.method = 'on_site' then 'cash' end, case when r.method = 'tpay' then 'TR-' || r.name end,
         now() - interval '60 days'
  from r join public.products p on p.id = r.product;
create temp table fulfilled as select public.fulfil_order(id) from r;
update public.orders o set paid_at = ((public.range_today() - r.days_ago)::timestamp + time '12:00') at time zone 'Europe/Warsaw'
  from r where r.id = o.id;
update public.user_passes set entries_left = 2 where order_id = '00000000-0000-0000-0000-0000000041d1';
update public.user_passes set entries_left = 0 where order_id = '00000000-0000-0000-0000-0000000041d3';
delete from public.email_outbox where order_id in (select id from r);

-- ===== Brak bezpośredniego dostępu (§5 RLS) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000041c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.withdrawal_requests$$, '42501', null,
  '§5 RLS: klient nie czyta withdrawal_requests bezpośrednio');

-- ===== AC-46: my_withdrawals — dostępne odstąpienia =====

select is(
  (select array_agg(row(order_id, refund_amount, last_day, submitted_at)::text order by order_id) from public.my_withdrawals()),
  array[row('00000000-0000-0000-0000-0000000041d1'::uuid, 6667, public.range_today() + 11, null::timestamptz)::text,
        row('00000000-0000-0000-0000-0000000041d2'::uuid, 5000, public.range_today(), null::timestamptz)::text],
  'AC-46: tylko karnet ilościowy / wejście online w oknie ze zwrotem > 0 (bez sprzedaży na miejscu, po oknie, 0 zł)');

-- ===== AC-50: odrzucenia =====

select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d4')$$,
  'P0001', 'withdrawal_window_closed', 'AC-50: po oknie — withdrawal_window_closed');
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d3')$$,
  'P0001', 'withdrawal_nothing_to_refund', 'AC-18: usługa wykonana w całości');
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d6')$$,
  'P0001', 'withdrawal_not_available', 'AC-46: sprzedaż na miejscu odrzucana');
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d1', repeat('x', 501))$$,
  'P0001', 'invalid_comment', 'AC-47: uwagi do 500 znaków');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000041c2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d1')$$,
  'P0002', 'order_not_found', 'AC-48: tylko właściciel zamówienia');
select is((select count(*)::integer from public.my_withdrawals()), 0, 'AC-46: my_withdrawals — tylko własne zamówienia');
reset role;

set local role anon;
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d1')$$,
  '42501', null, 'AC-48: bez logowania — brak uprawnień');
reset role;

-- ===== AC-48: oświadczenie =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000041c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.submit_withdrawal('00000000-0000-0000-0000-0000000041d1', ' Przeprowadzka '), 6667,
  'AC-48: zwrot wyliczony na dziś (1 z 3 wejść)');
select throws_ok($$select public.submit_withdrawal('00000000-0000-0000-0000-0000000041d1')$$,
  'P0001', 'withdrawal_exists', 'AC-50: drugie zgłoszenie — withdrawal_exists');
select is(
  (select row(refund_amount, last_day, submitted_at is not null)::text from public.my_withdrawals()
    where order_id = '00000000-0000-0000-0000-0000000041d1'),
  row(6667, public.range_today() + 11, true)::text, 'AC-48: my_withdrawals pokazuje zgłoszenie z kwotą');
reset role;

select is(
  (select row(o.status, o.refund_amount, o.withdrawal_on, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000041d1'),
  row('paid', 6667, public.range_today(), 'cancelled')::text,
  'AC-48: zamówienie paid z refund_amount i withdrawal_on = dziś; uprawnienie z zużyciem → cancelled');
select is(
  (select row(user_id, comment, status, submitted_at is not null, processed_at)::text from public.withdrawal_requests
    where order_id = '00000000-0000-0000-0000-0000000041d1'),
  row('00000000-0000-0000-0000-0000000041c1'::uuid, 'Przeprowadzka', 'new', true, null::timestamptz)::text,
  'AC-48: wpis withdrawal_requests (new, submitted_at)');
select is(
  (select array_agg(kind || ':' || status order by kind) from public.email_outbox where order_id = '00000000-0000-0000-0000-0000000041d1'),
  array['withdrawal_admin:pending', 'withdrawal_received:pending'], 'AC-48: email_outbox withdrawal_received i withdrawal_admin');

-- AC-48: dane e-maila — adres tylko dla klienta, komentarz tylko w potwierdzeniu, bez danych osoby dla admina.
set local role service_role;
create temp table claimed as select * from public.mail_outbox_claim(100);
reset role;
select is(
  (select row(email, refund_amount, withdrawal_on, withdrawal_submitted_at is not null, withdrawal_comment)::text
   from claimed where order_id = '00000000-0000-0000-0000-0000000041d1' and kind = 'withdrawal_received'),
  row('request-client@example.test', 6667, public.range_today(), true, 'Przeprowadzka')::text,
  'AC-48: withdrawal_received — adres klienta, kwota i treść oświadczenia');
select is(
  (select row(email, withdrawal_comment, order_number is not null)::text
   from claimed where order_id = '00000000-0000-0000-0000-0000000041d1' and kind = 'withdrawal_admin'),
  row(null::text, null::text, true)::text, 'AC-48, §9: withdrawal_admin — numer zamówienia, bez adresu i uwag klienta');

-- ===== AC-49: panel — filtr „Zgłoszone odstąpienia” =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000041a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select array_agg(id) from public.admin_list_orders(public.range_today(), public.range_today(), 'withdrawal_requested')),
  array['00000000-0000-0000-0000-0000000041d1'::uuid], 'AC-49: filtr pokazuje zgłoszenia niezależnie od dat');
select is(
  (select row(withdrawal_submitted_at is not null, withdrawal_processed_at, withdrawal_comment, withdrawal_refund, refund_amount)::text
   from public.admin_list_orders(p_person => (select order_number from public.orders where id = '00000000-0000-0000-0000-0000000041d1'))),
  row(true, null::timestamptz, 'Przeprowadzka', null::integer, 6667)::text,
  'AC-49: zamówienie ze zgłoszeniem — data, kwota z oświadczenia, bez nowego wyliczenia');

-- AC-49: „Zleć zwrot” — kwota ze zgłoszenia, bez ponownego anulowania; zgłoszenie → processed.
select is(public.withdraw_order('00000000-0000-0000-0000-0000000041d1', null), 'refund_pending', 'AC-49: „Zleć zwrot”');
reset role;
select is(
  (select row(o.status, o.refund_amount, r.status, r.processed_by)::text
   from public.orders o join public.withdrawal_requests r on r.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000041d1'),
  row('refund_pending', 6667, 'processed', '00000000-0000-0000-0000-0000000041a1'::uuid)::text,
  'AC-49: refund_pending z kwotą zgłoszenia; zgłoszenie processed');
select is(
  (select (changes ->> 'request')::boolean from public.audit_log where action = 'order_refund'
     and changes ->> 'order_id' = '00000000-0000-0000-0000-0000000041d1' order by id desc limit 1),
  true, 'AC-49: audit_log order_refund ze zgłoszenia');
set local role authenticated;
select is((select count(*)::integer from public.admin_list_orders(p_status => 'withdrawal_requested')), 0,
  'AC-49: zgłoszenie po zleceniu znika z filtra');
reset role;

-- ===== AC-52: nieudany zwrot → zgłoszenie wraca do `new` =====

set local role service_role;
select is(public.revert_order_refund('00000000-0000-0000-0000-0000000041d1', null), true, 'AC-52: Tpay odrzucił zwrot');
reset role;
select is(
  (select row(o.status, o.refund_amount, o.withdrawal_on, p.status, r.status, r.processed_at is not null)::text
   from public.orders o join public.user_passes p on p.order_id = o.id join public.withdrawal_requests r on r.order_id = o.id
   where o.id = '00000000-0000-0000-0000-0000000041d1'),
  row('paid', 6667, public.range_today(), 'cancelled', 'new', true)::text,
  'AC-52: paid z kwotą, uprawnienie cancelled, zgłoszenie new (z datą poprzedniego zlecenia)');
set local role authenticated;
select is(
  (select withdrawal_processed_at is not null from public.admin_list_orders(p_status => 'withdrawal_requested')),
  true, 'AC-52: zgłoszenie znów w filtrze, oznaczone jako nieudany zwrot');
reset role;

-- ===== Usunięcie konta: user_id → null, withdrawal_admin nie jest pomijany =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000041c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.submit_withdrawal('00000000-0000-0000-0000-0000000041d2'), 5000, 'AC-48: nieużyte wejście — pełny zwrot');
reset role;
update public.orders set user_id = null where id = '00000000-0000-0000-0000-0000000041d2';
set local role service_role;
create temp table claimed2 as select * from public.mail_outbox_claim(100);
reset role;
select is(
  (select array_agg(kind || ':' || status order by kind) from public.email_outbox where order_id = '00000000-0000-0000-0000-0000000041d2'),
  array['withdrawal_admin:pending', 'withdrawal_received:skipped'],
  'AC-12: bez konta — potwierdzenie dla klienta pominięte, powiadomienie admina zostaje');

select * from finish();
rollback;
