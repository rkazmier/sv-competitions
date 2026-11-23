-- SPEC-012 US-7 (AC-35…AC-39): godziny otwarcia — RLS, walidacja, wyjątki, nocne czyszczenie, lista dni blokady.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000040a1', 'hours-admin@example.test'),
  ('00000000-0000-0000-0000-0000000040c1', 'hours-client@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000040a1';

insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000040e0', 'Godziny');
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, blocks_passes, cancelled_at, cancel_reason) values
  ('00000000-0000-0000-0000-0000000040e1', 'Piknik G', '00000000-0000-0000-0000-0000000040e0', public.range_today() + 3, public.range_today() + 4, 'published', 'free', true, null, null),
  ('00000000-0000-0000-0000-0000000040e2', 'Poza strzelnicą G', '00000000-0000-0000-0000-0000000040e0', public.range_today() + 5, null, 'published', 'free', false, null, null),
  ('00000000-0000-0000-0000-0000000040e3', 'Odwołane G', '00000000-0000-0000-0000-0000000040e0', public.range_today() + 6, null, 'published', 'free', true, now(), 'Pogoda'),
  ('00000000-0000-0000-0000-0000000040e4', 'Za 40 dni G', '00000000-0000-0000-0000-0000000040e0', public.range_today() + 40, null, 'published', 'free', true, null, null);

-- AC-35, AC-39: admin zapisuje tydzień; walidacja w bazie.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000040a1","role":"authenticated"}', true);
select lives_ok($$ insert into public.opening_hours values (1, null, null), (6, '09:00', '15:00') $$,
  'AC-35: admin zapisuje „Zamknięte” i „Otwarte od–do”');
select lives_ok($$ update public.opening_hours set opens_at = '10:00', closes_at = '16:00' where weekday = 6 $$,
  'AC-35: admin zmienia godziny');
select throws_ok($$ insert into public.opening_hours values (2, '18:00', '10:00') $$, '23514', null,
  'AC-39: „Do” wcześniejsza niż „Od” — odrzucone');
select throws_ok($$ insert into public.opening_hours values (2, '10:00', '10:00') $$, '23514', null,
  'AC-39: „Do” równa „Od” — odrzucone');
select throws_ok($$ insert into public.opening_hours values (2, '10:00', null) $$, '23514', null,
  'AC-35: otwarte wymaga obu godzin');
select throws_ok($$ insert into public.opening_hours values (8, null, null) $$, '23514', null, 'AC-35: dni 1–7');
select throws_ok($$ insert into public.opening_hours values (1, '08:00', '12:00') $$, '23505', null,
  'AC-39: jeden przedział na dzień tygodnia');

-- AC-36: wyjątki (jeden na dzień, opis do 100 znaków).
select lives_ok($$ insert into public.opening_hours_exceptions values
  (public.range_today() + 1, null, null, 'Wigilia'),
  (public.range_today() - 30, '10:00', '12:00', null),
  (public.range_today() - 31, null, null, 'Stary') $$, 'AC-36: admin dodaje wyjątki');
select throws_ok($$ insert into public.opening_hours_exceptions values (public.range_today() + 2, null, null, repeat('x', 101)) $$,
  '23514', null, 'AC-36: opis najwyżej 100 znaków');
select throws_ok($$ insert into public.opening_hours_exceptions values (public.range_today() + 1, '10:00', '12:00', null) $$,
  '23505', null, 'AC-39: jeden wyjątek na dzień');

-- §5 RLS: klient i gość tylko czytają.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000040c1","role":"authenticated"}', true);
select throws_ok($$ insert into public.opening_hours values (3, '10:00', '12:00') $$, '42501', null, 'RLS: klient nie zapisuje godzin');
update public.opening_hours_exceptions set note = 'X';
reset role;
select is((select count(*)::int from public.opening_hours_exceptions where note = 'X'), 0, 'RLS: klient nie zmienia wyjątków');
set local role anon;
select is((select count(*)::int from public.opening_hours), 2, 'AC-37: gość czyta godziny');
select is((select count(*)::int from public.opening_hours_exceptions where day >= public.range_today()), 1, 'AC-37: gość czyta wyjątki');

-- AC-37: dni blokady na 30 dni — z flagą, opublikowane, nieodwołane.
select is(array(select name from public.range_blocked_between(public.range_today(), public.range_today() + 29)
                 where name like '% G'), array['Piknik G'], 'AC-37: lista dni blokady (bez odwołanych, bez flagi, w okresie)');
reset role;

-- AC-36: nocne zadanie usuwa wyjątki starsze niż 30 dni.
select is(public.purge_opening_hours_exceptions(), 1, 'AC-36: usunięto wyjątek sprzed 31 dni');
select is((select count(*)::int from public.opening_hours_exceptions), 2, 'AC-36: wyjątki z ostatnich 30 dni zostają');

select * from finish();
rollback;
