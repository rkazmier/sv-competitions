begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'org@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comp@example.test');

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'competitor',
  'AC-7: nowe konto dostaje profil z rolą competitor'
);

update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000a1';

select is(
  public.custom_access_token_hook('{"user_id":"00000000-0000-0000-0000-0000000000a1","claims":{}}')
    -> 'claims' ->> 'app_role',
  'organizer',
  'Custom Access Token Hook dodaje claim app_role'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  'select id from public.profiles',
  $$values ('00000000-0000-0000-0000-0000000000c1'::uuid)$$,
  'competitor widzi tylko własny profil'
);
select throws_ok(
  $$update public.profiles set role = 'organizer'$$,
  '42501', null,
  'competitor nie może nadać sobie roli'
);
select is(public.is_organizer(), false, 'is_organizer() = false dla competitor');

select * from finish();
rollback;
