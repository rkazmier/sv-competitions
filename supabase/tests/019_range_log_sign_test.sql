-- SPEC-005 AC-13: `staff_person_entry_data` — dane osoby na ekranie podpisu, tylko dla obsługi.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001d1', 'staff-019@example.test'),
  ('00000000-0000-0000-0000-0000000001d2', 'osoba-019@example.test');
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000001d1';
update public.profiles set full_name = 'Ewa Decyzja', permit_number = 'AB 123', permit_authority = 'KWP Katowice'
  where id = '00000000-0000-0000-0000-0000000001d2';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.staff_person_entry_data('00000000-0000-0000-0000-0000000001d2') $$,
  '42501', 'forbidden', 'AC-13: staff_person_entry_data — tylko obsługa');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select * from public.staff_person_entry_data('00000000-0000-0000-0000-0000000001d2') $$,
  $$ values ('Ewa Decyzja'::text, 'AB 123'::text, 'KWP Katowice'::text, null::text) $$,
  'AC-13: imię i nazwisko, decyzja i organ albo adres — to, co trafi do wpisu');
select is_empty($$ select * from public.staff_person_entry_data('00000000-0000-0000-0000-000000000999') $$,
  'AC-13: nieznana osoba → brak wierszy');
reset role;

select * from finish();
rollback;
