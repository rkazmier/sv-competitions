-- SPEC-008 §5, ADR-0007 (#129): dyżurny Prowadzący z konta prowadzi książkę rejestru pobytu w dniu dyżuru.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- c1 — dyżurny z konta (e1), c3 — w grafiku tylko jutro (e3), c4 — zgłoszenie pending (e4), c5 — zwykły użytkownik.
-- c2, c6 — osoby wpisywane (c6 — braki w danych). d1 — prowadzący bez konta.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'dyzurny@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'jan.kowalski@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'jutro@example.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'czeka@example.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c6', 'braki@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Dariusz Dyżurny' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set full_name = 'Jan Kowalski', permit_number = 'AB 123', permit_authority = 'KWP Katowice',
  qr_token = 'qr-jan' where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set full_name = 'Jerzy Jutrzejszy' where id = '00000000-0000-0000-0000-0000000000c3';
update public.profiles set full_name = 'Celina Czekająca' where id = '00000000-0000-0000-0000-0000000000c4';

insert into public.range_officers (id, full_name) values ('00000000-0000-0000-0000-0000000000d1', 'Adam Bezkonta');
insert into public.range_officers (id, full_name, profile_id, license_number, institution, status) values
  ('00000000-0000-0000-0000-0000000000e1', 'Dariusz Dyżurny', '00000000-0000-0000-0000-0000000000c1', '1', 'PZSS', 'approved'),
  ('00000000-0000-0000-0000-0000000000e3', 'Jerzy Jutrzejszy', '00000000-0000-0000-0000-0000000000c3', '3', 'PZSS', 'approved'),
  ('00000000-0000-0000-0000-0000000000e4', 'Celina Czekająca', '00000000-0000-0000-0000-0000000000c4', '4', 'LOK', 'pending');
insert into public.range_duty (day, source, range_officer_id) values
  (public.range_today() + 1, 'schedule', '00000000-0000-0000-0000-0000000000e3');

-- Uprawnienie osoby c2 (karnet 10 wejść).
insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10);
create temp table t (name text primary key, id uuid);
grant all on t to public;
with o as (
  insert into public.orders (user_id, product_id, item_name, amount, payment_method)
    values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f001', 'Karnet 10 wejść', 120000, 'tpay')
    returning id
)
insert into t select 'pass', public.fulfil_order(o.id) from o;

-- Wpis z wczoraj (stan „z przeszłości” z pominięciem funkcji zapisu — tylko dla testu).
insert into public.range_log (id, entered_at, full_name, address, range_officer_name, signature_path) values
  ('30000000-0000-0000-0000-000000000001', now() - interval '1 day', 'Ewa Wczorajsza', 'ul. Polna 1, Gliwice',
   'Adam Bezkonta', '2026/11/30000000-0000-0000-0000-000000000001.png');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.sig(p_id uuid) returns text language plpgsql as $$
declare
  path text := to_char(now(), 'YYYY/MM/') || p_id || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('signatures', path);
  return path;
end;
$$;
create function pg_temp.entry(p_id uuid, p_officer uuid) returns uuid language sql as $$
  select id from public.create_range_log_entry(p_id, pg_temp.sig(p_id), p_officer,
    '00000000-0000-0000-0000-0000000000c2', (select id from t where name = 'pass'));
$$;
grant execute on all functions in schema pg_temp to public;

-- ===== Bez dyżuru: brak dostępu (AC-3) =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.is_range_duty_officer(), false, 'AC-3: bez dyżurnego na dziś — nie jest dyżurnym');
select is(public.can_keep_range_log(), false, 'AC-3: bez dyżuru — nie prowadzi książki');
select throws_ok($$select * from public.staff_find_by_qr('qr-jan')$$, '42501', 'forbidden', 'AC-3: bez dyżuru — forbidden');

reset role;
insert into public.range_duty (day, source, range_officer_id) values
  (public.range_today(), 'book', '00000000-0000-0000-0000-0000000000e1');

-- ===== Dyżurny z konta: dostęp (AC-1, AC-5…AC-7) =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.is_range_duty_officer(), true, 'AC-1: dziś dyżurny z konta — is_range_duty_officer');
select is(public.can_keep_range_log(), true, 'AC-1: dyżurny prowadzi książkę');
select is((select full_name from public.staff_find_by_qr('qr-jan')), 'Jan Kowalski', 'AC-5: dyżurny skanuje QR');
select is((select array_agg(full_name) from public.staff_search_people('kowal')), array['Jan Kowalski'],
  'AC-5: dyżurny wyszukuje osobę');
select is((select full_name from public.staff_person_by_id('00000000-0000-0000-0000-0000000000c2')), 'Jan Kowalski',
  'AC-5: dyżurny pobiera osobę po identyfikatorze');
select is((select row(permit_number, permit_authority)::text
             from public.staff_person_entry_data('00000000-0000-0000-0000-0000000000c2')),
  row('AB 123', 'KWP Katowice')::text, 'AC-10: dyżurny widzi dane osoby do wpisu');
select is((select missing_fields from public.staff_complete_profile('00000000-0000-0000-0000-0000000000c6',
            p_full_name => 'Barbara Braki', p_address => 'ul. Stalowa 2, Gliwice')), '{}'::text[],
  'AC-6: dyżurny uzupełnia brakujące dane');
reset role;
select is((select count(*)::int from public.audit_log where action = 'profile_update'
             and actor_id = '00000000-0000-0000-0000-0000000000c1'
             and target_user_id = '00000000-0000-0000-0000-0000000000c6'), 1,
  'AC-6: zmiana w audit_log, kto zmienił = dyżurny');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select array_agg(row(priority, item_name, entries_left)::text)
             from public.passes_for_range_entry('00000000-0000-0000-0000-0000000000c2')),
  array[row(1, 'Karnet 10 wejść', 10)::text], 'AC-7: dyżurny widzi ważne dziś uprawnienia osoby');

-- ===== Prowadzący wpisu, podpis, wpis (AC-2, AC-9, AC-10) =====

select is((select row(full_name, source)::text from public.current_range_duty()), row('Dariusz Dyżurny', 'book')::text,
  'AC-2: dyżurny odczytuje dzisiejszego dyżurnego (siebie)');
select ok((select array_agg(full_name) from public.range_officer_choices('00000000-0000-0000-0000-0000000000c2'))
            @> array['Adam Bezkonta', 'Dariusz Dyżurny'], 'AC-9: dyżurny widzi listę Prowadzących do wyboru');
select is((select array_agg(full_name) from public.staff_search_range_officers('bezkon')), array['Adam Bezkonta'],
  'AC-9: dyżurny wyszukuje Prowadzącego');
select lives_ok($$insert into storage.objects (bucket_id, name)
  values ('signatures', to_char(now(), 'YYYY/MM/') || '10000000-0000-0000-0000-000000000099.png')$$,
  'AC-10: dyżurny wysyła plik podpisu');
select is((select count(*)::int from storage.objects where bucket_id = 'signatures'), 0, 'AC-10: dyżurny nie czyta podpisów');
select is(pg_temp.entry('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1'),
  '10000000-0000-0000-0000-000000000001'::uuid, 'AC-10: dyżurny tworzy wpis');
select is((select row(full_name, source)::text from public.current_range_duty()), row('Dariusz Dyżurny', 'book')::text,
  'AC-9: wybór innego Prowadzącego przy wpisie nie zmienia dyżurnego');
reset role;
select is((select row(range_officer_id, range_officer_name, created_by)::text from public.range_log
            where id = '10000000-0000-0000-0000-000000000001'),
  row('00000000-0000-0000-0000-0000000000d1'::uuid, 'Adam Bezkonta', '00000000-0000-0000-0000-0000000000c1'::uuid)::text,
  'AC-9: wpis z wybranym Prowadzącym, created_by = dyżurny');
select is((select row(u.effect, p.entries_left)::text from public.pass_usages u join public.user_passes p on p.id = u.user_pass_id
            where u.range_log_entry_id = '10000000-0000-0000-0000-000000000001'),
  row('decremented', 9)::text, 'AC-10: zużycie uprawnienia jak dla Obsługi');

-- Wpis Obsługi (AC-11).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.entry('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1'),
  '10000000-0000-0000-0000-000000000002'::uuid, 'Obsługa nadal tworzy wpisy');

-- ===== Dzisiejsze wpisy i adnotacje (AC-11, AC-12) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select array_agg(id order by id) from public.range_log),
  array['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002']::uuid[],
  'AC-11: dyżurny widzi wszystkie dzisiejsze wpisy (także Obsługi), bez wczorajszych');
select lives_ok($$insert into public.range_log_annotations (entry_id, body)
  values ('10000000-0000-0000-0000-000000000002', 'Literówka w nazwisku')$$, 'AC-12: dyżurny dodaje adnotację do dzisiejszego wpisu');
select is((select row(body, created_by)::text from public.range_log_annotations),
  row('Literówka w nazwisku', '00000000-0000-0000-0000-0000000000c1'::uuid)::text, 'AC-11, AC-12: dyżurny widzi adnotację z autorem');
select throws_ok($$insert into public.range_log_annotations (entry_id, body) values ('10000000-0000-0000-0000-000000000002', 'abc')$$,
  '23514', null, 'AC-12: adnotacja 5–500 znaków');
select throws_ok($$insert into public.range_log_annotations (entry_id, body)
  values ('30000000-0000-0000-0000-000000000001', 'Poprawka wczoraj')$$, '42501', null,
  'AC-12: dyżurny nie dodaje adnotacji do wpisu z innego dnia');

-- ===== Bez odczytu tabel (AC-13) =====

select is((select count(*)::int from public.range_officers), 0, 'AC-13: dyżurny nie czyta range_officers');
select is((select count(*)::int from public.range_duty), 0, 'AC-13: dyżurny nie czyta range_duty');
select is((select count(*)::int from public.orders), 0, 'AC-13: dyżurny nie czyta cudzych orders');
select is((select count(*)::int from public.user_passes), 0, 'AC-13: dyżurny nie czyta cudzych user_passes');
select is((select count(*)::int from public.pass_usages), 0, 'AC-13: dyżurny nie czyta cudzych pass_usages');
select is((select array_agg(id) from public.profiles), array['00000000-0000-0000-0000-0000000000c1'::uuid],
  'AC-13: dyżurny czyta tylko własny profil');
select is((select count(*)::int from public.audit_log), 0, 'AC-13: dyżurny nie czyta audit_log');

-- ===== Bez zmiany dyżurnego, grafiku i sprzedaży (AC-4, AC-16) =====

select throws_ok($$select * from public.set_range_duty('00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden',
  'AC-16: dyżurny nie wywoła set_range_duty');
select throws_ok($$select public.set_scheduled_range_duty(public.range_today() + 1, '00000000-0000-0000-0000-0000000000e1')$$,
  '42501', 'forbidden', 'AC-4, AC-16: dyżurny nie ustawia grafiku');
select throws_ok($$select public.clear_scheduled_range_duty(public.range_today() + 1)$$, '42501', 'forbidden',
  'AC-4: dyżurny nie czyści grafiku');
select throws_ok($$select * from public.range_duty_schedule()$$, '42501', 'forbidden', 'AC-4: dyżurny nie czyta grafiku');
select throws_ok($$select public.review_range_officer('00000000-0000-0000-0000-0000000000e4', 'approve')$$, '42501', 'forbidden',
  'AC-4: dyżurny nie zatwierdza zgłoszeń');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f001', 'cash')$$,
  '42501', 'forbidden', 'AC-4: dyżurny nie sprzedaje na miejscu');
select throws_ok($$select * from public.staff_on_site_sales_today()$$, '42501', 'forbidden', 'AC-4: dyżurny nie widzi sprzedaży');
select throws_ok($$select * from public.admin_range_log('json')$$, '42501', 'forbidden', 'AC-4: dyżurny bez przeglądu książki');
select throws_ok($$select public.revert_pass_usage((select id from public.pass_usages limit 1))$$, '42501', 'forbidden',
  'SPEC-005 AC-23: dyżurny nie cofa zużycia');
reset role;
select is((select range_officer_id from public.range_duty where day = public.range_today() + 1),
  '00000000-0000-0000-0000-0000000000e3'::uuid, 'AC-16: grafik bez zmian');

-- ===== Ukrycie dla innych nie odbiera dostępu (§7) =====

update public.range_officers set hide_from_others = true where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.can_keep_range_log(), true, '§7: „Ukryj mnie dla innych” — dostęp bez zmian');

-- ===== Utrata dyżuru (AC-14) =====

reset role;
update public.range_officers set status = 'pending' where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.can_keep_range_log(), false, 'AC-14: zgłoszenie wróciło do pending — brak dostępu');
reset role;
update public.range_officers set status = 'approved', is_active = false where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.can_keep_range_log(), false, 'AC-14: prowadzący ukryty przez admina — brak dostępu');
reset role;
update public.range_officers set is_active = true where id = '00000000-0000-0000-0000-0000000000e1';

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select full_name from public.set_range_duty('00000000-0000-0000-0000-0000000000d1')), 'Adam Bezkonta',
  'AC-14: Obsługa zmienia dyżurnego');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.is_range_duty_officer(), false, 'AC-14: po zmianie dyżurnego — nie jest dyżurnym');
select throws_ok($$select * from public.staff_find_by_qr('qr-jan')$$, '42501', 'forbidden', 'AC-14: QR odrzucony');
select throws_ok($$select * from public.staff_search_people('kowal')$$, '42501', 'forbidden', 'AC-14: wyszukiwarka odrzucona');
select throws_ok($$select * from public.staff_person_by_id('00000000-0000-0000-0000-0000000000c2')$$, '42501', 'forbidden',
  'AC-14: osoba po identyfikatorze odrzucona');
select throws_ok($$select * from public.staff_person_entry_data('00000000-0000-0000-0000-0000000000c2')$$, '42501', 'forbidden',
  'AC-14: dane do wpisu odrzucone');
select throws_ok($$select * from public.staff_complete_profile('00000000-0000-0000-0000-0000000000c2', 'X')$$, '42501', 'forbidden',
  'AC-14: uzupełnienie danych odrzucone');
select throws_ok($$select * from public.passes_for_range_entry('00000000-0000-0000-0000-0000000000c2')$$, '42501', 'forbidden',
  'AC-14: uprawnienia osoby odrzucone');
select throws_ok($$select * from public.current_range_duty()$$, '42501', 'forbidden', 'AC-14: dyżurny dnia odrzucony');
select throws_ok($$select * from public.range_officer_choices()$$, '42501', 'forbidden', 'AC-14: lista Prowadzących odrzucona');
select throws_ok($$select * from public.staff_search_range_officers('bezkon')$$, '42501', 'forbidden',
  'AC-14: wyszukiwarka Prowadzących odrzucona');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('signatures', to_char(now(), 'YYYY/MM/') || '10000000-0000-0000-0000-000000000003.png')$$, '42501', null,
  'AC-14: upload podpisu odrzucony');
reset role;
select pg_temp.sig('10000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select * from public.create_range_log_entry('10000000-0000-0000-0000-000000000004',
    to_char(now(), 'YYYY/MM/') || '10000000-0000-0000-0000-000000000004.png', '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000c2', (select id from t where name = 'pass'))$$, '42501', 'forbidden',
  'AC-14: wpis odrzucony po zmianie dyżurnego');
select is((select count(*)::int from public.range_log), 0, 'AC-14: dawny dyżurny nie widzi dzisiejszych wpisów');
select is((select count(*)::int from public.range_log_annotations), 0, 'AC-14: dawny dyżurny nie widzi adnotacji');

-- ===== Tylko dziś, tylko z konta, tylko „na liście” (AC-15, §7) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select is(public.can_keep_range_log(), false, 'AC-15: dyżurny tylko jutro (grafik) — dziś brak dostępu');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c5');
select is(public.can_keep_range_log(), false, '§7: dyżurny bez konta — nikt nie ma dostępu z tego tytułu');
reset role;
insert into public.range_duty (day, source, range_officer_id) values
  (public.range_today(), 'schedule', '00000000-0000-0000-0000-0000000000e4');
delete from public.range_duty where day = public.range_today() and source = 'book';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select is(public.can_keep_range_log(), false, 'AC-3: zgłoszenie pending w grafiku — brak dostępu');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(public.can_keep_range_log(), true, 'Obsługa prowadzi książkę bez dyżuru');

set local role anon;
select throws_ok($$select public.is_range_duty_officer()$$, '42501', null, 'anon: bez is_range_duty_officer');

select * from finish();
rollback;
