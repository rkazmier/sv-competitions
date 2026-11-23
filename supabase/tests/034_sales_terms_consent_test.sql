-- SPEC-012 US-1, US-2, US-10 (AC-1, AC-3…AC-5, AC-7, AC-8, AC-54): wersja regulaminu, zgoda 14 dni, karnety czasowe wycofane.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000034a1', 'admin34@example.test'),
  ('00000000-0000-0000-0000-0000000034b1', 'staff34@example.test'),
  ('00000000-0000-0000-0000-0000000034c1', 'user34@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000034a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000034b1';

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000034f1', 'entries', 'Karnet 3 wejść', 10000, 3);
-- Karnet czasowy sprzedawany przed 7-A — wiersz z pominięciem wyzwalacza AC-53.
alter table public.products disable trigger products_before_write;
insert into public.products (id, kind, name, price, days) values
  ('00000000-0000-0000-0000-0000000034f2', 'days', 'Karnet 30 dni', 30000, 30);
alter table public.products enable trigger products_before_write;
update public.products set is_active = true where id in ('00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f2');
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000034e0', 'Szkolenia 34');
insert into public.calendar_events
  (id, name, category_id, starts_on, ends_on, status, external_url, access_mode, ticket_price) values
  ('00000000-0000-0000-0000-0000000034e1', 'Szkolenie', '00000000-0000-0000-0000-0000000034e0',
   current_date + 10, null, 'published', 'https://example.test', 'paid', 5000);

create function pg_temp.buy(p_product uuid, p_event uuid, p_version date, p_consent boolean) returns uuid language sql as $$
  select (public.create_tpay_order('00000000-0000-0000-0000-0000000034c1', p_product, p_event, gen_random_uuid(),
                                   p_version, p_consent) ->> 'order_id')::uuid;
$$;

-- ===== Wersje regulaminu (AC-4, §5 RLS) =====

select is(public.days_pass_sales_end(), '2027-01-01'::date, 'AC-54: DAYS_PASS_SALES_END = 2027-01-01 (jak w products.ts)');
set local role anon;
select ok(exists (select 1 from public.sales_terms_versions where effective_from = '2027-01-01'),
  'AC-4: wersja 2027-01-01 (#154) widoczna publicznie');
reset role;
set local role authenticated;
select throws_ok($$insert into public.sales_terms_versions values ('2030-01-01')$$, '42501', null,
  '§5: wersje dodaje tylko migracja');
reset role;

-- ===== Bez obowiązującej wersji (§7) =====

delete from public.sales_terms_versions;
select is(public.current_sales_terms_version(), null, '§7: brak obowiązującej wersji → null');
set local role service_role;
create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('no_version', pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, null, true));
reset role;
select is((select terms_version from public.orders where id = (select id from t where name = 'no_version')), null,
  '§7: zakup bez wersji w tabeli → terms_version = null');

-- ===== Wersja przy zamówieniu (AC-1, AC-3) =====

insert into public.sales_terms_versions values (public.range_today() - 1), (public.range_today() + 30);
select is(public.current_sales_terms_version(), public.range_today() - 1,
  'AC-1: bieżąca wersja = najnowsza effective_from ≤ dziś (przyszła się nie liczy)');
set local role service_role;
select throws_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, null, true)$$,
  'P0001', 'terms_changed', 'AC-3: przeglądarka bez wersji, a wersja obowiązuje → terms_changed');
select throws_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, public.range_today() + 30, true)$$,
  'P0001', 'terms_changed', 'AC-3: wersja inna niż bieżąca → terms_changed');
select throws_ok($$select pg_temp.buy(null, '00000000-0000-0000-0000-0000000034e1', public.range_today() - 30, false)$$,
  'P0001', 'terms_changed', 'AC-3: wejściówka też sprawdza wersję');
insert into t values ('product', pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, public.range_today() - 1, true));
reset role;
select is((select row(terms_version, early_performance_consent_at)::text from public.orders where id = (select id from t where name = 'product')),
  row(public.range_today() - 1, now())::text,
  'AC-3, AC-8: zamówienie z wersją pokazaną w przeglądarce i czasem zgody = now()');

-- ===== Zgoda (AC-7, AC-8) =====

set local role service_role;
select throws_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, public.range_today() - 1, false)$$,
  '22023', 'consent_required', 'AC-7: karnet bez zgody → consent_required');
select throws_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, public.range_today() - 1, null)$$,
  '22023', 'consent_required', 'AC-7: brak pola zgody → consent_required');
reset role;
select is((select count(*)::int from public.orders where user_id = '00000000-0000-0000-0000-0000000034c1'), 2,
  'AC-7: odrzucone żądania nie tworzą zamówień');
set local role service_role;
insert into t values ('ticket', pg_temp.buy(null, '00000000-0000-0000-0000-0000000034e1', public.range_today() - 1, false));
insert into t values ('ticket2', pg_temp.buy(null, '00000000-0000-0000-0000-0000000034e1', public.range_today() - 1, true));
reset role;
select results_eq(
  $$select terms_version, early_performance_consent_at from public.orders
    where id in (select id from t where name like 'ticket%') order by id$$,
  $$values (public.range_today() - 1, null::timestamptz), (public.range_today() - 1, null::timestamptz)$$,
  'AC-8: wejściówka bez zgody (także gdy przyszła w żądaniu), z wersją regulaminu');

-- ===== Panel (AC-5) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select row(terms_version, early_performance_consent_at)::text from public.admin_list_orders(p_person => (
     select order_number from public.orders where id = (select id from t where name = 'product')))),
  row(public.range_today() - 1, now())::text,
  'AC-5: panel zamówień dostaje wersję regulaminu i datę zgody');
reset role;

-- ===== Sprzedaż na miejscu i prezent bez wersji i zgody (AC-8) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034b1","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('on_site', public.create_on_site_order('00000000-0000-0000-0000-0000000034c1',
  '00000000-0000-0000-0000-0000000034f1', 'cash'));
reset role;
select is((select row(terms_version, early_performance_consent_at)::text from public.orders where id = (select id from t where name = 'on_site')),
  row(null::date, null::timestamptz)::text, 'AC-8: sprzedaż na miejscu — bez wersji i zgody');

-- ===== Karnety czasowe od DAYS_PASS_SALES_END (AC-54) =====

set local role service_role;
insert into t values ('days_before', pg_temp.buy('00000000-0000-0000-0000-0000000034f2', null, public.range_today() - 1, true));
reset role;
select ok((select id from t where name = 'days_before') is not null, 'AC-54: przed datą końca karnet czasowy w sprzedaży');

-- „Dziś” = pierwszy dzień bez sprzedaży.
create or replace function public.days_pass_sales_end() returns date language sql stable set search_path = ''
as $$ select public.range_today() $$;

set local role service_role;
select throws_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f2', null, public.range_today() - 1, true)$$,
  'P0001', 'product_discontinued', 'AC-54: create_tpay_order odrzuca karnet czasowy');
select lives_ok($$select pg_temp.buy('00000000-0000-0000-0000-0000000034f1', null, public.range_today() - 1, true)$$,
  'AC-54: inne produkty bez zmian');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000034c1',
  '00000000-0000-0000-0000-0000000034f2', 'cash')$$, 'P0001', 'product_discontinued',
  'AC-54: create_on_site_order odrzuca karnet czasowy');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-0000000034f2',
  null, 'Nagroda w zawodach', public.range_today() + 30, gen_random_uuid())$$, 'P0001', 'product_discontinued',
  'AC-54: grant_pass odrzuca karnet czasowy');
reset role;

select lives_ok($$select public.fulfil_order((select id from t where name = 'days_before'))$$,
  'AC-54: zamówienie pending sprzed daty końca, opłacone później — realizowane normalnie');
select is((select kind from public.user_passes where order_id = (select id from t where name = 'days_before')), 'days',
  'AC-54: uprawnienie karnetu czasowego wydane');
select lives_ok($$update public.products set name = 'Karnet 30 dni (wycofany)' where id = '00000000-0000-0000-0000-0000000034f2'$$,
  'AC-53: edycja istniejącego produktu czasowego bez zmian');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok($$insert into public.products (kind, name, price, days) values ('days', 'Dane testowe', 100, 1)$$,
  'AC-53: wyjątek — klucz secret (serwer, dane testowe E2E) dodaje karnet czasowy');
reset role;

select * from finish();
rollback;
