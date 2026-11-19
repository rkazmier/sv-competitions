-- SPEC-007 US-4, AC-19, §5 (#116): dyżurny Prowadzący (`range_duty`), wyszukiwarka prowadzących, nocne czyszczenie.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ukryta@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'czeka@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Hanna Ukryta' where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set full_name = 'Celina Czekająca' where id = '00000000-0000-0000-0000-0000000000c3';

insert into public.range_officers (id, full_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Adam Dyżurny'),
  ('00000000-0000-0000-0000-0000000000d2', 'Bogdan Grafikowy');
insert into public.range_officers (id, full_name, is_active) values
  ('00000000-0000-0000-0000-0000000000d3', 'Zenon Ukryty Przez Admina', false);
-- Zatwierdzony z konta, „Ukryj mnie dla innych”; drugi — czeka na zatwierdzenie.
insert into public.range_officers (id, full_name, profile_id, license_number, institution, hide_from_others, status) values
  ('00000000-0000-0000-0000-0000000000e1', 'Hanna Ukryta', '00000000-0000-0000-0000-0000000000c2', '1', 'PZSS', true, 'approved'),
  ('00000000-0000-0000-0000-0000000000e2', 'Celina Czekająca', '00000000-0000-0000-0000-0000000000c3', '2', 'LOK', true, 'pending');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.duty() returns text language sql as $$
  select coalesce((select row(d.full_name, d.source)::text from public.current_range_duty() d), 'brak');
$$;
grant execute on all functions in schema pg_temp to public;

-- ===== Schemat (§5) =====

insert into public.range_duty (day, source, range_officer_id) values
  (public.range_today(), 'schedule', '00000000-0000-0000-0000-0000000000d2');
select throws_ok($$insert into public.range_duty (day, source, range_officer_id)
  values (public.range_today(), 'schedule', '00000000-0000-0000-0000-0000000000d1')$$, '23505', null,
  '§5: jeden wpis na dzień i źródło');
select throws_ok($$insert into public.range_duty (day, source, range_officer_id)
  values (public.range_today(), 'event', '00000000-0000-0000-0000-0000000000d1')$$, '23514', null,
  '§5: źródło tylko book lub schedule');
select lives_ok($$insert into public.range_duty (day, source, range_officer_id)
  values (public.range_today() + 1, 'schedule', '00000000-0000-0000-0000-0000000000d1')$$,
  '§5: inny dzień — osobny wpis');

-- ===== RLS i uprawnienia =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.range_duty), 0, 'RLS: użytkownik nie widzi dyżurów');
select throws_ok($$select pg_temp.duty()$$, '42501', 'forbidden', 'current_range_duty: tylko Obsługa i admin');
select throws_ok($$select * from public.set_range_duty('00000000-0000-0000-0000-0000000000d1')$$, '42501', 'forbidden',
  'set_range_duty: tylko Obsługa i admin');
select throws_ok($$select * from public.staff_search_range_officers('Adam')$$, '42501', 'forbidden',
  'staff_search_range_officers: tylko Obsługa i admin');
select throws_ok($$select * from public.range_duty_for(public.range_today())$$, '42501', null,
  'range_duty_for: wewnętrzna, bez wywołania z API');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.range_duty), 2, 'RLS: Obsługa czyta dyżury');
select throws_ok($$insert into public.range_duty (day, source, range_officer_id)
  values (public.range_today(), 'book', '00000000-0000-0000-0000-0000000000d1')$$, '42501', null,
  'RLS: zapis tylko przez funkcje');
select throws_ok($$delete from public.range_duty$$, '42501', null, 'RLS: bez bezpośredniego usuwania');

-- ===== Kolejność źródeł: książka → grafik (AC-15, AC-16) =====

select is(pg_temp.duty(), row('Bogdan Grafikowy', 'schedule')::text, 'AC-16: bez zmiany w książce — dyżurny z grafiku');
select is((select row(full_name, source)::text from public.set_range_duty('00000000-0000-0000-0000-0000000000d1')),
  row('Adam Dyżurny', 'book')::text, 'AC-15: wybór w książce zapisuje dyżurnego i go zwraca');
select is(pg_temp.duty(), row('Adam Dyżurny', 'book')::text, 'AC-16: zmiana w książce ma pierwszeństwo przed grafikiem');
reset role;
select ok((select set_by = '00000000-0000-0000-0000-0000000000b1' and day = public.range_today()
             from public.range_duty where source = 'book'),
  'AC-15: zapisane kto i na dziś (Europe/Warsaw)');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select full_name from public.set_range_duty('00000000-0000-0000-0000-0000000000e1')), 'Hanna Ukryta',
  'AC-16: „Zmień” (admin) nadpisuje; ukrytego dla innych można wybrać');
reset role;
select is((select count(*)::int from public.range_duty where day = public.range_today() and source = 'book'), 1,
  'AC-16: jeden dyżurny z książki na dzień (upsert)');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

-- Tylko „na liście” (AC-5).
select throws_ok($$select * from public.set_range_duty('00000000-0000-0000-0000-0000000000e2')$$,
  'P0001', 'range_officer_inactive', 'AC-5: zgłoszenie pending nie może być dyżurnym');
select throws_ok($$select * from public.set_range_duty('00000000-0000-0000-0000-0000000000d3')$$,
  'P0001', 'range_officer_inactive', 'AC-17: prowadzący ukryty przez admina nie może być dyżurnym');
select throws_ok($$select * from public.set_range_duty(null)$$,
  'P0001', 'range_officer_inactive', 'set_range_duty: brak prowadzącego odrzucony');
select is(pg_temp.duty(), row('Hanna Ukryta', 'book')::text, 'odrzucona zmiana nie zmienia dyżurnego');

-- ===== Pomijanie prowadzącego spoza listy (AC-17) =====

reset role;
update public.range_officers set status = 'pending' where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.duty(), row('Bogdan Grafikowy', 'schedule')::text,
  'AC-17: dyżurny z książki wrócił do pending — obowiązuje grafik');
reset role;
update public.range_officers set is_active = false where id = '00000000-0000-0000-0000-0000000000d2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.duty(), 'brak', 'AC-17: żadne źródło nie wskazuje prowadzącego na liście — brak dyżurnego (AC-15)');
reset role;
update public.range_officers set is_active = true where id = '00000000-0000-0000-0000-0000000000d2';
update public.range_officers set status = 'approved' where id = '00000000-0000-0000-0000-0000000000e1';
delete from public.range_duty where day = public.range_today();
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.duty(), 'brak', 'AC-15: bez wpisów na dziś — brak dyżurnego');

-- ===== Wyszukiwarka (AC-19) =====

select is((select count(*)::int from public.staff_search_range_officers('Ad')), 0, 'AC-19: mniej niż 3 znaki — brak wyników');
select is((select array_agg(full_name) from public.staff_search_range_officers('  ukry ')), array['Hanna Ukryta'],
  'AC-19: ukryty dla innych znaleziony; ukryty przez admina i pending — nie');
select is((select count(*)::int from public.staff_search_range_officers('czek')), 0, 'AC-5: zgłoszenie pending poza wyszukiwarką');
select is((select count(*)::int from public.staff_search_range_officers('a_a')), 0, 'AC-19: znaki wzorca dosłownie');
reset role;
insert into public.range_officers (full_name) select 'Test Prowadzący ' || n from generate_series(1, 12) n;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.staff_search_range_officers('test prow')), 10, 'AC-19: maks. 10 wyników');

-- ===== Nocne czyszczenie (ADR-0006) =====

reset role;
insert into public.range_duty (day, source, range_officer_id) values
  (public.range_today() - 1, 'book', '00000000-0000-0000-0000-0000000000d1'),
  (public.range_today() - 2, 'schedule', '00000000-0000-0000-0000-0000000000d2'),
  (public.range_today(), 'book', '00000000-0000-0000-0000-0000000000d1');
select is(public.purge_range_duty(), 2, 'purge_range_duty: usuwa tylko dni minione');
select is((select array_agg(day - public.range_today() order by day) from public.range_duty), array[0, 1],
  'purge_range_duty: dziś i grafik na kolejne dni zostają');
select ok(exists (select 1 from cron.job where jobname = 'purge-range-duty'), 'purge_range_duty: w nocnym zadaniu');

select * from finish();
rollback;
