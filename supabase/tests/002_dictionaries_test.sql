begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'org@example.test');
update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000a1';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.disciplines (name) values ('Long Range')$$, 'organizator dodaje dyscyplinę');
select throws_ok(
  $$insert into public.disciplines (name) values ('long range ')$$,
  '23505', null,
  'AC-9: nazwa dyscypliny unikalna bez względu na wielkość liter i spacje'
);
select lives_ok($$insert into public.event_categories (name) values ('Szkolenie')$$, 'organizator dodaje kategorię');
select throws_ok(
  $$insert into public.event_categories (name) values (' szkolenie ')$$,
  '23505', null,
  'AC-46: nazwa kategorii unikalna bez względu na wielkość liter i spacje'
);

select throws_ok($$delete from public.disciplines$$, '42501', null, 'AC-11: dyscyplin nie da się usunąć');
select throws_ok($$delete from public.event_categories$$, '42501', null, 'AC-47: kategorii nie da się usunąć');

update public.disciplines set is_active = false where name = 'Long Range';
select is(
  (select is_active from public.disciplines where name = 'Long Range'), false,
  'AC-11: dyscyplinę można ukryć'
);

select * from finish();
rollback;
