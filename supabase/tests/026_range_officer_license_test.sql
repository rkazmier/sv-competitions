-- SPEC-005 AC-1, AC-1a (#104): nr legitymacji i instytucja prowadzącego strzelanie.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.range_officers (full_name, license_number, institution)
  values ('Anna Nowak', '123/2024', 'PZSS')$$, 'AC-1: admin dodaje prowadzącego z nr legitymacji i instytucją');
select lives_ok($$insert into public.range_officers (full_name, license_number, institution, institution_other)
  values ('Jan Inny', '77', 'OTHER', 'Klub ABC')$$, 'AC-1: „Inne” z nazwą instytucji');
select lives_ok($$insert into public.range_officers (full_name) values ('Stary Prowadzący')$$,
  'AC-1a: prowadzący bez danych (sprzed #104) dopuszczony w bazie');
select lives_ok($$update public.range_officers set license_number = '9', institution = 'LOK' where full_name = 'Stary Prowadzący'$$,
  'AC-1a: admin uzupełnia nr legitymacji i instytucję');
select is((select institution from public.range_officers where full_name = 'Stary Prowadzący'), 'LOK', 'AC-1a: zapisana instytucja');

select throws_ok($$insert into public.range_officers (full_name, license_number, institution) values ('X Y', '1', 'PZŁ')$$,
  '23514', null, 'AC-1: tylko kody PZSS, LOK, PZL, OTHER');
select throws_ok($$insert into public.range_officers (full_name, license_number) values ('X Y', '1')$$,
  '23514', null, 'AC-1: nr legitymacji tylko z instytucją');
select throws_ok($$insert into public.range_officers (full_name, license_number, institution) values ('X Y', '1', 'OTHER')$$,
  '23514', null, 'AC-1: „Inne” wymaga nazwy instytucji');
select throws_ok($$insert into public.range_officers (full_name, license_number, institution, institution_other) values ('X Y', '1', 'PZSS', 'Klub')$$,
  '23514', null, 'AC-1: nazwa instytucji tylko przy „Inne”');
select throws_ok($$insert into public.range_officers (full_name, license_number, institution) values ('X Y', ' 1 ', 'PZSS')$$,
  '23514', null, 'AC-1: nr legitymacji bez spacji na brzegach');
reset role;

select hasnt_column('public', 'range_log', 'range_officer_license_number', 'AC-1a: nr legitymacji nie trafia do wpisów książki');

select * from finish();
rollback;
