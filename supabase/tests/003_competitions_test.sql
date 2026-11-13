begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'org@example.test');
update public.profiles set role = 'organizer' where id = '00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

insert into public.disciplines (id, name) values ('00000000-0000-0000-0000-00000000d001', 'Long Range');
insert into public.rulebooks (id, title, file_path, file_size)
  values ('00000000-0000-0000-0000-00000000b001', 'Regulamin LR', 'rulebooks/r1.pdf', 1000);

-- AC-18
select throws_ok(
  $$insert into public.competitions (name, discipline_id, starts_on, ends_on)
    values ('X', '00000000-0000-0000-0000-00000000d001', '2027-06-14', '2027-06-13')$$,
  '23514', null,
  'AC-18: data końca zawodów wcześniejsza niż początku jest odrzucana'
);

-- AC-26
select throws_ok(
  $$insert into public.competitions (name, discipline_id, starts_on, status)
    values ('X', '00000000-0000-0000-0000-00000000d001', '2027-06-14', 'published')$$,
  '23514', null,
  'AC-26: opublikowane zawody bez regulaminu są odrzucane'
);

-- AC-28: slug
insert into public.competitions (id, name, discipline_id, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000c001', 'Puchar Steel Valley – Łódź', '00000000-0000-0000-0000-00000000d001', '2027-06-14', '2027-06-15'),
  ('00000000-0000-0000-0000-00000000c002', 'Puchar Steel Valley – Łódź', '00000000-0000-0000-0000-00000000d001', '2027-06-14', null);

select is(
  (select slug from public.competitions where id = '00000000-0000-0000-0000-00000000c001'),
  '2027-06-14-puchar-steel-valley-lodz', 'AC-28: slug = data + nazwa bez polskich znaków'
);
select is(
  (select slug from public.competitions where id = '00000000-0000-0000-0000-00000000c002'),
  '2027-06-14-puchar-steel-valley-lodz-2', 'AC-28: sufiks -2 przy kolizji slug'
);

update public.competitions set name = 'Puchar Zimowy' where id = '00000000-0000-0000-0000-00000000c001';
select is(
  (select slug from public.competitions where id = '00000000-0000-0000-0000-00000000c001'),
  '2027-06-14-puchar-zimowy', 'AC-28: slug szkicu przeliczany przy zapisie'
);

update public.competitions set status = 'published', rulebook_id = '00000000-0000-0000-0000-00000000b001'
  where id = '00000000-0000-0000-0000-00000000c001';
select isnt(
  (select published_at from public.competitions where id = '00000000-0000-0000-0000-00000000c001'), null,
  'AC-25: publikacja ustawia published_at'
);

update public.competitions set name = 'Inna nazwa', starts_on = '2027-06-13'
  where id = '00000000-0000-0000-0000-00000000c001';
update public.competitions set status = 'draft', name = 'Jeszcze inna'
  where id = '00000000-0000-0000-0000-00000000c001';
select is(
  (select slug from public.competitions where id = '00000000-0000-0000-0000-00000000c001'),
  '2027-06-14-puchar-zimowy', 'AC-28: slug nie zmienia się po pierwszej publikacji'
);

-- AC-22: harmonogram (zawody c001: 13–15.06.2027)
select throws_ok(
  $$insert into public.schedule_items (competition_id, day, description)
    values ('00000000-0000-0000-0000-00000000c001', '2027-06-16', 'Po zawodach')$$,
  '23514', 'schedule_item_day_out_of_range',
  'AC-22: punkt harmonogramu poza terminem zawodów jest odrzucany'
);
select lives_ok(
  $$insert into public.schedule_items (competition_id, day, "time", description)
    values ('00000000-0000-0000-0000-00000000c001', '2027-06-15', '08:00', 'Rejestracja')$$,
  'AC-21: punkt harmonogramu w terminie zawodów jest zapisywany'
);
select throws_ok(
  $$update public.competitions set ends_on = null where id = '00000000-0000-0000-0000-00000000c001'$$,
  '23514', 'schedule_item_day_out_of_range',
  'AC-22: zmiana dat zawodów wyrzucająca punkty poza termin jest blokowana'
);

-- AC-15
select throws_ok(
  $$delete from public.rulebooks where id = '00000000-0000-0000-0000-00000000b001'$$,
  '23503', null,
  'AC-15: regulaminu używanego przez zawody nie da się usunąć'
);

-- AC-23
update public.competitions set status = 'published', rulebook_id = '00000000-0000-0000-0000-00000000b001'
  where id = '00000000-0000-0000-0000-00000000c002';
delete from public.competitions where id = '00000000-0000-0000-0000-00000000c002';
select is(
  (select count(*)::int from public.competitions where id = '00000000-0000-0000-0000-00000000c002'), 1,
  'AC-23: opublikowanych zawodów nie da się usunąć'
);
delete from public.competitions where id = '00000000-0000-0000-0000-00000000c001';
select is(
  (select count(*)::int from public.competitions where id = '00000000-0000-0000-0000-00000000c001'), 0,
  'AC-23: szkic zawodów jest usuwany'
);
select is(
  (select count(*)::int from public.schedule_items where competition_id = '00000000-0000-0000-0000-00000000c001'), 0,
  'AC-23: usunięcie szkicu usuwa harmonogram (kaskada)'
);

-- AC-16
select throws_ok(
  $$update public.rulebooks set file_path = 'rulebooks/other.pdf'$$,
  '23514', 'rulebook_file_immutable',
  'AC-16: plik regulaminu jest niezmienny'
);

select * from finish();
rollback;
