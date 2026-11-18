-- SPEC-003 AC-8, AC-9, AC-18, §7: funkcje bazy dla payments-create i payments-notify (ADR-0002).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@example.test');

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10),
  ('00000000-0000-0000-0000-00000000f002', 'entries', 'Karnet 5 wejść', 65000, 5);
update public.products set is_active = true where id = '00000000-0000-0000-0000-00000000f001';
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000f0e0', 'Szkolenia SV');
insert into public.calendar_events
  (id, name, category_id, starts_on, ends_on, status, external_url, access_mode, ticket_price, capacity) values
  ('00000000-0000-0000-0000-00000000f0e1', 'Szkolenie', '00000000-0000-0000-0000-00000000f0e0',
   current_date + 10, current_date + 11, 'published', 'https://example.test', 'paid', 5000, 2),
  ('00000000-0000-0000-0000-00000000f0e2', 'Minione', '00000000-0000-0000-0000-00000000f0e0',
   current_date - 5, current_date - 2, 'published', 'https://example.test', 'paid', 5000, null),
  ('00000000-0000-0000-0000-00000000f0e3', 'Zewnętrzne', '00000000-0000-0000-0000-00000000f0e0',
   current_date + 10, null, 'published', 'https://example.test', 'external', null, null);

create function pg_temp.product_order(p_user uuid, p_product uuid, p_key uuid) returns jsonb language sql as $$
  select public.create_tpay_order(p_user, p_product, null, p_key);
$$;
create function pg_temp.ticket(p_key uuid) returns jsonb language sql as $$
  select public.create_tpay_order('00000000-0000-0000-0000-0000000000c1', null, '00000000-0000-0000-0000-00000000f0e1', p_key);
$$;

-- ===== Model wejściówek (§5) =====

select throws_ok(
  $$insert into public.calendar_events (name, category_id, starts_on, access_mode)
    values ('Bez ceny', '00000000-0000-0000-0000-00000000f0e0', current_date, 'paid')$$,
  '23514', null, '§5: wydarzenie płatne wymaga ceny wejściówki');
select is((select access_mode from public.calendar_events where id = '00000000-0000-0000-0000-00000000f0e3'), 'external',
  '§5: tryb domyślny `external`');
set local role anon;
select lives_ok($$select access_mode, ticket_price, capacity from public.calendar_events$$,
  '§5: tryb, cena i limit widoczne publicznie');
reset role;

-- ===== Uprawnienia: tylko klucz secret =====

set local role authenticated;
select throws_ok($$select public.create_tpay_order('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-00000000f001', null, gen_random_uuid())$$, '42501', null,
  'AC-8: klient nie tworzy zamówienia Tpay z pominięciem payments-create');
select throws_ok($$select public.process_tpay_notification('h', 'TR', gen_random_uuid(), 1, 1, true)$$, '42501', null,
  'AC-9: klient nie realizuje płatności');
select throws_ok($$select public.attach_tpay_transaction(gen_random_uuid(), 'x', 'TR')$$, '42501', null,
  'AC-8: klient nie przypisuje transakcji');
select throws_ok($$select public.discard_tpay_order(gen_random_uuid())$$, '42501', null,
  '§7: klient nie usuwa zamówień');
reset role;

-- ===== AC-8: create_tpay_order (jako service_role) =====

set local role service_role;
create temp table t (name text primary key, id uuid);
insert into t select 'o1', (pg_temp.product_order('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000aaa1') ->> 'order_id')::uuid;

select results_eq(
  $$select status, amount, item_name, payment_method, user_id::text from public.orders where id = (select id from t where name = 'o1')$$,
  $$values ('pending', 120000, 'Karnet 10 wejść', 'tpay', '00000000-0000-0000-0000-0000000000c1')$$,
  'AC-8: zamówienie `pending` z ceną i nazwą z bazy');
select is(pg_temp.product_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001',
  '00000000-0000-0000-0000-00000000aaa1'),
  jsonb_build_object('order_id', (select id from t where name = 'o1'),
                     'order_number', (select order_number from public.orders where id = (select id from t where name = 'o1')),
                     'amount', 120000,
                     'item_name', 'Karnet 10 wejść', 'duplicate', true),
  '§7: ten sam klucz żądania → to samo zamówienie (`duplicate`)');
select is((select count(*) from public.orders where user_id = '00000000-0000-0000-0000-0000000000c1')::int, 1,
  '§7: podwójne kliknięcie → jedno zamówienie');
select is((pg_temp.product_order('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f001',
  '00000000-0000-0000-0000-00000000aaa1') ->> 'duplicate')::boolean, false,
  '§7: klucz idempotencji osobny dla każdego konta');
select throws_ok($$select pg_temp.product_order('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-00000000f002', gen_random_uuid())$$, 'P0001', 'product_unavailable',
  '§6: produkt ukryty — „Ten produkt nie jest już dostępny.”');
select throws_ok($$select pg_temp.product_order('00000000-0000-0000-0000-0000000000c1', null, gen_random_uuid())$$,
  '22023', 'invalid_request', 'AC-8: bez produktu i wydarzenia — odrzucone');

-- ===== AC-18: limit miejsc, AC-19: sprzedaż zamknięta =====

select is(pg_temp.ticket(gen_random_uuid()) ->> 'item_name', 'Wejściówka: Szkolenie', 'AC-8: wejściówka „Wejściówka: <nazwa>”');
select is((select amount from public.orders where calendar_event_id = '00000000-0000-0000-0000-00000000f0e1'), 5000,
  'AC-8: cena wejściówki z wydarzenia');
insert into t values ('t2', (pg_temp.ticket(gen_random_uuid()) ->> 'order_id')::uuid);
select throws_ok($$select pg_temp.ticket(gen_random_uuid())$$, 'P0001', 'sold_out',
  'AC-18: paid + pending młodsze niż 30 min = limit → `sold_out`');
update public.orders set created_at = now() - interval '31 minutes' where id = (select id from t where name = 't2');
select lives_ok($$select pg_temp.ticket(gen_random_uuid())$$, 'AC-18: pending starsze niż 30 min nie blokuje miejsca');
select throws_ok($$select pg_temp.ticket(gen_random_uuid())$$, 'P0001', 'sold_out', 'AC-18: limit znów osiągnięty');
update public.orders set status = 'cancelled' where calendar_event_id = '00000000-0000-0000-0000-00000000f0e1'
  and id <> (select id from t where name = 't2') and created_at = now();
select lives_ok($$select pg_temp.ticket(gen_random_uuid())$$, 'AC-18: anulowane nie zajmują miejsc');
select throws_ok($$select public.create_tpay_order('00000000-0000-0000-0000-0000000000c1', null,
  '00000000-0000-0000-0000-00000000f0e2', gen_random_uuid())$$, 'P0001', 'sales_closed',
  'AC-19: po ostatnim dniu wydarzenia sprzedaż zamknięta');
select throws_ok($$select public.create_tpay_order('00000000-0000-0000-0000-0000000000c1', null,
  '00000000-0000-0000-0000-00000000f0e3', gen_random_uuid())$$, 'P0001', 'event_unavailable',
  'AC-18: wydarzenie bez trybu płatnego — brak sprzedaży');

-- ===== AC-8 / §7: transakcja Tpay, Tpay niedostępny =====

select public.attach_tpay_transaction((select id from t where name = 'o1'), '01TPAYTX', 'TR-BRA-1');
select results_eq($$select tpay_transaction_id, tpay_title from public.orders where id = (select id from t where name = 'o1')$$,
  $$values ('01TPAYTX', 'TR-BRA-1')$$, 'AC-8: transakcja Tpay zapisana w zamówieniu');
select public.discard_tpay_order((select id from t where name = 'o1'));
select is((select count(*) from public.orders where id = (select id from t where name = 'o1'))::int, 1,
  '§7: zamówienie z transakcją Tpay nie jest usuwane');
insert into t values ('o2', (pg_temp.product_order('00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-00000000f001', gen_random_uuid()) ->> 'order_id')::uuid);
select public.discard_tpay_order((select id from t where name = 'o2'));
select is((select count(*) from public.orders where id = (select id from t where name = 'o2'))::int, 0,
  '§7: Tpay niedostępny → zamówienie nie powstaje');

-- ===== AC-9: process_tpay_notification =====

create function pg_temp.notify(p_hash text, p_title text, p_amount integer, p_paid integer, p_is_payment boolean default true)
returns text language sql as $$
  select public.process_tpay_notification(p_hash, p_title, (select id from t where name = 'o1'), p_amount, p_paid, p_is_payment);
$$;

select is(pg_temp.notify('h-title', 'TR-OBCY', 120000, 120000), 'transaction_mismatch', 'ADR-0002: obcy tytuł transakcji odrzucony');
select is(pg_temp.notify('h-amount', 'TR-BRA-1', 120000, 100), 'amount_mismatch', '§7: wpłata niższa niż kwota — odrzucone');
select is(pg_temp.notify('h-amount2', 'TR-BRA-1', 100, 100), 'amount_mismatch', '§7: kwota transakcji niezgodna — odrzucone');
select is(pg_temp.notify('h-status', 'TR-BRA-1', 120000, 120000, false), 'ignored_status', 'AC-9: stan inny niż wpłata — bez zmian');
select is((select status from public.orders where id = (select id from t where name = 'o1')), 'pending',
  'AC-9: odrzucone powiadomienia nie zmieniają zamówienia');
select is(public.process_tpay_notification('h-none', 'TR-X', gen_random_uuid(), 1, 1, true), 'order_not_found',
  'AC-9: nieznane zamówienie odrzucone');

select is(pg_temp.notify('h-ok', 'TR-BRA-1', 120000, 120000), 'paid', 'AC-9: poprawne powiadomienie → `paid`');
select results_eq(
  $$select o.status, p.kind, p.entries_left, p.expires_on from public.orders o join public.user_passes p on p.order_id = o.id
    where o.id = (select id from t where name = 'o1')$$,
  $$values ('paid', 'entries', 10, public.pass_expires_on((now() at time zone 'Europe/Warsaw')::date))$$,
  'AC-9: w jednej transakcji zamówienie `paid` i uprawnienie z `expires_on` = zakup + 1 rok');
select is(pg_temp.notify('h-ok', 'TR-BRA-1', 120000, 120000), 'duplicate:paid', '§7: powtórzone powiadomienie → bez zmian');
select is(pg_temp.notify('h-ok-2', 'TR-BRA-1', 120000, 120000), 'already_paid', 'AC-9: inne powiadomienie o tej samej wpłacie');
select is((select count(*) from public.user_passes where order_id = (select id from t where name = 'o1'))::int, 1,
  'AC-9: jedno uprawnienie mimo powtórzeń');
select results_eq($$select result from public.payment_notifications where tpay_transaction_id like 'TR-%' order by id$$,
  $$values ('transaction_mismatch'), ('amount_mismatch'), ('amount_mismatch'), ('ignored_status'),
    ('order_not_found'), ('paid'), ('already_paid')$$,
  '§7: każde powiadomienie zapisane raz (idempotencja, bez danych osobowych)');

-- §5: wpłata za anulowane zamówienie → `paid` i uprawnienie.
update public.orders set status = 'cancelled', paid_at = null where id = (select id from t where name = 't2');
update public.orders set tpay_transaction_id = '01TPAYTX2', tpay_title = 'TR-BRA-2' where id = (select id from t where name = 't2');
select is(public.process_tpay_notification('h-t2', 'TR-BRA-2', (select id from t where name = 't2'), 5000, 5000, true), 'paid',
  '§5: wpłata za anulowane zamówienie → `paid`');
reset role;

select * from finish();
rollback;
