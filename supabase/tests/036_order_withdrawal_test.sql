-- SPEC-012 US-4 (AC-15…AC-22, AC-52): odstąpienie od umowy w panelu, zwrot proporcjonalny, ostrzeżenie po 14 dniach.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000036a1', 'withdrawal-admin@example.test'),
  ('00000000-0000-0000-0000-0000000036c1', 'withdrawal-client@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000036a1';

insert into public.products (id, kind, name, price, entries, day_type) values
  ('00000000-0000-0000-0000-0000000036f1', 'entries', 'Karnet 3 wejść W', 10000, 3, null),
  ('00000000-0000-0000-0000-0000000036f2', 'single_entry', 'Wejście weekendowe W', 5000, null, 'weekend');

-- w1: ilościowy, 1 z 3 użyte, 3 dni temu; w2: wejście jednorazowe nieużyte, 14 dni temu (ostatni dzień okna);
-- w3: ilościowy w całości użyty; w4: ilościowy nieużyty, 15 dni temu (po oknie);
-- w6: ilościowy na miejscu; w7: ilościowy, 2 z 3 użyte (zaokrąglenie).
create temp table w (name text primary key, id uuid, product uuid, method text, days_ago integer);
insert into w values
  ('w1', '00000000-0000-0000-0000-0000000036d1', '00000000-0000-0000-0000-0000000036f1', 'tpay', 3),
  ('w2', '00000000-0000-0000-0000-0000000036d2', '00000000-0000-0000-0000-0000000036f2', 'tpay', 14),
  ('w3', '00000000-0000-0000-0000-0000000036d3', '00000000-0000-0000-0000-0000000036f1', 'tpay', 1),
  ('w4', '00000000-0000-0000-0000-0000000036d4', '00000000-0000-0000-0000-0000000036f1', 'tpay', 15),
  ('w6', '00000000-0000-0000-0000-0000000036d6', '00000000-0000-0000-0000-0000000036f1', 'on_site', 2),
  ('w7', '00000000-0000-0000-0000-0000000036d7', '00000000-0000-0000-0000-0000000036f1', 'tpay', 0);
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, on_site_method, tpay_title)
  select w.id, '00000000-0000-0000-0000-0000000036c1', w.product, p.name, p.price, w.method,
         case when w.method = 'on_site' then 'cash' end, case when w.method = 'tpay' then 'TR-' || w.name end
  from w join public.products p on p.id = w.product;
create temp table fulfilled as select public.fulfil_order(id) from w;
update public.orders o set paid_at = ((public.range_today() - w.days_ago)::timestamp + time '12:00') at time zone 'Europe/Warsaw'
  from w where w.id = o.id;
update public.user_passes set entries_left = 2 where order_id = '00000000-0000-0000-0000-0000000036d1';
update public.user_passes set entries_left = 0 where order_id = '00000000-0000-0000-0000-0000000036d3';
update public.user_passes set entries_left = 1 where order_id = '00000000-0000-0000-0000-0000000036d7';

-- ===== AC-16: tylko admin =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000036c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d1', public.range_today())$$,
  '42501', null, 'AC-16: klient nie wylicza zwrotu w panelu');
select throws_ok($$select public.withdraw_order('00000000-0000-0000-0000-0000000036d1', public.range_today())$$,
  '42501', null, 'AC-19: klient nie zleca odstąpienia w panelu');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000036a1","role":"authenticated"}', true);
set local role authenticated;

-- ===== AC-16, AC-17, AC-18: wyliczenie =====

select is(
  (select row(amount, used, total, used_value, refund_amount, last_day)::text
   from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d1', public.range_today())),
  row(10000, 1, 3, 3333, 6667, public.range_today() + 11)::text,
  'AC-16, AC-17: 1 z 3 wejść — wykorzystano 33,33 zł, zwrot 66,67 zł, okno do opłacenia + 14 dni');
select is(
  (select row(used_value, refund_amount)::text from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d7', public.range_today())),
  row(6666, 3334)::text, 'AC-17: wartość wykorzystania w dół do grosza (na korzyść klienta)');
select is(
  (select row(used, total, refund_amount, last_day)::text
   from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d2', public.range_today())),
  row(0, 1, 5000, public.range_today())::text, 'AC-16, AC-17: nieużyte wejście jednorazowe — pełny zwrot; 14. dzień w oknie');
select is(
  (select refund_amount from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d3', public.range_today())), 0,
  'AC-18: karnet bez wejść — zwrot 0,00 zł');
select throws_ok($$select * from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d1', public.range_today() - 4)$$,
  'P0001', 'withdrawal_invalid_day', 'AC-16: dzień odstąpienia nie wcześniej niż dzień opłacenia');
select throws_ok($$select * from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d1', public.range_today() + 1)$$,
  'P0001', 'withdrawal_invalid_day', 'AC-16: dzień odstąpienia nie później niż dziś');
select throws_ok($$select * from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d4', public.range_today())$$,
  'P0001', 'withdrawal_window_closed', 'AC-21: 15 dni po opłaceniu — okno zamknięte');
select throws_ok($$select * from public.withdrawal_quote('00000000-0000-0000-0000-0000000036d6', public.range_today())$$,
  'P0001', 'withdrawal_not_available', 'AC-22: sprzedaż na miejscu bez odstąpienia');

-- ===== AC-15, AC-18, AC-21: lista w panelu =====

create temp table r as select * from public.admin_list_orders(p_person => 'withdrawal-client');
select is((select row(withdrawal_refund, refund_window_until, pass_kind)::text from r where id = '00000000-0000-0000-0000-0000000036d1'),
  row(6667, public.range_today() + 11, 'entries')::text, 'AC-15: w oknie — zwrot na dziś i koniec okna');
select is((select withdrawal_refund from r where id = '00000000-0000-0000-0000-0000000036d3'), 0, 'AC-18: zwrot 0 w liście');
select is((select row(withdrawal_refund, refund_window_until)::text from r where id = '00000000-0000-0000-0000-0000000036d4'),
  row(null::integer, public.range_today() - 1)::text, 'AC-21: po oknie — bez odstąpienia, koniec okna minął');

-- ===== AC-19: odstąpienie =====

select throws_ok($$select public.withdraw_order('00000000-0000-0000-0000-0000000036d3', public.range_today())$$,
  'P0001', 'withdrawal_nothing_to_refund', 'AC-18: usługa wykonana w całości — odstąpienie odrzucone');
select is(public.withdraw_order('00000000-0000-0000-0000-0000000036d1', public.range_today() - 1, ' Telefon klienta '),
  'refund_pending', 'AC-19: odstąpienie → refund_pending');
reset role;
select is(
  (select row(o.status, o.refund_amount, o.withdrawal_on, o.refund_requested_at is not null, o.refund_note, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000036d1'),
  row('refund_pending', 6667, public.range_today() - 1, true, 'Telefon klienta', 'cancelled')::text,
  'AC-19: refund_amount, withdrawal_on, refund_requested_at; uprawnienie z zużyciem → cancelled');
select is(
  (select changes - 'order_id' from public.audit_log where action = 'order_refund'
     and changes ->> 'order_id' = '00000000-0000-0000-0000-0000000036d1'),
  jsonb_build_object('reason', 'withdrawal', 'amount', 10000, 'refund_amount', 6667, 'withdrawal_on', public.range_today() - 1,
                     'used', 1, 'total', 3, 'status', jsonb_build_array('paid', 'refund_pending')),
  'AC-19: audit_log order_refund z powodem, kwotami i zużyciem');

-- §7: powiadomienie Tpay o zwrocie częściowym porównuje kwotę z refund_amount.
set local role service_role;
select is(public.process_tpay_notification('hash-w1a', 'TR-w1', '00000000-0000-0000-0000-0000000036d1', 10000, 10000, false, true),
  'amount_mismatch', 'AC-19: zwrot pełnej kwoty przy zwrocie częściowym — niezgodny');
select is(public.process_tpay_notification('hash-w1b', 'TR-w1', '00000000-0000-0000-0000-0000000036d1', 10000, 6667, false, true),
  'refunded', 'AC-19: powiadomienie z kwotą refund_amount → refunded');
reset role;
select is((select row(status, refund_amount)::text from public.orders where id = '00000000-0000-0000-0000-0000000036d1'),
  row('refunded', 6667)::text, 'AC-20: zamówienie zwrócone częściowo');

-- ===== AC-52: nieudany zwrot po odstąpieniu — bez reaktywacji, ponowienie tej samej kwoty =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000036a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.withdraw_order('00000000-0000-0000-0000-0000000036d2', public.range_today()), 'refund_pending',
  'AC-19: odstąpienie w ostatnim dniu okna');
reset role;
set local role service_role;
select is(public.revert_order_refund('00000000-0000-0000-0000-0000000036d2', '00000000-0000-0000-0000-0000000036a1'), true,
  'AC-52: Tpay odrzucił zwrot — cofnięcie');
reset role;
select is(
  (select row(o.status, o.refund_amount, o.withdrawal_on, o.refund_requested_at, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000036d2'),
  row('paid', 5000, public.range_today(), null::timestamptz, 'cancelled')::text,
  'AC-52: zamówienie paid z refund_amount i withdrawal_on, uprawnienie zostaje cancelled');
-- Ponowienie po upływie okna — bez ponownego wyliczenia (sprawdzenie okna pominięte).
update public.orders set paid_at = paid_at - interval '30 days' where id = '00000000-0000-0000-0000-0000000036d2';
set local role authenticated;
select is(public.withdraw_order('00000000-0000-0000-0000-0000000036d2', null), 'refund_pending',
  'AC-52: „Ponów zwrot” — także po oknie');
reset role;
select is((select row(status, refund_amount)::text from public.orders where id = '00000000-0000-0000-0000-0000000036d2'),
  row('refund_pending', 5000)::text, 'AC-52: ponowienie wysyła tę samą kwotę');
select is(
  (select (changes ->> 'retry')::boolean from public.audit_log where action = 'order_refund'
     and changes ->> 'order_id' = '00000000-0000-0000-0000-0000000036d2' order by id desc limit 1),
  true, 'AC-52: ponowienie w audit_log');

-- ===== AC-21, AC-22: „Anuluj i zwróć” =====

set local role authenticated;
select throws_ok($$select public.cancel_order('00000000-0000-0000-0000-0000000036d4')$$,
  'P0001', 'refund_note_required', 'AC-21: po 14 dniach notatka wymagana');
select throws_ok($$select public.cancel_order('00000000-0000-0000-0000-0000000036d4', ' ab ')$$,
  'P0001', 'refund_note_required', 'AC-21: notatka co najmniej 3 znaki');
select is(public.cancel_order('00000000-0000-0000-0000-0000000036d4', 'Reklamacja'), 'refund_pending',
  'AC-21: po 14 dniach z notatką — zwrot');
reset role;
select is((select row(refund_amount, refund_requested_at is not null)::text from public.orders where id = '00000000-0000-0000-0000-0000000036d4'),
  row(10000, true)::text, 'AC-21: cancel_order ustawia refund_amount = amount');
set local role service_role;
select is(public.revert_order_refund('00000000-0000-0000-0000-0000000036d4', null), true, 'AC-52: cofnięcie „Anuluj i zwróć”');
reset role;
select is(
  (select row(o.status, o.refund_amount, o.refund_note, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000036d4'),
  row('paid', null::integer, null::text, 'active')::text, 'AC-52: „Anuluj i zwróć” cofnięte — uprawnienie znów active');

select * from finish();
rollback;
