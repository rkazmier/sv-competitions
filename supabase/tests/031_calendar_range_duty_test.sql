-- SPEC-007 US-7, §5 (#120): dyżurny Prowadzący zawodów i wydarzeń — `duty_range_officer_id`, wyzwalacz
-- `check_calendar_duty`, `admin_calendar_duty`, krok zawodów / wydarzeń w `range_duty_for`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'czeka@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Celina Czekająca' where id = '00000000-0000-0000-0000-0000000000c3';

insert into public.range_officers (id, full_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Adam Zawodowy'),
  ('00000000-0000-0000-0000-0000000000d2', 'Bogdan Grafikowy');
insert into public.range_officers (id, full_name, profile_id, license_number, institution, hide_from_others, status) values
  ('00000000-0000-0000-0000-0000000000e2', 'Celina Czekająca', '00000000-0000-0000-0000-0000000000c3', '2', 'LOK', true, 'pending');
insert into public.disciplines (id, name) values ('00000000-0000-0000-0000-00000000d001', 'Long Range');
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000e001', 'Szkolenie');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
-- Dyżurny dnia z grafiku: imię i nazwisko, źródło, nazwa zawodów / wydarzenia i osobno wpis grafiku.
create function pg_temp.day(p_offset int) returns text language sql as $$
  select row(s.full_name, s.source, s.event_name, s.schedule_full_name)::text
    from public.range_duty_schedule(91) s where s.day = public.range_today() + p_offset;
$$;
-- Komunikat i `detail` błędu (AC-29: dzień i nazwa dla komunikatu w formularzu).
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
declare
  message text;
  detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics message = message_text, detail = pg_exception_detail;
  return message || ' ' || coalesce(detail, '');
end;
$$;
grant execute on all functions in schema pg_temp to public;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

-- ===== Brak dostępu do kolumny (AC-30) =====

select throws_ok($$select duty_range_officer_id from public.competitions$$, '42501', null,
  'AC-30: authenticated (także admin) nie czyta kolumny zawodów bezpośrednio');
select throws_ok($$select duty_range_officer_id from public.calendar_events$$, '42501', null,
  'AC-30: authenticated nie czyta kolumny wydarzeń bezpośrednio');
set local role anon;
select throws_ok($$select duty_range_officer_id from public.competitions$$, '42501', null,
  'AC-30: anon nie czyta dyżurnego zawodów');
select throws_ok($$select duty_range_officer_id from public.calendar_events$$, '42501', null,
  'AC-30: anon nie czyta dyżurnego wydarzeń');
select throws_ok($$select * from public.admin_calendar_duty('competition', gen_random_uuid())$$, '42501', null,
  'AC-30: admin_calendar_duty niedostępna dla anon');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from public.admin_calendar_duty('competition', gen_random_uuid())$$, '42501', 'forbidden',
  'AC-30: admin_calendar_duty — tylko admin (formularze kalendarza)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.admin_calendar_duty('rulebook', gen_random_uuid())$$, 'P0001', 'invalid_kind',
  'admin_calendar_duty: tylko zawody albo wydarzenie');

-- ===== Tylko „na liście” (AC-28) =====

select throws_ok($$insert into public.competitions (name, discipline_id, starts_on, duty_range_officer_id)
    values ('X', '00000000-0000-0000-0000-00000000d001', public.range_today(), '00000000-0000-0000-0000-0000000000e2')$$,
  'P0001', 'range_officer_inactive', 'AC-28: zgłoszenie pending nie może być dyżurnym zawodów');

-- ===== Zapis i kolejność źródeł (AC-26, AC-27) =====

-- Szkic zawodów: dziś…dziś + 2, dyżurny Adam.
select lives_ok($$insert into public.competitions (id, name, discipline_id, starts_on, ends_on, duty_range_officer_id)
    values ('00000000-0000-0000-0000-0000000000f1', 'Puchar Doliny', '00000000-0000-0000-0000-00000000d001',
            public.range_today(), public.range_today() + 2, '00000000-0000-0000-0000-0000000000d1')$$,
  'AC-26: admin zapisuje szkic zawodów z dyżurnym');
select is((select row(full_name, on_list)::text from public.admin_calendar_duty('competition', '00000000-0000-0000-0000-0000000000f1')),
  row('Adam Zawodowy', true)::text, 'AC-26: formularz czyta dyżurnego przez admin_calendar_duty');
select is((select count(*)::int from public.admin_calendar_duty('event', '00000000-0000-0000-0000-0000000000f1')), 0,
  'admin_calendar_duty: zły rodzaj — brak wiersza');

select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000d2');
select is(pg_temp.day(1), row('Adam Zawodowy', 'event', 'Puchar Doliny', 'Bogdan Grafikowy')::text,
  'AC-27, AC-24: szkic zawodów ma pierwszeństwo przed grafikiem; wpis grafiku osobno');
select is(pg_temp.day(3), row(null, null, null, null)::text, 'AC-27: dzień po zawodach — dyżurny zawodów nie obowiązuje');
select public.set_range_duty('00000000-0000-0000-0000-0000000000d2');
select is((select row(full_name, source, event_name)::text from public.current_range_duty()),
  row('Bogdan Grafikowy', 'book', null)::text, 'AC-16, AC-27: zmiana w książce dziś ma pierwszeństwo przed zawodami');

-- ===== Nakładanie terminów (AC-29) =====

select is(pg_temp.error_of($$insert into public.calendar_events (name, category_id, starts_on, ends_on, duty_range_officer_id)
    values ('Szkolenie RO', '00000000-0000-0000-0000-00000000e001', public.range_today() + 2, public.range_today() + 4,
            '00000000-0000-0000-0000-0000000000d2')$$),
  'range_duty_conflict ' || jsonb_build_object('day', public.range_today() + 2, 'name', 'Puchar Doliny')::text,
  'AC-29: wydarzenie z innym dyżurnym w dniach zawodów — konflikt z pierwszym wspólnym dniem i nazwą');
select lives_ok($$insert into public.calendar_events (id, name, category_id, starts_on, ends_on, duty_range_officer_id)
    values ('00000000-0000-0000-0000-0000000000f2', 'Szkolenie RO', '00000000-0000-0000-0000-00000000e001',
            public.range_today() + 2, public.range_today() + 4, '00000000-0000-0000-0000-0000000000d1')$$,
  'AC-29: ten sam prowadzący w nakładających się terminach — dozwolone');
select lives_ok($$insert into public.calendar_events (id, name, category_id, starts_on, duty_range_officer_id)
    values ('00000000-0000-0000-0000-0000000000f3', 'Dzień otwarty', '00000000-0000-0000-0000-00000000e001',
            public.range_today() + 10, '00000000-0000-0000-0000-0000000000d2')$$,
  'AC-29: inny dyżurny w innym terminie — dozwolone');
select throws_ok($$update public.calendar_events set starts_on = public.range_today() + 4
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'P0001', 'range_duty_conflict', 'AC-29: zmiana dat na nakładające się z innym dyżurnym — odrzucona');
select throws_ok($$update public.competitions set duty_range_officer_id = '00000000-0000-0000-0000-0000000000d2'
    where id = '00000000-0000-0000-0000-0000000000f1'$$,
  'P0001', 'range_duty_conflict', 'AC-29: zmiana dyżurnego zawodów na innego niż w nakładającym się wydarzeniu — odrzucona');
select lives_ok($$update public.calendar_events set duty_range_officer_id = null, starts_on = public.range_today() + 4
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'AC-26, AC-29: usunięcie dyżurnego („Nie wskazano”) zdejmuje blokadę');
select lives_ok($$update public.competitions set duty_range_officer_id = null where id = '00000000-0000-0000-0000-0000000000f1'$$,
  'AC-26: dyżurnego można usunąć po zapisie');
select is(pg_temp.day(1), row('Bogdan Grafikowy', 'schedule', null, 'Bogdan Grafikowy')::text,
  'Brzegowe §7: zawody bez dyżurnego — obowiązuje grafik');

-- ===== Prowadzący znika z listy po zapisie (AC-17, AC-28) =====

reset role;
update public.range_officers set is_active = false where id = '00000000-0000-0000-0000-0000000000d1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.day(3), row(null, null, null, null)::text,
  'AC-17: dyżurny wydarzenia ukryty — źródło pomijane');
select is((select row(full_name, on_list)::text from public.admin_calendar_duty('event', '00000000-0000-0000-0000-0000000000f2')),
  row('Adam Zawodowy', false)::text, 'AC-28: formularz wie, że wskazany dyżurny nie jest już dostępny');
select lives_ok($$update public.calendar_events set name = 'Szkolenie RO II' where id = '00000000-0000-0000-0000-0000000000f2'$$,
  'AC-28: zapis innych pól bez zmiany ukrytego dyżurnego — dozwolony');
select throws_ok($$update public.calendar_events set duty_range_officer_id = '00000000-0000-0000-0000-0000000000d1'
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'P0001', 'range_officer_inactive', 'AC-28: wskazanie ukrytego prowadzącego — odrzucone');

select * from finish();
rollback;
