-- SPEC-007 US-6, §5 (#119): grafik dyżurów — `set_scheduled_range_duty`, `clear_scheduled_range_duty`, `range_duty_schedule`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
  ('00000000-0000-0000-0000-0000000000d1', 'Adam Książkowy'),
  ('00000000-0000-0000-0000-0000000000d2', 'Bogdan Grafikowy');
insert into public.range_officers (id, full_name, is_active) values
  ('00000000-0000-0000-0000-0000000000d3', 'Zenon Ukryty Przez Admina', false);
insert into public.range_officers (id, full_name, profile_id, license_number, institution, hide_from_others, status) values
  ('00000000-0000-0000-0000-0000000000e1', 'Hanna Ukryta', '00000000-0000-0000-0000-0000000000c2', '1', 'PZSS', true, 'approved'),
  ('00000000-0000-0000-0000-0000000000e2', 'Celina Czekająca', '00000000-0000-0000-0000-0000000000c3', '2', 'LOK', true, 'pending');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
-- Dzień grafiku jako tekst: dyżurny (imię i nazwisko, źródło) i osobno wpis grafiku.
create function pg_temp.day(p_offset int) returns text language sql as $$
  select row(s.full_name, s.source, s.schedule_full_name, s.schedule_on_list)::text
    from public.range_duty_schedule(91) s where s.day = public.range_today() + p_offset;
$$;
grant execute on all functions in schema pg_temp to public;

set local role authenticated;

-- ===== Brak dostępu dla użytkownika =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000d2')$$,
  '42501', 'forbidden', 'set_scheduled_range_duty: tylko Obsługa i admin');
select throws_ok($$select public.clear_scheduled_range_duty(public.range_today() + 1)$$,
  '42501', 'forbidden', 'clear_scheduled_range_duty: tylko Obsługa i admin');
select throws_ok($$select * from public.range_duty_schedule(30)$$,
  '42501', 'forbidden', 'range_duty_schedule: tylko Obsługa i admin');
select throws_ok($$select public.range_schedule_day_valid(public.range_today())$$, '42501', null,
  'range_schedule_day_valid: wewnętrzna, bez wywołania z API');

-- ===== Zakres dni (AC-23) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() - 1, '00000000-0000-0000-0000-0000000000d2')$$,
  'P0001', 'invalid_day', 'AC-23: wczoraj — invalid_day');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 91, '00000000-0000-0000-0000-0000000000d2')$$,
  'P0001', 'invalid_day', 'AC-23: dziś + 91 — invalid_day');
select throws_ok($$select public.set_scheduled_range_duty(null, '00000000-0000-0000-0000-0000000000d2')$$,
  'P0001', 'invalid_day', 'AC-23: brak dnia — invalid_day');
select throws_ok($$select public.clear_scheduled_range_duty(public.range_today() - 1)$$,
  'P0001', 'invalid_day', 'AC-22: usuwanie z grafiku — też tylko od dziś do 90 dni');
select lives_ok($$select public.set_scheduled_range_duty(public.range_today() + 90, '00000000-0000-0000-0000-0000000000d2')$$,
  'AC-23: dziś + 90 — dozwolone');

-- ===== Tylko „na liście” (AC-5, AC-23) =====

select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000e2')$$,
  'P0001', 'range_officer_inactive', 'AC-5: zgłoszenie pending nie trafia do grafiku');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000d3')$$,
  'P0001', 'range_officer_inactive', 'AC-23: prowadzący ukryty przez admina — range_officer_inactive');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, null)$$,
  'P0001', 'range_officer_inactive', 'AC-23: brak prowadzącego — range_officer_inactive');

-- ===== Zapis, nadpisanie, usunięcie (AC-22, AC-23) =====

select lives_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000d2')$$,
  'AC-23: Obsługa ustawia dyżurnego na jutro');
select is(pg_temp.day(1), row('Bogdan Grafikowy', 'schedule', 'Bogdan Grafikowy', true)::text,
  'AC-22: jutro — dyżurny z grafiku');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000e1')$$,
  'AC-23: „Zmień” (admin); ukrytego dla innych można wybrać');
reset role;
select is((select count(*)::int from public.range_duty where day = public.range_today() + 1), 1,
  'AC-23: jeden wpis grafiku na dzień (nadpisuje poprzedni)');
select ok((select set_by = '00000000-0000-0000-0000-0000000000a1' and range_officer_id = '00000000-0000-0000-0000-0000000000e1'
             from public.range_duty where day = public.range_today() + 1 and source = 'schedule'),
  'AC-23: zapisane kto ustawił i nowy prowadzący');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.clear_scheduled_range_duty(public.range_today() + 1)$$, 'AC-22: „Usuń z grafiku”');
select is(pg_temp.day(1), row(null, null, null, null)::text, 'AC-22: po usunięciu — brak dyżurnego');
select lives_ok($$select public.clear_scheduled_range_duty(public.range_today() + 1)$$, 'AC-22: usunięcie pustego dnia bez błędu');

-- ===== Grafik: zakres i kolejność źródeł (AC-22, AC-25) =====

select is((select count(*)::int from public.range_duty_schedule(30)), 30, 'AC-22: 30 kolejnych dni');
select is((select (min(day) - public.range_today()) || '…' || (max(day) - public.range_today()) from public.range_duty_schedule(500)),
  '0…90', 'AC-22: maks. 90 dni naprzód (dziś + 90)');

-- Dziś: wpis grafiku i zmiana w książce — książka wygrywa, a grafik jest osobnym wpisem (AC-25).
select public.set_scheduled_range_duty(public.range_today(), '00000000-0000-0000-0000-0000000000d2');
select is(pg_temp.day(0), row('Bogdan Grafikowy', 'schedule', 'Bogdan Grafikowy', true)::text,
  'AC-22: dziś bez zmiany w książce — dyżurny z grafiku');
select public.set_range_duty('00000000-0000-0000-0000-0000000000d1');
select is(pg_temp.day(0), row('Adam Książkowy', 'book', 'Bogdan Grafikowy', true)::text,
  'AC-25: zmiana w książce ma pierwszeństwo przed grafikiem; wpis grafiku osobno');
select public.clear_scheduled_range_duty(public.range_today());
select is(pg_temp.day(0), row('Adam Książkowy', 'book', null, null)::text,
  'AC-25: usunięcie wpisu grafiku na dziś nie zmienia zmiany z książki');

-- Prowadzący z grafiku spoza listy — pomijany jako dyżurny, wpis grafiku widoczny do zmiany (AC-17).
select public.set_scheduled_range_duty(public.range_today() + 2, '00000000-0000-0000-0000-0000000000e1');
reset role;
update public.range_officers set status = 'pending' where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.day(2), row(null, null, 'Hanna Ukryta', false)::text,
  'AC-17: prowadzący z grafiku wrócił do pending — brak dyżurnego, wpis grafiku do zmiany');

select * from finish();
rollback;
