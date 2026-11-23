-- SPEC-005 US-7 (AC-21, AC-23), US-8 (AC-24, AC-25): cofnięcie zużycia karnetu, adnotacja, audit_log, historia.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'jan@example.test');
update public.profiles set role = 'admin', full_name = 'Anna Admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Jan Kowalski', address = 'ul. Polna 1, Gliwice'
  where id = '00000000-0000-0000-0000-0000000000c1';
insert into public.range_officers (id, full_name) values ('00000000-0000-0000-0000-0000000000d1', 'Piotr Prowadzący');

-- SPEC-012 AC-53, AC-54: karnet czasowy sprzedawany przed 7-A — wiersz z pominięciem wyzwalacza, sprzedaż bez końca.
alter table public.products disable trigger products_before_write;
create or replace function public.days_pass_sales_end() returns date language sql stable set search_path = ''
as $$ select date '9999-12-31' $$;
insert into public.products (id, kind, name, price, entries, days, day_type) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10, null, null),
  ('00000000-0000-0000-0000-00000000f002', 'days', 'Karnet 3 dni', 30000, null, 3, null),
  ('00000000-0000-0000-0000-00000000f003', 'single_entry', 'Wejście jednorazowe', 5000, null, null,
   case when extract(isodow from public.range_today()) in (6, 7) then 'weekend' else 'weekday' end);
alter table public.products enable trigger products_before_write;

create temp table t (name text primary key, id uuid);
grant all on t to public;
create function pg_temp.buy(p_name text, p_product uuid) returns void language sql as $$
  with o as (
    insert into public.orders (user_id, product_id, item_name, amount, payment_method)
      select '00000000-0000-0000-0000-0000000000c1', id, name, price, 'tpay' from public.products where id = p_product returning id
  )
  insert into t select p_name, public.fulfil_order(o.id) from o;
$$;
select pg_temp.buy('entries', '00000000-0000-0000-0000-00000000f001');
select pg_temp.buy('days', '00000000-0000-0000-0000-00000000f002');
select pg_temp.buy('single', '00000000-0000-0000-0000-00000000f003');

create function pg_temp.pass(p_name text) returns uuid language sql as $$ select id from t where name = p_name; $$;
create function pg_temp.entry(p_id uuid, p_pass text) returns uuid language plpgsql as $$
declare
  path text := to_char(now(), 'YYYY/MM/') || p_id || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('signatures', path);
  return (select id from public.create_range_log_entry(p_id, path, '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000c1', pg_temp.pass(p_pass)));
end;
$$;
create function pg_temp.usage(p_entry uuid) returns uuid language sql as $$
  select id from public.pass_usages where range_log_entry_id = p_entry;
$$;
grant execute on all functions in schema pg_temp to public;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.entry('40000000-0000-0000-0000-000000000001', 'entries');
select pg_temp.entry('40000000-0000-0000-0000-000000000002', 'days');
select pg_temp.entry('40000000-0000-0000-0000-000000000003', 'days');
select pg_temp.entry('40000000-0000-0000-0000-000000000004', 'single');

-- ===== Tylko admin =====
select throws_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000001'))$$,
  '42501', 'forbidden', 'AC-23: obsługa nie cofa zużycia');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000001'))$$,
  '42501', 'forbidden', 'AC-23: użytkownik nie cofa zużycia');
-- AC-24, AC-25: historia wejść i zużycia przed cofnięciem.
select is((select count(*)::int from public.my_range_entries()), 4, 'AC-24: użytkownik widzi swoje wejścia');
select is((select count(*)::int from public.pass_usages where reverted_at is null), 4, 'AC-25: użytkownik widzi historię zużycia swoich karnetów');
reset role;

-- ===== Admin cofa zużycie =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000001'))$$,
  'AC-23: admin cofa zużycie karnetu ilościowego');
select throws_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000001'))$$,
  'P0001', 'usage_already_reverted', 'AC-23: drugie cofnięcie tego samego zużycia odrzucone');
select throws_ok($$select public.revert_pass_usage('00000000-0000-0000-0000-000000000000')$$,
  'P0002', 'usage_not_found', 'AC-23: nieznane zużycie');
-- Karnet czasowy: dwa zużycia (aktywacja + dzień w ważności) — cofnięcie jednego nie zdejmuje aktywacji.
select lives_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000003'))$$,
  'AC-23: cofnięcie dnia w ważności karnetu czasowego');
reset role;
select is((select first_used_on from public.user_passes where id = pg_temp.pass('days')), public.range_today(),
  'AC-23: karnet czasowy z innym zużyciem zachowuje aktywację');

set local role authenticated;
select lives_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000002'))$$,
  'AC-23: cofnięcie ostatniego zużycia karnetu czasowego');
select lives_ok($$select public.revert_pass_usage(pg_temp.usage('40000000-0000-0000-0000-000000000004'))$$,
  'AC-23: cofnięcie wejścia jednorazowego');
reset role;

select is((select row(entries_left, status)::text from public.user_passes where id = pg_temp.pass('entries')),
  row(10, 'active')::text, 'AC-23: licznik +1');
select is((select row(first_used_on, valid_until)::text from public.user_passes where id = pg_temp.pass('days')),
  row(null::date, null::date)::text, 'AC-23: zdjęcie aktywacji, gdy to było jedyne zużycie karnetu czasowego');
select is((select status from public.user_passes where id = pg_temp.pass('single')), 'active',
  'AC-23: wejście jednorazowe znów aktywne');
select is((select row(count(*), count(reverted_by))::text from public.pass_usages where reverted_at is not null),
  row(4, 4)::text, 'AC-23: zużycia oznaczone jako cofnięte, z autorem');
select is((select count(*)::int from public.range_log), 4, 'AC-23: wpisy pozostają');
select is(
  (select array_agg(distinct body) from public.range_log_annotations where created_by = '00000000-0000-0000-0000-0000000000a1'),
  array['Cofnięto zużycie karnetu'], 'AC-23: adnotacja „Cofnięto zużycie karnetu” przy wpisie'
);
select is((select count(*)::int from public.range_log_annotations), 4, 'AC-23: adnotacja przy każdym cofniętym wpisie');
select is(
  (select row(actor_id, target_user_id, changes ->> 'effect')::text from public.audit_log
    where action = 'pass_usage_revert' order by id limit 1),
  row('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'decremented')::text,
  'AC-23: audit_log pass_usage_revert (kto, czyj karnet, skutek)'
);

-- AC-24: po cofnięciu wpis zostaje w historii wejść, bez nazwy uprawnienia.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.my_range_entries() where pass_name is null), 4,
  'AC-24: wejście z cofniętym zużyciem bez nazwy uprawnienia');
reset role;

select * from finish();
rollback;
