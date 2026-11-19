-- SPEC-007 US-5, AC-18, AC-21 (#117): `range_officer_choices` — lista wyboru Prowadzącego przy wpisie.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ukryta@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'czeka@example.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'widoczny@example.test');
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Hanna Ukryta' where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set full_name = 'Celina Czekająca' where id = '00000000-0000-0000-0000-0000000000c3';
update public.profiles set full_name = 'Wiktor Widoczny' where id = '00000000-0000-0000-0000-0000000000c4';

insert into public.range_officers (id, full_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Zofia Adminowa'),
  ('00000000-0000-0000-0000-0000000000d2', 'Adam Adminowy');
insert into public.range_officers (id, full_name, is_active) values
  ('00000000-0000-0000-0000-0000000000d3', 'Zenon Ukryty Przez Admina', false);
insert into public.range_officers (id, full_name, profile_id, license_number, institution, hide_from_others, status) values
  ('00000000-0000-0000-0000-0000000000e1', 'Hanna Ukryta', '00000000-0000-0000-0000-0000000000c2', '1', 'PZSS', true, 'approved'),
  ('00000000-0000-0000-0000-0000000000e2', 'Celina Czekająca', '00000000-0000-0000-0000-0000000000c3', '2', 'LOK', true, 'pending'),
  ('00000000-0000-0000-0000-0000000000e3', 'Wiktor Widoczny', '00000000-0000-0000-0000-0000000000c4', '3', 'PZSS', false, 'approved');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.choices(p_person uuid) returns text language sql as $$
  select string_agg(c.full_name || case when c.is_person then ' (osoba)' else '' end, ', ' order by c.ord)
    from public.range_officer_choices(p_person) with ordinality c(id, full_name, is_person, ord);
$$;
grant execute on all functions in schema pg_temp to public;

set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select * from public.range_officer_choices()$$, '42501', 'forbidden',
  'AC-18: lista wyboru tylko dla Obsługi i admina');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.choices(null), 'Adam Adminowy, Wiktor Widoczny, Zofia Adminowa',
  'AC-15, AC-18: bez osoby wpisywanej — widoczni na liście alfabetycznie; bez ukrytych, nieaktywnych i oczekujących');
select is(pg_temp.choices('00000000-0000-0000-0000-0000000000c2'),
  'Hanna Ukryta (osoba), Adam Adminowy, Wiktor Widoczny, Zofia Adminowa',
  'AC-18, AC-21: osoba wpisywana z zatwierdzonymi uprawnieniami pierwsza, także ukryta dla innych');
select is(pg_temp.choices('00000000-0000-0000-0000-0000000000c4'),
  'Wiktor Widoczny (osoba), Adam Adminowy, Zofia Adminowa',
  'AC-18: widoczna osoba wpisywana tylko raz — na początku');
select is(pg_temp.choices('00000000-0000-0000-0000-0000000000c3'), 'Adam Adminowy, Wiktor Widoczny, Zofia Adminowa',
  'AC-18: osoba wpisywana z zgłoszeniem `pending` nie trafia na listę (AC-5)');
select is(pg_temp.choices('00000000-0000-0000-0000-0000000000c1'), 'Adam Adminowy, Wiktor Widoczny, Zofia Adminowa',
  'AC-18: osoba wpisywana bez uprawnień — sama lista widocznych');

reset role;
update public.range_officers set is_active = false where id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.choices('00000000-0000-0000-0000-0000000000c2'), 'Adam Adminowy, Wiktor Widoczny, Zofia Adminowa',
  'AC-18: osoba wpisywana z usuniętymi uprawnieniami (AC-13) nie jest na liście');
select ok(not exists (select 1 from public.range_officer_choices(null) c where c.is_person),
  'AC-18: bez osoby wpisywanej żaden wiersz nie ma `is_person`');

reset role;
select * from finish();
rollback;
