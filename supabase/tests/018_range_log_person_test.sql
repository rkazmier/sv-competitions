-- SPEC-005 AC-7, AC-8: `staff_person_by_id` i `staff_complete_profile` — tylko obsługa, tylko brakujące pola,
-- walidacja jak SPEC-002 (AC-8, AC-11), wpis `profile_update` w `audit_log` z obsługą jako aktorem.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001b1', 'staff-018@example.test'),
  ('00000000-0000-0000-0000-0000000001c1', 'braki-018@example.test'),
  ('00000000-0000-0000-0000-0000000001c2', 'pelny-018@example.test'),
  ('00000000-0000-0000-0000-0000000001c3', 'user-018@example.test');
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000001b1';
update public.profiles set full_name = 'Anna Pełna', address = 'ul. Stalowa 1, Katowice'
  where id = '00000000-0000-0000-0000-0000000001c2';

-- Użytkownik bez roli obsługi: brak dostępu.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001c3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.staff_person_by_id('00000000-0000-0000-0000-0000000001c2') $$,
  '42501', 'forbidden', 'AC-8: staff_person_by_id — tylko obsługa');
select throws_ok($$ select * from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c1', 'Jan Nowy') $$,
  '42501', 'forbidden', 'AC-7: staff_complete_profile — tylko obsługa');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001b1","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select full_name, is_range_ready, missing_fields from public.staff_person_by_id('00000000-0000-0000-0000-0000000001c2') $$,
  $$ values ('Anna Pełna'::text, true, '{}'::text[]) $$,
  'AC-8: osoba po identyfikatorze — minimum danych, gotowa');
select results_eq(
  $$ select is_range_ready, missing_fields from public.staff_person_by_id('00000000-0000-0000-0000-0000000001c1') $$,
  $$ values (false, '{full_name,permit_or_address}'::text[]) $$,
  'AC-7: lista braków osoby');
select is_empty($$ select * from public.staff_person_by_id('00000000-0000-0000-0000-000000000999') $$,
  'AC-8: nieznana osoba → brak wierszy');

-- Obsługa nie zmienia profilu bezpośrednio (RLS), tylko funkcją.
update public.profiles set full_name = 'Obejście RLS' where id = '00000000-0000-0000-0000-0000000001c1';
select is((select full_name from public.staff_person_by_id('00000000-0000-0000-0000-0000000001c1')), null,
  'AC-7: bez bezpośredniego update profiles dla obsługi');

select throws_ok(
  $$ select * from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c1', 'Jan Nowy', 'AB 1', null, null) $$,
  '23514', 'permit_pair', 'AC-7: numer decyzji bez organu → odrzucone (SPEC-002 AC-8)');
select throws_ok(
  $$ select * from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c1', 'J', null, null, null) $$,
  '23514', null, 'AC-7: imię i nazwisko krótsze niż 2 znaki → odrzucone (SPEC-002 AC-11)');
select throws_ok(
  $$ select * from public.staff_complete_profile('00000000-0000-0000-0000-000000000999', 'Jan Nowy') $$,
  'P0002', 'person_not_found', 'AC-7: nieznana osoba');

select results_eq(
  $$ select full_name, is_range_ready, missing_fields
     from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c1', '  Jan Nowy ', null, null, null) $$,
  $$ values ('Jan Nowy'::text, false, '{permit_or_address}'::text[]) $$,
  'AC-7: częściowe uzupełnienie — nadal brak decyzji lub adresu');
select results_eq(
  $$ select is_range_ready, missing_fields
     from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c1', null, 'AB 123', 'KWP Katowice', '') $$,
  $$ values (true, '{}'::text[]) $$,
  'AC-7: komplet danych → gotowy do wpisu');

-- Istniejących wartości funkcja nie nadpisuje.
select results_eq(
  $$ select full_name from public.staff_complete_profile('00000000-0000-0000-0000-0000000001c2', 'Inna Osoba', 'X 1', 'KWP', 'Inny adres 5') $$,
  $$ values ('Anna Pełna'::text) $$,
  'AC-7: istniejące dane bez zmian');
reset role;

select results_eq(
  $$ select full_name, permit_number, permit_authority, address from public.profiles
     where id = '00000000-0000-0000-0000-0000000001c1' $$,
  $$ values ('Jan Nowy'::text, 'AB 123'::text, 'KWP Katowice'::text, null::text) $$,
  'AC-7: profil zaktualizowany');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000001c2'
           and permit_number is null and address = 'ul. Stalowa 1, Katowice'), 1,
  'AC-7: pełny profil bez zmian');

select is((select count(*)::int from public.audit_log where target_user_id = '00000000-0000-0000-0000-0000000001c1'
           and action = 'profile_update' and actor_id = '00000000-0000-0000-0000-0000000001b1'), 2,
  'AC-7: każde uzupełnienie → audit_log profile_update, aktor = obsługa');
select is((select changes -> 'full_name' from public.audit_log where target_user_id = '00000000-0000-0000-0000-0000000001c1'
           and changes ? 'full_name'), '[null, "Jan Nowy"]'::jsonb,
  'AC-7: audit_log — stara i nowa wartość');
select is((select count(*)::int from public.audit_log where target_user_id = '00000000-0000-0000-0000-0000000001c2'), 0,
  'AC-7: brak zmian → brak wpisu w audit_log');

select * from finish();
rollback;
