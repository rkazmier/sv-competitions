-- SPEC-003 US-4 (AC-16…AC-20): tryb wydarzenia, wolne miejsca, blokada zmian po sprzedaży wejściówek.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'ticket@example.test');
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000f1e0', 'Szkolenia T');
insert into public.calendar_events (id, name, category_id, starts_on, status, access_mode, ticket_price, capacity) values
  ('00000000-0000-0000-0000-00000000f1e1', 'Płatne', '00000000-0000-0000-0000-00000000f1e0', current_date + 5, 'published', 'paid', 5000, 3),
  ('00000000-0000-0000-0000-00000000f1e2', 'Bez limitu', '00000000-0000-0000-0000-00000000f1e0', current_date + 5, 'published', 'paid', 5000, null),
  ('00000000-0000-0000-0000-00000000f1e3', 'Szkic', '00000000-0000-0000-0000-00000000f1e0', current_date + 5, 'draft', 'paid', 5000, 3);

-- ===== AC-16: warunek publikacji =====

select lives_ok($$insert into public.calendar_events (name, category_id, starts_on, status, access_mode)
  values ('Otwarte', '00000000-0000-0000-0000-00000000f1e0', current_date, 'published', 'free')$$,
  'AC-16: bezpłatne opublikowane bez linku');
select throws_ok($$insert into public.calendar_events (name, category_id, starts_on, status, access_mode)
  values ('Zewn.', '00000000-0000-0000-0000-00000000f1e0', current_date, 'published', 'external')$$,
  '23514', null, 'AC-16: zewnętrzne wymaga linku do publikacji');
select throws_ok($$insert into public.calendar_events (name, category_id, starts_on, access_mode, capacity)
  values ('Płatne bez ceny', '00000000-0000-0000-0000-00000000f1e0', current_date, 'paid', 10)$$,
  '23514', null, 'AC-16: płatne wymaga ceny');
select throws_ok($$insert into public.calendar_events (name, category_id, starts_on, access_mode, ticket_price, capacity)
  values ('Za duży limit', '00000000-0000-0000-0000-00000000f1e0', current_date, 'paid', 100, 1001)$$,
  '23514', null, 'AC-16: limit miejsc 1–1000');

-- ===== AC-17, AC-18: event_seats_left =====

insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, status, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000f1e1', 'W', 5000, 'tpay', 'pending', now()),
  (null, '00000000-0000-0000-0000-00000000f1e1', 'W', 5000, 'tpay', 'pending', now() - interval '31 minutes'),
  (null, '00000000-0000-0000-0000-00000000f1e1', 'W', 5000, 'tpay', 'cancelled', now());

set local role anon;
select is(public.event_seats_left('00000000-0000-0000-0000-00000000f1e1'), 2,
  'AC-17, AC-18: gość widzi wolne miejsca; liczy się tylko świeże pending (30 min)');
select is(public.event_seats_left('00000000-0000-0000-0000-00000000f1e2'), null, 'AC-17: bez limitu → null');
select is(public.event_seats_left('00000000-0000-0000-0000-00000000f1e3'), null, 'AC-17: szkic nie zdradza danych');
reset role;

-- ===== AC-20: sprzedane wejściówki =====

select lives_ok($$update public.calendar_events set ticket_price = 6000 where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'AC-20: bez sprzedanych wejściówek cenę można zmienić');
update public.orders set status = 'paid', paid_at = now()
  where calendar_event_id = '00000000-0000-0000-0000-00000000f1e1' and status = 'pending' and user_id is not null;
insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, status, paid_at) values
  (null, '00000000-0000-0000-0000-00000000f1e1', 'W', 6000, 'tpay', 'paid', now());

set local role anon;
select is(public.event_seats_left('00000000-0000-0000-0000-00000000f1e1'), 1, 'AC-18: paid zajmuje miejsce');
reset role;
insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, status, created_at) values
  (null, '00000000-0000-0000-0000-00000000f1e1', 'W', 6000, 'tpay', 'pending', now());
select is(public.event_seats_left('00000000-0000-0000-0000-00000000f1e1'), 0, 'AC-18: limit osiągnięty → 0 (Wyprzedane)');

select throws_ok($$update public.calendar_events set access_mode = 'free' where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'P0001', 'event_has_tickets', 'AC-20: zmiana trybu zablokowana');
select throws_ok($$update public.calendar_events set ticket_price = 7000 where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'P0001', 'event_has_tickets', 'AC-20: zmiana ceny zablokowana');
select throws_ok($$delete from public.calendar_events where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'P0001', 'event_has_tickets', 'AC-20: usunięcie zablokowane');
select throws_ok($$update public.calendar_events set capacity = 1 where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'P0001', 'capacity_below_sold', 'AC-20: limit nie poniżej liczby sprzedanych (2)');
select lives_ok($$update public.calendar_events set name = 'Nowa nazwa', description = 'Opis', capacity = 2
  where id = '00000000-0000-0000-0000-00000000f1e1'$$, 'AC-20: nazwa, opis i limit ≥ sprzedanych — dozwolone');
select lives_ok($$update public.calendar_events set capacity = null where id = '00000000-0000-0000-0000-00000000f1e1'$$,
  'AC-20: zdjęcie limitu dozwolone');

select * from finish();
rollback;
