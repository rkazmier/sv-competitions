-- SPEC-002 US-4, US-5: panel admina — e-mail na karcie użytkownika, historia zmian (AC-20, AC-21).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test');
update public.profiles set role = 'admin', full_name = 'Anna Admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';

create function pg_temp.as_user(uid text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$f$;

set local role authenticated;

-- ===== admin_user_email: tylko admin =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$select public.admin_user_email('00000000-0000-0000-0000-0000000000c1')$$,
  '42501', null, 'admin_user_email: użytkownik odrzucony'
);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$select public.admin_user_email('00000000-0000-0000-0000-0000000000c1')$$,
  '42501', null, 'admin_user_email: obsługa odrzucona'
);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(
  public.admin_user_email('00000000-0000-0000-0000-0000000000c1'), 'user@example.test',
  'AC-20: admin widzi e-mail użytkownika z auth.users'
);

-- ===== AC-20, AC-21: zmiany admina w historii użytkownika, od najnowszych, z imieniem i nazwiskiem autora =====

update public.profiles set full_name = 'Jan Kowalski' where id = '00000000-0000-0000-0000-0000000000c1';
select public.set_user_role('00000000-0000-0000-0000-0000000000c1', 'staff');
-- Kolejność po created_at (w jednej transakcji now() jest stałe) — rozróżniamy wpisy czasem.
reset role;
update public.audit_log set created_at = created_at - interval '1 minute' where action = 'profile_update';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$select action from public.audit_log
    where target_user_id = '00000000-0000-0000-0000-0000000000c1' order by created_at desc, id desc$$,
  array['role_change', 'profile_update'],
  'AC-21: historia zmian użytkownika od najnowszych'
);
select is(
  (select changes from public.audit_log
   where target_user_id = '00000000-0000-0000-0000-0000000000c1' and action = 'profile_update'),
  '{"full_name": [null, "Jan Kowalski"]}'::jsonb,
  'AC-20: wpis zawiera zmienione pole ze starą i nową wartością'
);
select is(
  (select p.full_name from public.audit_log l join public.profiles p on p.id = l.actor_id
   where l.target_user_id = '00000000-0000-0000-0000-0000000000c1' and l.action = 'role_change'),
  'Anna Admin',
  'AC-21: admin odczyta autora zmiany (kto) z profiles'
);

select * from finish();
rollback;
