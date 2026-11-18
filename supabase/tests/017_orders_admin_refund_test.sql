-- SPEC-003 US-6 (AC-24…AC-27): lista zamówień admina, powiadomienie Tpay o zwrocie, cofnięcie zlecenia zwrotu.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'orders-admin@example.test'),
  ('00000000-0000-0000-0000-0000000007b1', 'orders-staff@example.test'),
  ('00000000-0000-0000-0000-0000000007c1', 'jan.zwrot@example.test'),
  ('00000000-0000-0000-0000-0000000007c2', 'ewa@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000007a1';
update public.profiles set role = 'staff', full_name = 'Anna Obsługa' where id = '00000000-0000-0000-0000-0000000007b1';
update public.profiles set full_name = 'Jan Zwrotny' where id = '00000000-0000-0000-0000-0000000007c1';

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000007f1', 'entries', 'Karnet 10 wejść Z', 120000, 10),
  ('00000000-0000-0000-0000-0000000007f2', 'entries', 'Karnet 5 wejść Z', 65000, 5);

-- d1: Tpay opłacone (Jan), d2: Tpay opłacone (Ewa), d3: na miejscu (Jan, sprzedała obsługa), d4: Tpay oczekuje, wczoraj.
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, on_site_method, tpay_title, created_by, created_at) values
  ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007f1',
   'Karnet 10 wejść Z', 120000, 'tpay', null, 'TR-Z1', null, now()),
  ('00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007f1',
   'Karnet 10 wejść Z', 120000, 'tpay', null, 'TR-Z2', null, now()),
  ('00000000-0000-0000-0000-0000000007d3', '00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007f2',
   'Karnet 5 wejść Z', 65000, 'on_site', 'cash', null, '00000000-0000-0000-0000-0000000007b1', now()),
  ('00000000-0000-0000-0000-0000000007d4', '00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007f2',
   'Karnet 5 wejść Z', 65000, 'tpay', null, 'TR-Z4', null,
   (public.range_today()::timestamp at time zone 'Europe/Warsaw') - interval '1 minute');
create temp table fulfilled as select public.fulfil_order(id) from public.orders where id in
  ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007d3');
-- d2: karnet używany (AC-26).
update public.user_passes set entries_left = 9 where order_id = '00000000-0000-0000-0000-0000000007d2';

-- ===== AC-24: lista i filtry, tylko admin =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_list_orders()$$, '42501', null, 'AC-24: obsługa nie widzi listy zamówień');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
create temp table r as
  select * from public.admin_list_orders(p_product_id => null) where item_name like '% Z';
select is((select count(*)::integer from r), 4, 'AC-24: bez filtrów — wszystkie zamówienia');
select is(
  (select array_agg(id::text order by created_at desc, id) from public.admin_list_orders(p_from => public.range_today(), p_to => public.range_today())
     where item_name like '% Z'),
  array['00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007d3'],
  'AC-24: zakres dat w Europe/Warsaw (wczorajsze poza zakresem)');
select is((select count(*)::integer from public.admin_list_orders(p_status => 'pending') where item_name like '% Z'), 1,
  'AC-24: filtr statusu');
select is((select count(*)::integer from public.admin_list_orders(p_method => 'on_site') where item_name like '% Z'), 1,
  'AC-24: filtr metody');
select is((select count(*)::integer from public.admin_list_orders(p_product_id => '00000000-0000-0000-0000-0000000007f2')), 2,
  'AC-24: filtr produktu');
select is((select array_agg(id::text order by id) from public.admin_list_orders(p_person => '  ZWROTNY ')),
  array['00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007d3'],
  'AC-24: filtr osoby po imieniu i nazwisku (bez wielkości liter)');
select is((select count(*)::integer from public.admin_list_orders(p_person => 'ewa@example')), 2,
  'AC-24: filtr osoby po e-mailu');
select is((select count(*)::integer from public.admin_list_orders(p_person => '%')), 0,
  'AC-24: znaki wieloznaczne traktowane dosłownie');
select is(
  (select row(person_name, person_email, seller_name, pass_used)::text from r where id = '00000000-0000-0000-0000-0000000007d3'),
  row('Jan Zwrotny', 'jan.zwrot@example.test', 'Anna Obsługa', false)::text,
  'AC-24: osoba, e-mail i kto sprzedał');
select is((select pass_used from r where id = '00000000-0000-0000-0000-0000000007d2'), true,
  'AC-26: zamówienie z używanym karnetem oznaczone');
reset role;

-- ===== AC-25: zwrot Tpay — refund_pending → refunded po powiadomieniu =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.cancel_order('00000000-0000-0000-0000-0000000007d1'), 'refund_pending', 'AC-25: Tpay → refund_pending');
reset role;

set local role service_role;
select is(public.process_tpay_notification('hash-z1', 'TR-Z1', '00000000-0000-0000-0000-0000000007d1', 100, 100, false, true),
  'amount_mismatch', 'AC-25: zwrot z inną kwotą odrzucony');
select is(public.process_tpay_notification('hash-z2', 'TR-Z1', '00000000-0000-0000-0000-0000000007d1', 120000, 120000, false, true),
  'refunded', 'AC-25: powiadomienie CHARGEBACK → refunded');
select is(public.process_tpay_notification('hash-z3', 'TR-Z1', '00000000-0000-0000-0000-0000000007d1', 120000, 120000, false, true),
  'already_refunded', 'AC-25: kolejne powiadomienie o zwrocie bez zmian');
reset role;
select is(
  (select row(o.status, o.refunded_at is not null, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000007d1'),
  row('refunded', true, 'cancelled')::text, 'AC-25: zamówienie refunded, uprawnienie cancelled');

-- ===== AC-25, AC-27: Tpay odrzucił zwrot → cofnięcie; zwrot zlecony poza panelem =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.revert_order_refund('00000000-0000-0000-0000-0000000007d1', null)$$, '42501', null,
  'AC-25: cofnięcie zlecenia tylko kluczem secret');
reset role;
update public.user_passes set entries_left = 10 where order_id = '00000000-0000-0000-0000-0000000007d2';
create temp table cancelled as select public.cancel_order('00000000-0000-0000-0000-0000000007d2');
set local role service_role;
select is(public.revert_order_refund('00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007a1'), true,
  'AC-25: Tpay odrzucił zwrot — zlecenie cofnięte');
reset role;
select is(
  (select row(o.status, p.status)::text from public.orders o join public.user_passes p on p.order_id = o.id
   where o.id = '00000000-0000-0000-0000-0000000007d2'),
  row('paid', 'active')::text, 'AC-25: po cofnięciu zamówienie paid, uprawnienie active');
select is(
  (select array_agg(changes ->> 'status' order by id) from public.audit_log
   where action = 'order_refund' and changes ->> 'order_id' = '00000000-0000-0000-0000-0000000007d2'
     and actor_id = '00000000-0000-0000-0000-0000000007a1'),
  array['["paid", "refund_pending"]', '["refund_pending", "paid"]'],
  'AC-27: audit_log — zlecenie zwrotu i jego cofnięcie, kto i kwota');

set local role service_role;
select is(public.process_tpay_notification('hash-z4', 'TR-Z2', '00000000-0000-0000-0000-0000000007d2', 120000, 120000, false, true),
  'refunded', 'AC-25: zwrot zlecony poza panelem (zamówienie paid) → refunded');
reset role;
select is(
  (select count(*)::integer from public.audit_log where action = 'order_refund' and actor_id is null
     and changes ->> 'order_id' = '00000000-0000-0000-0000-0000000007d2' and (changes ->> 'amount')::integer = 120000),
  1, 'AC-27: zwrot z powiadomienia Tpay zapisany w audit_log');

select * from finish();
rollback;
