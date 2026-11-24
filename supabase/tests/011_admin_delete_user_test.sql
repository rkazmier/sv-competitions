-- SPEC-002 US-6: usunięcie konta przez admina (AC-24, AC-25). Edge Function `admin-delete-user` woła
-- `admin_log_account_delete` z JWT admina, potem `auth.admin.deleteUser` (tu: delete z auth.users).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff2@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'user2@example.test');
update public.profiles set role = 'admin', full_name = 'Anna Admin' where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set full_name = 'Jan Usuwany', phone = '600100200' where id = '00000000-0000-0000-0000-0000000000c2';
insert into public.products (id, kind, name, price, entries, day_type) values
  ('00000000-0000-0000-0000-00000000f101', 'entries', 'Karnet 10 wejść', 120000, 10, null);
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, created_by) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-00000000f101', 'Karnet 10 wejść', 120000, 'tpay', '00000000-0000-0000-0000-0000000000c2');

create function pg_temp.as_user(uid text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$f$;

set local role authenticated;

-- ===== Tylko admin =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok(
  $$select public.admin_log_account_delete('00000000-0000-0000-0000-0000000000b2')$$,
  '42501', null, 'AC-24: użytkownik nie usunie konta'
);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$select public.admin_log_account_delete('00000000-0000-0000-0000-0000000000c2')$$,
  '42501', null, 'AC-24: obsługa nie usunie konta'
);

-- ===== AC-25: nie własne konto; nieistniejące konto =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$select public.admin_log_account_delete('00000000-0000-0000-0000-0000000000a2')$$,
  'P0001', 'own_account', 'AC-25: admin nie usunie własnego konta'
);
select throws_ok(
  $$select public.admin_log_account_delete('00000000-0000-0000-0000-0000000000ff')$$,
  'P0002', 'not_found', 'AC-24: nieistniejące konto — not_found'
);
select is(
  (select count(*)::int from public.audit_log where action = 'account_delete'), 0,
  'AC-24: odrzucone próby nie zostawiają wpisów'
);

-- ===== AC-24: wpis account_delete bez danych osobowych =====

select isnt(
  public.admin_log_account_delete('00000000-0000-0000-0000-0000000000c2'), null,
  'AC-24: admin zapisuje wpis account_delete'
);
select results_eq(
  $$select actor_id, target_user_id, changes from public.audit_log where action = 'account_delete'$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid, null::jsonb)$$,
  'AC-24: wpis ma autora i identyfikator konta, changes = null'
);

-- ===== AC-24: usunięcie z auth.users (jak auth.admin.deleteUser) =====

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c2';

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 0,
  'AC-24: profiles znika (kaskada)'
);
select is(
  (select user_id from public.orders where id = '00000000-0000-0000-0000-00000000d001'), null,
  'AC-24: zamówienie zostaje, user_id = null'
);
select is(
  (select created_by from public.orders where id = '00000000-0000-0000-0000-00000000d001'), null,
  'AC-24: created_by = null'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'account_delete' and target_user_id = '00000000-0000-0000-0000-0000000000c2'), 1,
  'AC-24: wpis account_delete przetrwał usunięcie konta'
);

-- ===== Autor wpisu usunięty → actor_id = null, wpis zostaje =====

delete from auth.users where id = '00000000-0000-0000-0000-0000000000a2';
select is(
  (select actor_id from public.audit_log where action = 'account_delete'), null,
  'AC-24: usunięcie autora zostawia wpis z actor_id = null'
);

select * from finish();
rollback;
