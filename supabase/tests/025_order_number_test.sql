-- SPEC-006 (AC-1…AC-6, AC-10, AC-11, AC-14 w bazie): numer zamówienia `SV-RRRR-NNNNNN` — nadawanie, rok w Europe/Warsaw,
-- ciągły licznik, niezmienność, luki, wyszukiwanie po numerze w `admin_list_orders`, numer w funkcjach list i Tpay.
-- AC-6 (numery dla zamówień sprzed migracji) — sprawdzone ręcznie na kopii bazy (opis w PR #99); tu stan po migracji.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000025a1', 'numer-admin@example.test'),
  ('00000000-0000-0000-0000-0000000025b1', 'numer-obsluga@example.test'),
  ('00000000-0000-0000-0000-0000000025c1', 'numer-klient@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000025a1';
update public.profiles set role = 'staff', full_name = 'Ola Numer' where id = '00000000-0000-0000-0000-0000000025b1';
update public.profiles set full_name = 'Jan Numerowy' where id = '00000000-0000-0000-0000-0000000025c1';
insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000025f1', 'entries', 'Karnet NR', 12000, 10);
update public.products set is_active = true where id = '00000000-0000-0000-0000-0000000025f1';

-- ===== Model danych (AC-4) =====
select col_not_null('public', 'orders', 'order_number', 'AC-4: numer zamówienia wymagany');
select col_is_unique('public', 'orders', 'order_number', 'AC-4: numer zamówienia unikalny');
select has_sequence('public', 'order_number_seq', 'AC-1: jedna sekwencja numerów zamówień');
select is((select count(*)::integer from public.orders where order_number is null), 0,
  'AC-6: każde zamówienie po migracji ma numer');

-- ===== AC-1: nadawanie przy każdym insert, wartość od klienta ignorowana =====
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, created_at, order_number) values
  ('00000000-0000-0000-0000-0000000025e1', '00000000-0000-0000-0000-0000000025c1', '00000000-0000-0000-0000-0000000025f1',
   'Karnet NR', 12000, 'tpay', '2026-06-15 10:00+00', 'SV-1999-999999');
select is((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e1'),
  public.format_order_number('2026-06-15 10:00+00', currval('public.order_number_seq')),
  'AC-1: insert dostaje kolejny numer z sekwencji, podana wartość zignorowana');
select matches((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e1'),
  '^SV-2026-[0-9]{6,}$', 'AC-1: format SV-RRRR-NNNNNN z rokiem utworzenia');
select is(public.format_order_number('2026-06-15 10:00+00', 123), 'SV-2026-000123', 'AC-1: zera wiodące do 6 cyfr');

-- ===== AC-3: rok w Europe/Warsaw, licznik nie wraca do 1 =====
insert into public.orders (id, product_id, item_name, amount, payment_method, created_at) values
  ('00000000-0000-0000-0000-0000000025e2', '00000000-0000-0000-0000-0000000025f1', 'Karnet NR', 12000, 'tpay',
   '2026-12-31 22:59+00');
insert into public.orders (id, product_id, item_name, amount, payment_method, created_at) values
  ('00000000-0000-0000-0000-0000000025e3', '00000000-0000-0000-0000-0000000025f1', 'Karnet NR', 12000, 'tpay',
   '2026-12-31 23:30+00');
create temp table nums as
  select id, order_number, substr(order_number, 4, 4) as year, substr(order_number, 9)::bigint as n
  from public.orders where id::text like '%0025e%';
grant select on nums to authenticated;
select is((select year from nums where id = '00000000-0000-0000-0000-0000000025e2'), '2026',
  'AC-3: 31.12 23:59 w Warszawie — rok 2026');
select is((select year from nums where id = '00000000-0000-0000-0000-0000000025e3'), '2027',
  'AC-3: 1.01 00:30 w Warszawie (31.12 UTC) — rok 2027');
select is((select n from nums where id = '00000000-0000-0000-0000-0000000025e3'),
  (select n from nums where id = '00000000-0000-0000-0000-0000000025e2') + 1,
  'AC-3: po zmianie roku licznik rośnie dalej');

-- ===== AC-5: wycofana transakcja zostawia lukę, numer nie wraca =====
savepoint gap;
insert into public.orders (product_id, item_name, amount, payment_method)
  values ('00000000-0000-0000-0000-0000000025f1', 'Karnet NR', 12000, 'tpay');
rollback to savepoint gap;
insert into public.orders (id, product_id, item_name, amount, payment_method, created_at) values
  ('00000000-0000-0000-0000-0000000025e4', '00000000-0000-0000-0000-0000000025f1', 'Karnet NR', 12000, 'tpay',
   '2026-11-18 10:00+00');
select is(substr((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e4'), 9)::bigint,
  (select n from nums where id = '00000000-0000-0000-0000-0000000025e3') + 2,
  'AC-5: numer z wycofanej transakcji nie jest użyty ponownie (luka)');
update public.orders set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-0000-0000-0000000025e2';
select is((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e2'),
  (select order_number from nums where id = '00000000-0000-0000-0000-0000000025e2'), 'AC-5: anulowane zachowuje numer');

-- ===== AC-4: numeru nie zmienia nikt =====
select throws_ok($$update public.orders set order_number = 'SV-2026-999999'
  where id = '00000000-0000-0000-0000-0000000025e1'$$, 'P0001', 'order_number_immutable',
  'AC-4: właściciel bazy nie zmieni numeru');
set local role service_role;
select throws_ok($$update public.orders set order_number = 'SV-2026-999999'
  where id = '00000000-0000-0000-0000-0000000025e1'$$, 'P0001', 'order_number_immutable',
  'AC-4: service_role nie zmieni numeru');
reset role;
select lives_ok($$update public.orders set order_number = order_number, refund_note = null
  where id = '00000000-0000-0000-0000-0000000025e1'$$, 'AC-4: zapis tej samej wartości (bez zmiany) przechodzi');
select col_has_check('public', 'orders', 'order_number', 'AC-4: check formatu numeru');

-- ===== Uprawnienia do sekwencji =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000025c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select nextval('public.order_number_seq')$$, '42501', null,
  'AC-1: klient nie pobiera numerów z sekwencji');
select is((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e1'),
  (select order_number from nums where id = '00000000-0000-0000-0000-0000000025e1'), 'Klient widzi numer własnego zamówienia');
reset role;

-- ===== AC-1, AC-14: create_tpay_order zwraca numer, także przy duplicate =====
create temp table tpay as select public.create_tpay_order('00000000-0000-0000-0000-0000000025c1',
  '00000000-0000-0000-0000-0000000025f1', null, '00000000-0000-0000-0000-0000000025aa') as r;
select is(tpay.r ->> 'order_number', (select order_number from public.orders where id = (tpay.r ->> 'order_id')::uuid),
  'AC-14: create_tpay_order zwraca order_number') from tpay;
select is(public.create_tpay_order('00000000-0000-0000-0000-0000000025c1', '00000000-0000-0000-0000-0000000025f1', null,
  '00000000-0000-0000-0000-0000000025aa') ->> 'order_number', tpay.r ->> 'order_number',
  'AC-14, §7: duplicate — ten sam numer, bez nowego') from tpay;

-- ===== AC-1, AC-15: sprzedaż na miejscu dostaje numer, lista dzisiejszej sprzedaży go zwraca =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000025b1","role":"authenticated"}', true);
set local role authenticated;
create temp table onsite as select public.create_on_site_order('00000000-0000-0000-0000-0000000025c1', '00000000-0000-0000-0000-0000000025f1', 'cash') as id;
select matches((select order_number from public.staff_on_site_sales_today() s join onsite using (id)),
  '^SV-[0-9]{4}-[0-9]{6,}$', 'AC-1: zamówienie na miejscu ma numer w dzisiejszej sprzedaży');
reset role;

-- ===== AC-2: licznik powyżej 999999 — więcej cyfr, bez błędu =====
-- `setval` nie cofa się z transakcją — po teście przywracamy poprzednią wartość (kolejne uruchomienia, AC-1).
create temp table seq_before as select last_value from public.order_number_seq;
select setval('public.order_number_seq', 999999);
insert into public.orders (id, product_id, item_name, amount, payment_method, created_at) values
  ('00000000-0000-0000-0000-0000000025e5', '00000000-0000-0000-0000-0000000025f1', 'Karnet NR', 12000, 'tpay',
   '2031-03-01 10:00+00');
select is((select order_number from public.orders where id = '00000000-0000-0000-0000-0000000025e5'), 'SV-2031-1000000',
  'AC-2: SV-2031-1000000 bez obcinania i bez błędu');
select setval('public.order_number_seq', last_value) from seq_before;

-- ===== AC-10, AC-11: normalizacja i wyszukiwanie po numerze =====
select is(public.normalize_order_number(' sv-2026-123 '), 'SV-2026-000123', 'AC-10: małe litery, spacje, bez zer');
select is(public.normalize_order_number('SV-2026-0000123'), 'SV-2026-000123', 'AC-10: nadmiarowe zera wiodące');
select is(public.normalize_order_number('SV-2031-1000000'), 'SV-2031-1000000', 'AC-10: numer dłuższy niż 6 cyfr');
select is(public.normalize_order_number('123'), null, 'AC-11: sama liczba to nie numer');
select is(public.normalize_order_number('00000000-0000-0000-0000-0000000025e1'), null, 'AC-11: UUID to nie numer');

create temp table q as
  select 'sv-' || year || '-' || n::text || ' ' as typed, order_number from nums
  where id = '00000000-0000-0000-0000-0000000025e1';
grant select on q to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000025a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select array_agg(o.order_number) from public.admin_list_orders('2000-01-01', '2000-01-02', 'refunded', 'on_site',
     null, null, (select typed from q)) o),
  (select array[order_number] from q),
  'AC-10: wyszukiwanie po numerze pomija pozostałe filtry (także zakres dat)');
select is(
  (select count(*)::integer from public.admin_list_orders(p_person => 'SV-1999-000001')), 0,
  'AC-10: brak zamówienia o tym numerze — pusta lista');
select is(
  (select array_agg(distinct o.person_name) from public.admin_list_orders('2026-06-15', '2026-06-15', null, null, null,
     null, 'numerowy') o),
  array['Jan Numerowy'], 'AC-11: tekst bez formy numeru — wyszukiwanie po osobie z filtrami jak dotąd');
select lives_ok($$select order_number from public.admin_list_invoices('todo')$$,
  'SPEC-006 AC-7: panel faktur zwraca order_number');
reset role;

select * from finish();
rollback;
