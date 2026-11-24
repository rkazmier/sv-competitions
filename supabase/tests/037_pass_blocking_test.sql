-- SPEC-012 US-8 (AC-40, AC-41, AC-43, AC-45): karnety i wejścia jednorazowe nie obowiązują w dniach wydarzeń i zawodów.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000370b1', 'block-staff@example.test'),
  ('00000000-0000-0000-0000-0000000370c1', 'block-user@example.test');
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000370b1';

insert into public.products (id, kind, name, price, entries, day_type) values
  ('00000000-0000-0000-0000-0000000370f1', 'entries', 'Karnet 10 wejść B', 120000, 10, null),
  ('00000000-0000-0000-0000-0000000370f3', 'single_entry', 'Wejście dziś B', 5000, null,
   case when extract(isodow from public.range_today()) in (6, 7) then 'weekend' else 'weekday' end);

insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000370e0', 'Blokady');
insert into public.disciplines (id, name) values ('00000000-0000-0000-0000-0000000370d0', 'Blokady D');
insert into public.rulebooks (id, title, file_path, file_size)
  values ('00000000-0000-0000-0000-0000000370a9', 'Regulamin B', 'rulebooks/b.pdf', 1000);
-- Dziś: płatne wydarzenie (na razie szkic), jutro–pojutrze: zawody (opublikowane, z flagą), za 3 dni: wydarzenie bez flagi.
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, ticket_price) values
  ('00000000-0000-0000-0000-0000000370e1', 'Piknik B', '00000000-0000-0000-0000-0000000370e0',
   public.range_today(), null, 'draft', 'paid', 4000);
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, external_url, blocks_passes) values
  ('00000000-0000-0000-0000-0000000370e2', 'Wyjazd B', '00000000-0000-0000-0000-0000000370e0',
   public.range_today() + 3, null, 'published', 'https://example.test', false);
insert into public.competitions (id, name, discipline_id, starts_on, ends_on, rulebook_id, status) values
  ('00000000-0000-0000-0000-0000000370c9', 'Zawody B', '00000000-0000-0000-0000-0000000370d0',
   public.range_today() + 1, public.range_today() + 2, '00000000-0000-0000-0000-0000000370a9', 'published');

create temp table t (name text primary key, id uuid);
grant all on t to public;
create function pg_temp.buy(p_name text, p_product uuid) returns void language sql as $$
  with o as (
    insert into public.orders (user_id, product_id, item_name, amount, payment_method)
      select '00000000-0000-0000-0000-0000000370c1', id, name, price, 'tpay' from public.products where id = p_product
      returning id
  )
  insert into t select p_name, public.fulfil_order(o.id) from o;
$$;
select pg_temp.buy('entries', '00000000-0000-0000-0000-0000000370f1');
select pg_temp.buy('single', '00000000-0000-0000-0000-0000000370f3');
-- Wejście jednorazowe zależy od dnia tygodnia — liczone tylko dziś (dzień pasuje do produktu).
create function pg_temp.valid_kinds(p_date date) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}')
  from public.passes_valid_on('00000000-0000-0000-0000-0000000370c1', p_date)
  where kind <> 'single_entry' or p_date = public.range_today();
$$;

-- ===== AC-40: flaga domyślnie zaznaczona =====

select is((select blocks_passes from public.calendar_events where id = '00000000-0000-0000-0000-0000000370e1'), true,
  'AC-40: nowe wydarzenie ma blocks_passes = true');
select is((select blocks_passes from public.competitions where id = '00000000-0000-0000-0000-0000000370c9'), true,
  'AC-40: nowe zawody mają blocks_passes = true');

-- ===== AC-41: range_blocked_on — publiczna =====

set local role anon;
select is((select array_agg(row(kind, name)::text) from public.range_blocked_on(public.range_today() + 1)),
  array[row('competition', 'Zawody B')::text], 'AC-41: range_blocked_on zwraca opublikowane zawody z flagą (anon)');
select is((select count(*)::int from public.range_blocked_on(public.range_today())), 0,
  'AC-41: szkic wydarzenia nie blokuje');
select is((select count(*)::int from public.range_blocked_on(public.range_today() + 3)), 0,
  'AC-41: wpis bez flagi nie blokuje');
select is((select count(*)::int from public.range_blocked_on(public.range_today() + 2)), 1,
  'AC-41: blokada obejmuje ostatni dzień (ends_on)');
reset role;

-- ===== AC-41: ważność uprawnień w dzień blokady =====

select is(pg_temp.valid_kinds(public.range_today() + 1), '{}'::text[],
  'AC-41: w dzień zawodów karnet ilościowy nieważny');
select is(pg_temp.valid_kinds(public.range_today() + 3), array['entries'],
  'AC-41: dzień wpisu bez flagi — karnet ważny');

-- Dziś bez blokady: wszystkie uprawnienia ważne.
select is(pg_temp.valid_kinds(public.range_today()), array['entries', 'single_entry'],
  'AC-45: dziś bez blokady — karnety i wejście jednorazowe ważne');

-- ===== AC-45: publikacja dzisiejszego wydarzenia działa od razu; wejściówka bez zmian =====

update public.calendar_events set status = 'published' where id = '00000000-0000-0000-0000-0000000370e1';
insert into public.orders (id, user_id, calendar_event_id, item_name, amount, payment_method) values
  ('00000000-0000-0000-0000-0000000370a1', '00000000-0000-0000-0000-0000000370c1',
   '00000000-0000-0000-0000-0000000370e1', 'Wejściówka: Piknik B', 4000, 'tpay');
select public.fulfil_order('00000000-0000-0000-0000-0000000370a1');
select is(pg_temp.valid_kinds(public.range_today()), array['event_ticket'],
  'AC-41, AC-45: po publikacji dziś ważna tylko wejściówka');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000370b1","role":"authenticated"}', true);
select is((select array_agg(kind) from public.passes_for_range_entry('00000000-0000-0000-0000-0000000370c1')),
  array['event_ticket'], 'AC-42: książka pokazuje tylko wejściówkę');

-- ===== AC-43: sprzedaż na miejscu =====

select throws_ok($$select public.create_on_site_order(null, '00000000-0000-0000-0000-0000000370f3', 'cash')$$,
  'P0001', 'range_blocked', 'AC-43: wejście jednorazowe dla osoby bez konta odrzucone w dzień blokady');
select ok(public.create_on_site_order('00000000-0000-0000-0000-0000000370c1', '00000000-0000-0000-0000-0000000370f1', 'cash')
  is not null, 'AC-43: karnet dla osoby z kontem sprzedany mimo blokady');
select ok(public.create_on_site_order(null, null, 'cash', '00000000-0000-0000-0000-0000000370e1') is not null,
  'AC-43: wejściówka dla osoby bez konta dozwolona w dzień blokady');
reset role;

-- ===== AC-45: zmiana flagi działa od razu =====

update public.calendar_events set blocks_passes = false where id = '00000000-0000-0000-0000-0000000370e1';
select is(pg_temp.valid_kinds(public.range_today()), array['entries', 'entries', 'event_ticket', 'single_entry'],
  'AC-45: odznaczenie flagi — karnety znów ważne dziś');
update public.competitions set status = 'draft' where id = '00000000-0000-0000-0000-0000000370c9';
select is(pg_temp.valid_kinds(public.range_today() + 1), array['entries', 'entries'],
  'AC-45: cofnięcie publikacji zawodów zdejmuje blokadę');

select * from finish();
rollback;
