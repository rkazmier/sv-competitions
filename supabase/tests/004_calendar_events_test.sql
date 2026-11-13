begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'org@example.test');
update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000e001', 'Szkolenie');

select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, ends_on)
    values ('X', '00000000-0000-0000-0000-00000000e001', '2027-06-14', '2027-06-13')$$,
  '23514', null,
  'AC-49: data końca wydarzenia wcześniejsza niż początku jest odrzucana'
);
select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, external_url)
    values ('X', '00000000-0000-0000-0000-00000000e001', '2027-06-14', 'javascript:alert(1)')$$,
  '23514', null,
  'AC-50: link javascript: jest odrzucany'
);
select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, external_url)
    values ('X', '00000000-0000-0000-0000-00000000e001', '2027-06-14', 'www.example.com')$$,
  '23514', null,
  'AC-50: link bez http(s):// jest odrzucany'
);
select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, external_url)
    values ('X', '00000000-0000-0000-0000-00000000e001', '2027-06-14', 'https://example.com/' || repeat('a', 1981))$$,
  '23514', null,
  'AC-50: link dłuższy niż 2000 znaków jest odrzucany'
);
select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, status)
    values ('X', '00000000-0000-0000-0000-00000000e001', '2027-06-14', 'published')$$,
  '23514', null,
  'AC-51: opublikowane wydarzenie bez linku jest odrzucane'
);

insert into public.calendar_events (id, name, category_id, starts_on, external_url)
  values ('00000000-0000-0000-0000-00000000f001', 'Szkolenie', '00000000-0000-0000-0000-00000000e001', '2027-06-14',
          'https://example.com/' || repeat('a', 1980));
update public.calendar_events set status = 'published' where id = '00000000-0000-0000-0000-00000000f001';
select isnt(
  (select published_at from public.calendar_events where id = '00000000-0000-0000-0000-00000000f001'), null,
  'AC-51: publikacja wydarzenia z linkiem (2000 znaków) ustawia published_at'
);

delete from public.calendar_events where id = '00000000-0000-0000-0000-00000000f001';
select is(
  (select count(*)::int from public.calendar_events), 0,
  'AC-52: organizator usuwa wydarzenie w dowolnym stanie'
);

select * from finish();
rollback;
