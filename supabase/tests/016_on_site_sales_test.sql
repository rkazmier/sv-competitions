-- SPEC-003 US-5 (AC-21…AC-23): sprzedaż na miejscu — wejściówki, osoba bez konta, dzisiejsza lista.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'sale-admin@example.test'),
  ('00000000-0000-0000-0000-0000000005b1', 'sale-staff@example.test'),
  ('00000000-0000-0000-0000-0000000005c1', 'sale-user@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000005a1';
update public.profiles set role = 'staff', full_name = 'Anna Obsługa' where id = '00000000-0000-0000-0000-0000000005b1';

insert into public.products (id, kind, name, price, entries, day_type) values
  ('00000000-0000-0000-0000-0000000005f1', 'entries', 'Karnet 5 wejść', 60000, 5, null),
  ('00000000-0000-0000-0000-0000000005f2', 'single_entry', 'Wejście dziś', 5000, null,
   case when extract(isodow from public.range_today()) in (6, 7) then 'weekend' else 'weekday' end);
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000005e0', 'Szkolenia S');
-- Bez blokady karnetów (SPEC-012 AC-40, AC-43 — 037_pass_blocking_test.sql): osoba bez konta kupuje wejście dziś.
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, ticket_price, capacity,
  blocks_passes) values
  ('00000000-0000-0000-0000-0000000005e1', 'Dziś', '00000000-0000-0000-0000-0000000005e0',
   public.range_today(), public.range_today() + 1, 'published', 'paid', 8000, 2, false),
  ('00000000-0000-0000-0000-0000000005e2', 'Za tydzień', '00000000-0000-0000-0000-0000000005e0',
   public.range_today() + 7, null, 'published', 'paid', 9000, null, false),
  ('00000000-0000-0000-0000-0000000005e3', 'Wczoraj', '00000000-0000-0000-0000-0000000005e0',
   public.range_today() - 1, null, 'published', 'paid', 9000, null, false),
  ('00000000-0000-0000-0000-0000000005e4', 'Bezpłatne', '00000000-0000-0000-0000-0000000005e0',
   public.range_today(), null, 'published', 'free', null, null, false);
-- Wczorajsza sprzedaż na miejscu — poza dzisiejszą listą (AC-23).
insert into public.orders (product_id, item_name, amount, payment_method, on_site_method, status, created_at, created_by) values
  ('00000000-0000-0000-0000-0000000005f2', 'Wczoraj', 5000, 'on_site', 'cash', 'paid',
   (public.range_today()::timestamp at time zone 'Europe/Warsaw') - interval '1 minute',
   '00000000-0000-0000-0000-0000000005b1'),
-- Pierwsza dzisiejsza (północ Europe/Warsaw) — na liście ostatnia (AC-23).
  ('00000000-0000-0000-0000-0000000005f2', 'O północy', 1000, 'on_site', 'terminal', 'paid',
   public.range_today()::timestamp at time zone 'Europe/Warsaw', '00000000-0000-0000-0000-0000000005b1');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;

-- ===== Uprawnienia =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.staff_on_site_sales_today()$$, '42501', null,
  'AC-23: użytkownik nie widzi dzisiejszej sprzedaży');
select throws_ok($$select public.create_on_site_order(null, null, 'cash', '00000000-0000-0000-0000-0000000005e1')$$,
  '42501', null, 'AC-21: wejściówki na miejscu sprzedaje tylko obsługa');
reset role;

-- ===== AC-21: wejściówka dla osoby z kontem =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('ticket', public.create_on_site_order('00000000-0000-0000-0000-0000000005c1', null, 'terminal',
  '00000000-0000-0000-0000-0000000005e1'));
select is(
  (select row(o.item_name, o.amount, o.status, o.on_site_method, o.created_by, p.user_id, p.kind, p.valid_until)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'ticket')),
  row('Wejściówka: Dziś', 8000, 'paid', 'terminal', '00000000-0000-0000-0000-0000000005b1'::uuid,
      '00000000-0000-0000-0000-0000000005c1'::uuid, 'event_ticket', public.range_today() + 1)::text,
  'AC-21: wejściówka na miejscu — opłacona, cena z wydarzenia, created_by = obsługa, uprawnienie dla osoby');
insert into t values ('future', public.create_on_site_order('00000000-0000-0000-0000-0000000005c1', null, 'cash',
  '00000000-0000-0000-0000-0000000005e2'));
select ok((select id from t where name = 'future') is not null, 'AC-21: osobie z kontem można sprzedać wejściówkę na przyszłe wydarzenie');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000005c1', null, 'cash',
  '00000000-0000-0000-0000-0000000005e3')$$, 'P0001', 'sales_closed', 'AC-21: po ostatnim dniu wydarzenia sprzedaż zamknięta');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000005c1', null, 'cash',
  '00000000-0000-0000-0000-0000000005e4')$$, 'P0001', 'event_unavailable', 'AC-21: wydarzenie bezpłatne nie ma wejściówek');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000005c1',
  '00000000-0000-0000-0000-0000000005f1', 'cash', '00000000-0000-0000-0000-0000000005e1')$$,
  '22023', 'invalid_request', 'AC-21: produkt albo wejściówka, nie oba');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000005a9',
  '00000000-0000-0000-0000-0000000005f1', 'cash')$$, 'P0002', 'user_not_found', 'AC-21: nieznana osoba');

-- ===== AC-22: osoba bez konta =====

insert into t values ('guest_ticket', public.create_on_site_order(null, null, 'cash', '00000000-0000-0000-0000-0000000005e1'));
select is(
  (select row(o.user_id, p.user_id, p.expires_on)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'guest_ticket')),
  row(null::uuid, null::uuid, public.range_today())::text,
  'AC-22: wejściówka na dzisiejsze wydarzenie bez konta — bez user_id, wygasa z końcem dnia');
select throws_ok($$select public.create_on_site_order(null, null, 'cash', '00000000-0000-0000-0000-0000000005e2')$$,
  'P0001', 'guest_product_not_allowed', 'AC-22: bez konta tylko wejściówka na dzisiejsze wydarzenie');
select throws_ok($$select public.create_on_site_order(null, '00000000-0000-0000-0000-0000000005f1', 'cash')$$,
  'P0001', 'guest_product_not_allowed', 'AC-22: bez konta nie można sprzedać karnetu');
select throws_ok($$select public.create_on_site_order(null, null, 'cash', '00000000-0000-0000-0000-0000000005e1')$$,
  'P0001', 'sold_out', 'AC-21: limit miejsc obowiązuje także na miejscu');
insert into t values ('guest_entry', public.create_on_site_order(null, '00000000-0000-0000-0000-0000000005f2', 'cash'));

-- ===== AC-23: dzisiejsza sprzedaż =====

select is((select count(*)::int from public.staff_on_site_sales_today()), 5,
  'AC-23: lista zawiera tylko dzisiejszą sprzedaż na miejscu');
select is(
  (select row(s.item_name, s.amount, s.on_site_method, s.status, s.seller_name)::text
   from public.staff_on_site_sales_today() s where s.id = (select id from t where name = 'ticket')),
  row('Wejściówka: Dziś', 8000, 'terminal', 'paid', 'Anna Obsługa')::text,
  'AC-23: godzina, produkt, kwota, metoda i kto sprzedał');
select is((select (array_agg(item_name))[5] from public.staff_on_site_sales_today()), 'O północy',
  'AC-23: od najnowszej');
select is(
  (select sum(amount)::int from public.staff_on_site_sales_today() where on_site_method = 'cash'), 5000 + 9000 + 8000,
  'AC-23: suma gotówki z dzisiejszych pozycji');
reset role;

-- Tpay nie trafia na listę sprzedaży na miejscu.
insert into public.orders (user_id, product_id, item_name, amount, payment_method, status)
  values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005f1', 'Online', 60000, 'tpay', 'paid');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.staff_on_site_sales_today()), 5, 'AC-23: płatności Tpay poza listą; admin też widzi listę');
reset role;

select * from finish();
rollback;
