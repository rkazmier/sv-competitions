-- SPEC-004 §5 (AC-5, AC-12, AC-13): walidacja NIP i KSeF, `billing_details` z RLS, kopia danych faktury w `orders`,
-- `set_order_invoice_details`, `mark_invoice_issued`, `unmark_invoice`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000022a1', 'faktury-admin@example.test'),
  ('00000000-0000-0000-0000-0000000022b1', 'faktury-obsluga1@example.test'),
  ('00000000-0000-0000-0000-0000000022b2', 'faktury-obsluga2@example.test'),
  ('00000000-0000-0000-0000-0000000022c1', 'firma1@example.test'),
  ('00000000-0000-0000-0000-0000000022c2', 'firma2@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000022a1';
update public.profiles set role = 'staff'
  where id in ('00000000-0000-0000-0000-0000000022b1', '00000000-0000-0000-0000-0000000022b2');

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000022f1', 'entries', 'Karnet 10 wejść F', 120000, 10);

-- e1: Tpay oczekuje (c1); e2: na miejscu, sprzedała b1 (c1); e3: na miejscu, sprzedała b2 (c2);
-- e4: Tpay (c2, admin dodaje fakturę po zakupie — AC-14); e5: na miejscu (c2, do zwrotu).
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, on_site_method, created_by) values
  ('00000000-0000-0000-0000-0000000022e1', '00000000-0000-0000-0000-0000000022c1', '00000000-0000-0000-0000-0000000022f1',
   'Karnet 10 wejść F', 120000, 'tpay', null, null),
  ('00000000-0000-0000-0000-0000000022e2', '00000000-0000-0000-0000-0000000022c1', '00000000-0000-0000-0000-0000000022f1',
   'Karnet 10 wejść F', 120000, 'on_site', 'cash', '00000000-0000-0000-0000-0000000022b1'),
  ('00000000-0000-0000-0000-0000000022e3', '00000000-0000-0000-0000-0000000022c2', '00000000-0000-0000-0000-0000000022f1',
   'Karnet 10 wejść F', 120000, 'on_site', 'terminal', '00000000-0000-0000-0000-0000000022b2'),
  ('00000000-0000-0000-0000-0000000022e4', '00000000-0000-0000-0000-0000000022c2', '00000000-0000-0000-0000-0000000022f1',
   'Karnet 10 wejść F', 120000, 'tpay', null, null),
  ('00000000-0000-0000-0000-0000000022e5', '00000000-0000-0000-0000-0000000022c2', '00000000-0000-0000-0000-0000000022f1',
   'Karnet 10 wejść F', 120000, 'on_site', 'cash', '00000000-0000-0000-0000-0000000022b1');
create temp table fulfilled as select public.fulfil_order(id) from public.orders where id in
  ('00000000-0000-0000-0000-0000000022e2', '00000000-0000-0000-0000-0000000022e3',
   '00000000-0000-0000-0000-0000000022e4', '00000000-0000-0000-0000-0000000022e5');
grant select on fulfilled to authenticated;

-- ===== Walidacja NIP i numeru KSeF (§5, §7) =====

select is(public.is_valid_nip('5260250274'), true, '§5: poprawna suma kontrolna NIP');
select is(public.is_valid_nip('5260250275'), false, '§5: błędna suma kontrolna NIP');
select is(public.is_valid_nip('1000000160'), false, '§5: reszta 10 — NIP nieprawidłowy');
select is(public.is_valid_nip('526025027'), false, '§5: NIP musi mieć 10 cyfr');
select is(public.is_valid_nip(null), false, '§5: brak NIP — nieprawidłowy');
select is(public.normalize_nip(' pl 526-025-02-74 '), '5260250274', '§7: prefiks PL, spacje i myślniki usuwane');
select is(public.is_valid_nip(public.normalize_nip('DE5260250274')), false, '§7: NIP zagraniczny odrzucony');
select is(public.is_valid_ksef_number('5260250274-20261118-0100A0B1C2D3-E4'), true, 'AC-12: poprawny numer KSeF');
select is(public.is_valid_ksef_number('5260250274-2026111-0100A0B1C2D3-E4'), false, 'AC-12: numer KSeF niezgodny ze wzorcem');

-- ===== AC-5: zapis danych faktury przy zamówieniu i w billing_details (klucz secret, payments-create) =====

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', ' PL 526-025-02-74 ',
  '  Firma Testowa Sp. z o.o. ', 'ul. Prosta 1, 00-001 Warszawa', 'vat_whitelist', '2026-11-18 10:00+00', true)$$,
  'AC-5: payments-create zapisuje dane faktury');
select is(
  (select row(invoice_requested, invoice_nip, invoice_company_name, invoice_company_address, invoice_data_source,
              invoice_fetched_at, invoice_number)::text
     from public.orders where id = '00000000-0000-0000-0000-0000000022e1'),
  row(true, '5260250274', 'Firma Testowa Sp. z o.o.', 'ul. Prosta 1, 00-001 Warszawa', 'vat_whitelist',
      '2026-11-18 10:00+00'::timestamptz, null::text)::text,
  'AC-5: zamówienie ma kopię: NIP (znormalizowany), nazwę, adres, źródło, datę pobrania');
select is(
  (select row(nip, company_name, company_address, data_source, fetched_at)::text
     from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c1'),
  row('5260250274', 'Firma Testowa Sp. z o.o.', 'ul. Prosta 1, 00-001 Warszawa', 'vat_whitelist',
      '2026-11-18 10:00+00'::timestamptz)::text,
  'AC-5: dane zapisane też w billing_details');
select lives_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '1234563218',
  'Inna Firma', 'ul. Krzywa 2, Kraków', 'manual', '2026-11-18 10:00+00', true)$$,
  'AC-5: ponowny zapis przed zapłatą');
select is(
  (select row(nip, company_name, data_source, fetched_at)::text
     from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c1'),
  row('1234563218', 'Inna Firma', 'manual', null::timestamptz)::text,
  'AC-5: billing_details nadpisane; źródło manual bez daty pobrania');
select is((select count(*)::integer from public.orders o
            where o.id = '00000000-0000-0000-0000-0000000022e1' and o.invoice_fetched_at is null
              and o.invoice_data_source = 'manual'), 1,
  'AC-4: zamówienie z danymi ręcznymi — źródło manual');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '5260250275',
  'Firma', 'ul. Prosta 1', 'manual')$$, '22023', 'invalid_nip', 'AC-5: błędny NIP odrzucony');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '5260250274',
  'F', 'ul. Prosta 1', 'manual')$$, '22023', 'invalid_company_name', 'AC-4: nazwa 2–250 znaków');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '5260250274',
  'Firma', 'ul.', 'manual')$$, '22023', 'invalid_company_address', 'AC-4: adres 5–300 znaków');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '5260250274',
  'Firma', 'ul. Prosta 1', 'ceidg')$$, '22023', 'invalid_data_source', '§5: źródło z listy');
select throws_ok($$select public.set_order_invoice_details(gen_random_uuid(), '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, 'P0002', 'order_not_found', '§5: nieistniejące zamówienie');
reset role;

-- ===== Uprawnienia set_order_invoice_details (§3) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e1', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, '42501', 'forbidden', '§5: klient nie zmienia danych faktury w zamówieniu');
select throws_ok($$update public.orders set invoice_number = 'X' where id = '00000000-0000-0000-0000-0000000022e1'$$,
  '42501', null, '§5: klient nie zapisuje kolumn faktury bezpośrednio');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022b1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e2', '5260250274',
  'Firma Testowa', 'ul. Prosta 1, Warszawa', 'vat_whitelist')$$,
  'AC-9: obsługa dodaje dane faktury do swojej sprzedaży na miejscu');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e3', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, '42501', 'forbidden', '§3: obsługa — tylko sprzedaż, którą rejestruje');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e4', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, '42501', 'forbidden', '§3: obsługa nie zmienia zamówień Tpay');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e2', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual', null, true)$$, '42501', 'forbidden',
  '§5: obsługa nie nadpisuje billing_details klienta');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e4', '7770001111',
  'Spółka Po Zakupie', 'ul. Długa 3, Gdańsk', 'regon', now())$$,
  'AC-14: admin dodaje dane faktury do opłaconego zamówienia');
select is((select count(*)::integer from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c2'), 0,
  'AC-14: bez nadpisywania billing_details klienta');
select is(public.cancel_order('00000000-0000-0000-0000-0000000022e5'), 'refunded', 'Przygotowanie: zwrot na miejscu');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e5', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, 'P0001', 'order_refunded', 'AC-16: bez faktury dla zwróconego zamówienia');
reset role;

-- ===== RLS billing_details (§5) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022c2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.billing_details), 0, '§5: klient nie widzi cudzych billing_details');
select throws_ok($$insert into public.billing_details (user_id, nip, company_name, company_address, data_source)
  values ('00000000-0000-0000-0000-0000000022c1', '5260250274', 'Obca', 'ul. Obca 1', 'manual')$$,
  '42501', null, '§5: klient nie zapisuje cudzych billing_details');
update public.billing_details set company_name = 'Przejęta' where user_id = '00000000-0000-0000-0000-0000000022c1';
select lives_ok($$insert into public.billing_details (user_id, nip, company_name, company_address, data_source)
  values ('00000000-0000-0000-0000-0000000022c2', 'PL777-000-11-11', ' Moja Firma ', 'ul. Własna 5, Łódź', 'manual')$$,
  'AC-8: klient zapisuje własne billing_details');
select is((select nip || '|' || company_name from public.billing_details), '7770001111|Moja Firma',
  'AC-8: NIP znormalizowany, nazwa przycięta');
select throws_ok($$update public.billing_details set nip = '7770001112'$$, '23514', null,
  '§5: billing_details tylko z poprawnym NIP');
select is((select count(*)::integer from public.orders where invoice_requested), 1,
  'AC-7: klient widzi dane faktury tylko swoich zamówień');
reset role;
select is((select company_name from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c1'),
  'Inna Firma', '§5: aktualizacja cudzego wiersza nie ma skutku');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.billing_details), 2, 'AC-9: obsługa widzi billing_details (podpowiedź)');
delete from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c1';
select is((select count(*)::integer from public.billing_details), 2, '§5: obsługa nie usuwa billing_details');
reset role;

set local role anon;
select throws_ok($$select * from public.billing_details$$, '42501', null, '§9: anonim nie ma dostępu');
reset role;

-- ===== AC-12: oznaczenie jako wystawionej =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', 'FV 1')$$,
  '42501', 'forbidden', 'AC-12: tylko admin oznacza fakturę');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e1', 'FV 1')$$,
  'P0001', 'order_not_paid', 'AC-12: tylko opłacone zamówienie');
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e3', 'FV 1')$$,
  'P0001', 'invoice_not_requested', 'AC-12: tylko zamówienie z żądaniem faktury');
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', '   ')$$,
  '22023', 'invalid_invoice_number', 'AC-12: numer faktury wymagany');
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', repeat('1', 51))$$,
  '22023', 'invalid_invoice_number', 'AC-12: numer faktury do 50 znaków');
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', 'FV 1', 'KSEF-123')$$,
  '22023', 'invalid_ksef_number', 'AC-12: numer KSeF zgodny ze wzorcem');
select lives_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', ' FV 1/11/2026 ',
  ' 5260250274-20261118-0100a0b1c2d3-e4 ')$$, 'AC-12: admin oznacza fakturę jako wystawioną');
select is(
  (select row(invoice_number, ksef_number, invoice_issued_by, invoice_issued_at is not null)::text
     from public.orders where id = '00000000-0000-0000-0000-0000000022e2'),
  row('FV 1/11/2026', '5260250274-20261118-0100A0B1C2D3-E4', '00000000-0000-0000-0000-0000000022a1'::uuid, true)::text,
  'AC-12: numer, numer KSeF, kto i kiedy oznaczył');
select is(
  (select row(actor_id, target_user_id, changes)::text from public.audit_log where action = 'invoice_issued'),
  row('00000000-0000-0000-0000-0000000022a1'::uuid, '00000000-0000-0000-0000-0000000022c1'::uuid,
      jsonb_build_object('order_id', '00000000-0000-0000-0000-0000000022e2', 'invoice_number', jsonb_build_array(null, 'FV 1/11/2026'),
                         'ksef_number', jsonb_build_array(null, '5260250274-20261118-0100A0B1C2D3-E4')))::text,
  'AC-12: audit_log invoice_issued');
select throws_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000022e2', 'FV 2')$$,
  'P0001', 'invoice_already_issued', 'AC-12: nie oznacza dwa razy');
select throws_ok($$select public.set_order_invoice_details('00000000-0000-0000-0000-0000000022e2', '5260250274',
  'Firma', 'ul. Prosta 1', 'manual')$$, 'P0001', 'invoice_already_issued',
  '§5: dane faktury bez zmian po wystawieniu');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022c1","role":"authenticated"}', true);
set local role authenticated;
select is((select invoice_number from public.orders where id = '00000000-0000-0000-0000-0000000022e2'), 'FV 1/11/2026',
  'AC-12: klient widzi numer faktury (AC-7)');
reset role;

-- ===== AC-13: cofnięcie oznaczenia =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.unmark_invoice('00000000-0000-0000-0000-0000000022e2')$$,
  '42501', 'forbidden', 'AC-13: tylko admin cofa oznaczenie');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.unmark_invoice('00000000-0000-0000-0000-0000000022e2')$$, 'AC-13: admin cofa oznaczenie');
select is(
  (select row(invoice_requested, invoice_number, ksef_number, invoice_issued_at, invoice_issued_by)::text
     from public.orders where id = '00000000-0000-0000-0000-0000000022e2'),
  row(true, null::text, null::text, null::timestamptz, null::uuid)::text,
  'AC-13: pozycja wraca do „Do wystawienia” (żądanie faktury zostaje)');
select is(
  (select changes from public.audit_log where action = 'invoice_unmarked'),
  jsonb_build_object('order_id', '00000000-0000-0000-0000-0000000022e2', 'invoice_number', jsonb_build_array('FV 1/11/2026', null),
                     'ksef_number', jsonb_build_array('5260250274-20261118-0100A0B1C2D3-E4', null)),
  'AC-13: audit_log invoice_unmarked ze starym numerem');
select throws_ok($$select public.unmark_invoice('00000000-0000-0000-0000-0000000022e2')$$,
  'P0001', 'invoice_not_issued', 'AC-13: nie cofa nieoznaczonej');
reset role;

-- ===== §7: usunięcie konta =====

delete from auth.users where id = '00000000-0000-0000-0000-0000000022c1';
select is((select count(*)::integer from public.billing_details where user_id = '00000000-0000-0000-0000-0000000022c1'), 0,
  '§7: usunięcie konta usuwa billing_details');
select is((select invoice_nip from public.orders where id = '00000000-0000-0000-0000-0000000022e1'), '1234563218',
  '§7: kopia danych faktury w zamówieniu zostaje');

select * from finish();
rollback;
