-- SPEC-002 §3, ADR-0004: role user / staff / admin, funkcje is_staff() / is_admin(), alias is_organizer(),
-- Custom Access Token Hook (AC-19, AC-28).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';

insert into public.disciplines (id, name) values ('00000000-0000-0000-0000-00000000d001', 'Dyscyplina ról');
insert into public.competitions (name, discipline_id, starts_on, status) values
  ('Szkic ról', '00000000-0000-0000-0000-00000000d001', '2027-06-14', 'draft');

-- ===== AC-28: model ról po migracji =====

select col_default_is('public', 'profiles', 'role', 'user'::text, 'AC-28: domyślna rola to user');
select throws_ok(
  $$update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'AC-28: rola organizer już nie istnieje'
);
select throws_ok(
  $$update public.profiles set role = 'competitor' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'AC-28: rola competitor już nie istnieje'
);
select is(
  (select count(*)::int from public.profiles where role not in ('user', 'staff', 'admin')),
  0, 'AC-28: żaden profil nie ma dawnej roli'
);

-- ===== Custom Access Token Hook =====

create function pg_temp.claim(uid text) returns text language sql as $f$
  select public.custom_access_token_hook(jsonb_build_object('user_id', uid, 'claims', '{}'::jsonb)) -> 'claims' ->> 'app_role';
$f$;
select is(pg_temp.claim('00000000-0000-0000-0000-0000000000a1'), 'admin', 'hook: app_role = admin');
select is(pg_temp.claim('00000000-0000-0000-0000-0000000000b1'), 'staff', 'hook: app_role = staff');
select is(pg_temp.claim('00000000-0000-0000-0000-0000000000c1'), 'user', 'hook: app_role = user');
select is(pg_temp.claim('00000000-0000-0000-0000-0000000000ff'), 'user', 'hook: brak profilu → user');

-- ===== Admin (dawny organizator) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_admin(), true, 'admin: is_admin()');
select is(public.is_staff(), true, 'admin: is_staff() (admin ⊃ staff)');
select is(public.is_organizer(), true, 'AC-28: is_organizer() = is_admin() dla admina');
select is(
  (select count(*)::int from public.competitions where name = 'Szkic ról'), 1,
  'AC-28: admin widzi szkice jak dawny organizator'
);
select lives_ok(
  $$insert into public.disciplines (name) values ('Nowa przez admina')$$,
  'AC-28: admin zapisuje słowniki jak dawny organizator'
);
reset role;

-- ===== Obsługa strzelnicy =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_staff(), true, 'staff: is_staff()');
select is(public.is_admin(), false, 'staff: nie is_admin()');
select is(public.is_organizer(), false, 'staff: nie is_organizer() — bez kalendarza (decyzja 2-A)');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', null, 'AC-19: obsługa nie zmienia własnej roli'
);
select throws_ok(
  $$update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'AC-19: obsługa nie zmienia roli innego konta'
);
select is(
  (select count(*)::int from public.competitions where name = 'Szkic ról'), 0,
  'staff nie widzi szkiców kalendarza'
);
select throws_ok(
  $$insert into public.disciplines (name) values ('Nowa przez obsługę')$$,
  '42501', null, 'staff nie zapisuje słowników'
);
reset role;

-- ===== Użytkownik =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_staff(), false, 'user: nie is_staff()');
select is(public.is_admin(), false, 'user: nie is_admin()');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'AC-19: użytkownik nie zmienia własnej roli'
);
reset role;

-- ===== Gość =====

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(public.is_staff(), false, 'anon: nie is_staff()');
select is(public.is_admin(), false, 'anon: nie is_admin()');
reset role;

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'staff',
  'AC-19: rola obsługi niezmieniona po próbach'
);

select * from finish();
rollback;
