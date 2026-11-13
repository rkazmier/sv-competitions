-- AC-37: anon i competitor widzą tylko opublikowane dane i nic nie zapisują; organizator widzi i zapisuje wszystko.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Izolacja od supabase/seed.sql: test liczy wiersze; usunięcie cofa `rollback` na końcu.
delete from public.schedule_items;
delete from public.competitions;
delete from public.calendar_events;
delete from public.rulebooks;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'org@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comp@example.test');
update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.disciplines (id, name) values ('00000000-0000-0000-0000-00000000d001', 'Long Range');
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000e001', 'Szkolenie');
insert into public.rulebooks (id, title, file_path, file_size) values
  ('00000000-0000-0000-0000-00000000b001', 'Używany', 'rulebooks/used.pdf', 1000),
  ('00000000-0000-0000-0000-00000000b002', 'Nieużywany', 'rulebooks/unused.pdf', 1000);
insert into public.competitions (id, name, discipline_id, starts_on, rulebook_id, status) values
  ('00000000-0000-0000-0000-00000000c001', 'Opublikowane', '00000000-0000-0000-0000-00000000d001', '2027-06-14',
   '00000000-0000-0000-0000-00000000b001', 'published'),
  ('00000000-0000-0000-0000-00000000c002', 'Szkic', '00000000-0000-0000-0000-00000000d001', '2027-06-14', null, 'draft');
insert into public.schedule_items (competition_id, day, description) values
  ('00000000-0000-0000-0000-00000000c001', '2027-06-14', 'Rejestracja'),
  ('00000000-0000-0000-0000-00000000c002', '2027-06-14', 'Rejestracja');
insert into public.calendar_events (name, category_id, starts_on, external_url, status) values
  ('Opublikowane', '00000000-0000-0000-0000-00000000e001', '2027-06-14', 'https://example.com', 'published'),
  ('Szkic', '00000000-0000-0000-0000-00000000e001', '2027-06-14', null, 'draft');

-- Wspólne sprawdzenia dla roli bez uprawnień organizatora.
create function pg_temp.check_public(who text) returns setof text language plpgsql as $f$
begin
  return next is((select count(*)::int from public.competitions), 1, 'AC-37: ' || who || ' widzi tylko opublikowane zawody');
  return next is((select count(*)::int from public.calendar_events), 1, 'AC-37: ' || who || ' widzi tylko opublikowane wydarzenia');
  return next is((select count(*)::int from public.schedule_items), 1, 'AC-37: ' || who || ' widzi harmonogram tylko opublikowanych zawodów');
  return next is((select title from public.rulebooks), 'Używany', 'AC-37: ' || who || ' nie widzi nieużywanych regulaminów');
  return next throws_ok('select created_by from public.competitions', '42501', null, who || ' nie dostaje created_by zawodów');
  return next throws_ok('select created_by from public.calendar_events', '42501', null, who || ' nie dostaje created_by wydarzeń');
  return next throws_ok('select created_by from public.rulebooks', '42501', null, who || ' nie dostaje created_by regulaminów');
  return next throws_ok($$insert into public.disciplines (name) values ('Nowa')$$, '42501', null, 'AC-37: ' || who || ' nie dodaje dyscyplin');
  return next throws_ok(
    $$insert into public.calendar_events (name, category_id, starts_on) values ('X', '00000000-0000-0000-0000-00000000e001', '2027-01-01')$$,
    '42501', null, 'AC-37: ' || who || ' nie dodaje wydarzeń');
  update public.competitions set name = 'Zmienione';
  update public.disciplines set name = 'Zmienione';
  delete from public.calendar_events;
  return next throws_ok(
    $$insert into storage.objects (bucket_id, name) values ('documents', 'rulebooks/x.pdf')$$,
    '42501', null, 'AC-37: ' || who || ' nie wczytuje plików');
end;
$f$;

set local role anon;
select * from pg_temp.check_public('anon');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select * from pg_temp.check_public('competitor');
reset role;

select is(
  (select count(*)::int from public.competitions where name = 'Zmienione')
    + (select count(*)::int from public.disciplines where name = 'Zmienione')
    + 2 - (select count(*)::int from public.calendar_events),
  0, 'AC-37: anon i competitor nic nie zmienili ani nie usunęli'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.competitions), 2, 'AC-37: organizator widzi wszystkie zawody');
select is((select count(*)::int from public.calendar_events), 2, 'AC-37: organizator widzi wszystkie wydarzenia');
select is((select count(*)::int from public.schedule_items), 2, 'AC-37: organizator widzi cały harmonogram');
select is((select count(*)::int from public.rulebooks), 2, 'AC-37: organizator widzi wszystkie regulaminy');
select lives_ok(
  $$update public.competitions set name = 'Zmienione' where id = '00000000-0000-0000-0000-00000000c002'$$,
  'AC-37: organizator zapisuje zawody'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('documents', 'rulebooks/x.pdf')$$,
  'organizator wczytuje plik do documents/rulebooks/'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('documents', 'inne/x.pdf')$$,
  '42501', null, 'pliki tylko w rulebooks/ i matchbooks/'
);

select * from finish();
rollback;
