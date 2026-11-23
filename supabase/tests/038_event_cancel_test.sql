-- SPEC-012 US-5 (AC-23…AC-29, AC-51): odwołanie wydarzenia, zwroty, e-maile, blokada edycji, nieważne wejściówki.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000038a1', 'cancel-admin@example.test'),
  ('00000000-0000-0000-0000-0000000038c1', 'cancel-client@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000038a1';

insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000038e0', 'Pikniki X');
-- e1: płatne, za 5 dni; e2: bezpłatne; e3: szkic; e4: zakończone wczoraj.
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, ticket_price) values
  ('00000000-0000-0000-0000-0000000038e1', 'Piknik X', '00000000-0000-0000-0000-0000000038e0', public.range_today() + 5,
   public.range_today() + 6, 'published', 'paid', 5000),
  ('00000000-0000-0000-0000-0000000038e2', 'Otwarte X', '00000000-0000-0000-0000-0000000038e0', public.range_today(), null,
   'published', 'free', null),
  ('00000000-0000-0000-0000-0000000038e3', 'Szkic X', '00000000-0000-0000-0000-0000000038e0', public.range_today() + 5, null,
   'draft', 'free', null),
  ('00000000-0000-0000-0000-0000000038e4', 'Było X', '00000000-0000-0000-0000-0000000038e0', public.range_today() - 2,
   public.range_today() - 1, 'published', 'free', null);

-- o1: Tpay opłacone; o2: na miejscu z kontem; o3: prezent; o4: Tpay pending; o5: zwrócone przed odwołaniem;
-- o6: na miejscu bez konta.
insert into public.orders (id, user_id, calendar_event_id, item_name, amount, payment_method, on_site_method, tpay_title,
                           tpay_transaction_id) values
  ('00000000-0000-0000-0000-0000000038d1', '00000000-0000-0000-0000-0000000038c1', '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 5000, 'tpay', null, 'TR-38-1', '01TPAY38/1'),
  ('00000000-0000-0000-0000-0000000038d2', '00000000-0000-0000-0000-0000000038c1', '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 5000, 'on_site', 'cash', null, null),
  ('00000000-0000-0000-0000-0000000038d3', '00000000-0000-0000-0000-0000000038c1', '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 0, 'gift', null, null, null),
  ('00000000-0000-0000-0000-0000000038d4', '00000000-0000-0000-0000-0000000038c1', '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 5000, 'tpay', null, 'TR-38-4', null),
  ('00000000-0000-0000-0000-0000000038d5', '00000000-0000-0000-0000-0000000038c1', '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 5000, 'tpay', null, 'TR-38-5', '01TPAY38/5'),
  ('00000000-0000-0000-0000-0000000038d6', null, '00000000-0000-0000-0000-0000000038e1',
   'Wejściówka: Piknik X', 4000, 'on_site', 'terminal', null, null);
create temp table fulfilled as select public.fulfil_order(id) from public.orders
  where id in ('00000000-0000-0000-0000-0000000038d1', '00000000-0000-0000-0000-0000000038d2', '00000000-0000-0000-0000-0000000038d3',
               '00000000-0000-0000-0000-0000000038d5', '00000000-0000-0000-0000-0000000038d6');
update public.orders set status = 'refunded', refunded_at = now() - interval '1 day', refund_amount = 5000
  where id = '00000000-0000-0000-0000-0000000038d5';
update public.user_passes set status = 'cancelled' where order_id = '00000000-0000-0000-0000-0000000038d5';
-- Wejściówka użyta (zużycie nie blokuje zwrotu po odwołaniu — §7).
update public.user_passes set status = 'used_up' where order_id = '00000000-0000-0000-0000-0000000038d2';

-- ===== AC-23: tylko admin, walidacja =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000038c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e1', 'Awaria kulochwytu')$$,
  '42501', null, 'AC-23: klient nie odwołuje wydarzenia');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000038a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e1', ' ab ')$$,
  '22023', 'invalid_cancel_reason', 'AC-23: powód co najmniej 3 znaki');
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e1', repeat('x', 201))$$,
  '22023', 'invalid_cancel_reason', 'AC-23: powód najwyżej 200 znaków');
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e3', 'Brak chętnych')$$,
  'P0001', 'event_not_published', 'AC-23: szkicu nie odwołujemy');
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e4', 'Brak chętnych')$$,
  'P0001', 'event_ended', 'AC-29: zakończonego wydarzenia nie odwołujemy');
select throws_ok($$update public.calendar_events set cancelled_at = now(), cancel_reason = 'Bez funkcji'
  where id = '00000000-0000-0000-0000-0000000038e2'$$,
  '42501', 'forbidden', 'AC-24: oznaczenie tylko przez cancel_calendar_event (nie bezpośrednim zapisem)');

-- ===== AC-24: odwołanie =====

select is(public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e1', ' Awaria kulochwytu '),
  jsonb_build_object('event_id', '00000000-0000-0000-0000-0000000038e1'::uuid, 'online', 1, 'on_site', 2, 'gifts', 1,
                     'unpaid', 1, 'emails', 3, 'refund_total', 14000),
  'AC-24: liczby i suma zwrotów (Tpay 1, na miejscu 2, prezent 1, niezapłacone 1; e-maile tylko z kontem)');
select is((select row(status, refund_amount, refund_requested_at)::text from public.orders where id = '00000000-0000-0000-0000-0000000038d1'),
  row('refund_pending', 5000, null::timestamptz)::text, 'AC-24: Tpay paid → refund_pending z pełną kwotą, zwrot jeszcze nie zlecony');
select is((select row(status, refund_amount, refund_note)::text from public.orders where id = '00000000-0000-0000-0000-0000000038d2'),
  row('refunded', 5000, 'Zwrot gotówki / na terminal — odwołanie wydarzenia')::text,
  'AC-24: na miejscu → refunded z adnotacją (także użyta wejściówka)');
select is((select status from public.orders where id = '00000000-0000-0000-0000-0000000038d3'), 'cancelled', 'AC-24: prezent → cancelled');
select is((select status from public.orders where id = '00000000-0000-0000-0000-0000000038d4'), 'cancelled', 'AC-24: pending → cancelled');
select is((select row(status, refunded_at < now())::text from public.orders where id = '00000000-0000-0000-0000-0000000038d5'),
  row('refunded', true)::text, 'AC-24: zwrócone wcześniej — bez zmian');
select is((select count(*)::integer from public.user_passes
           where calendar_event_id = '00000000-0000-0000-0000-0000000038e1' and status <> 'cancelled'), 0,
  'AC-24: wszystkie wejściówki → cancelled');
reset role;
select is((select row(cancelled_at is not null, cancel_reason, cancelled_by)::text from public.calendar_events
           where id = '00000000-0000-0000-0000-0000000038e1'),
  row(true, 'Awaria kulochwytu', '00000000-0000-0000-0000-0000000038a1'::uuid)::text,
  'AC-24: cancelled_at, cancel_reason (przycięty), cancelled_by');
select is((select array_agg(order_id order by order_id)::text from public.email_outbox where kind = 'event_cancelled'),
  array['00000000-0000-0000-0000-0000000038d1', '00000000-0000-0000-0000-0000000038d2',
        '00000000-0000-0000-0000-0000000038d3']::uuid[]::text,
  'AC-24: e-mail event_cancelled dla opłaconych zamówień z kontem (bez pending, bez osoby bez konta i wcześniej zwróconych)');
select is((select count(*)::integer from public.audit_log where action = 'order_refund' and changes ->> 'reason' = 'event_cancel'), 3,
  'AC-24: order_refund dla każdego zwrotu (Tpay i na miejscu)');
select is((select row(changes ->> 'name', changes ->> 'reason', (changes ->> 'refund_total')::integer, actor_id)::text
           from public.audit_log where action = 'event_cancel'),
  row('Piknik X', 'Awaria kulochwytu', 14000, '00000000-0000-0000-0000-0000000038a1'::uuid)::text, 'AC-24: audit_log event_cancel');

-- ===== AC-27: dane e-maila =====

select is((select row(payment_method, refund_amount, event_name, cancel_reason, event_starts_on)::text
           from public.mail_outbox_claim(10) where order_id = '00000000-0000-0000-0000-0000000038d1'),
  row('tpay', 5000, 'Piknik X', 'Awaria kulochwytu', public.range_today() + 5)::text,
  'AC-27: mail_outbox_claim podaje nazwę, daty, powód, metodę i kwotę zwrotu');

-- ===== AC-25: publicznie, sprzedaż, ważność =====

set local role anon;
select is((select row(cancelled_at is not null, cancel_reason)::text from public.calendar_events
           where id = '00000000-0000-0000-0000-0000000038e1'),
  row(true, 'Awaria kulochwytu')::text, 'AC-25: gość widzi oznaczenie i powód');
select throws_ok($$select cancelled_by from public.calendar_events$$, '42501', null, 'AC-25 §5: cancelled_by niepubliczne');
select is((select count(*)::integer from public.range_blocked_on(public.range_today() + 5)
           where id = '00000000-0000-0000-0000-0000000038e1'), 0, 'AC-25: odwołane wydarzenie nie blokuje karnetów');
reset role;

select throws_ok($$select public.create_tpay_order('00000000-0000-0000-0000-0000000038c1', null,
  '00000000-0000-0000-0000-0000000038e1', gen_random_uuid(), public.current_sales_terms_version(), false)$$,
  'P0001', 'event_cancelled', 'AC-25: create_tpay_order odrzuca wejściówkę');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000038a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000038c1', null, 'cash',
  '00000000-0000-0000-0000-0000000038e1')$$, 'P0001', 'event_cancelled', 'AC-25: create_on_site_order odrzuca wejściówkę');
select throws_ok($$select public.grant_pass('00000000-0000-0000-0000-0000000038c1', null, '00000000-0000-0000-0000-0000000038e1',
  'Nagroda w konkursie', null, gen_random_uuid())$$, 'P0001', 'event_cancelled', 'AC-25: grant_pass odrzuca wejściówkę');
reset role;

update public.user_passes set status = 'active' where order_id = '00000000-0000-0000-0000-0000000038d1';
select is((select status from public.user_passes where order_id = '00000000-0000-0000-0000-0000000038d1'), 'cancelled',
  'AC-51: wejściówka odwołanego wydarzenia nie wraca do active');
select is((select public.pass_valid_on(jsonb_populate_record(p, '{"status":"active"}'), public.range_today() + 5)
           from public.user_passes p where p.order_id = '00000000-0000-0000-0000-0000000038d1'), false,
  'AC-25: wejściówka odwołanego wydarzenia nieważna, nawet gdyby była active');

-- ===== AC-29: edycja odwołanego =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000038a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.calendar_events set description = 'Nowy termin wkrótce', cancel_reason = 'Awaria osłon'
  where id = '00000000-0000-0000-0000-0000000038e1'$$, 'AC-29: opis i powód odwołania można zmienić');
select throws_ok($$update public.calendar_events set name = 'Inna nazwa' where id = '00000000-0000-0000-0000-0000000038e1'$$,
  'P0001', 'event_cancelled', 'AC-29: inne pola zablokowane');
select throws_ok($$delete from public.calendar_events where id = '00000000-0000-0000-0000-0000000038e1'$$,
  'P0001', 'event_cancelled', 'AC-29: odwołanego nie usuwamy');
select throws_ok($$select public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e1', 'Jeszcze raz')$$,
  'P0001', 'event_already_cancelled', 'AC-29: drugi raz nie odwołujemy');
select is(public.cancel_calendar_event('00000000-0000-0000-0000-0000000038e2', 'Burza') ->> 'emails', '0',
  'AC-29: bezpłatne wydarzenie — tylko oznaczenie, bez e-maili');
reset role;

-- ===== §7, AC-51: zwroty Tpay =====

set local role service_role;
select is((select id from public.event_refund_claim()), '00000000-0000-0000-0000-0000000038d1'::uuid,
  '§7: event_refund_claim zwraca zamówienie czekające na zlecenie zwrotu');
select is((select count(*)::integer from public.event_refund_claim()), 0, '§7: zlecone zamówienie nie jest pobierane ponownie');
select ok(public.revert_order_refund('00000000-0000-0000-0000-0000000038d1', null), 'AC-51: Tpay odrzucił — revert');
reset role;
select is((select row(o.status, p.status)::text from public.orders o join public.user_passes p on p.order_id = o.id
           where o.id = '00000000-0000-0000-0000-0000000038d1'),
  row('paid', 'cancelled')::text, 'AC-51: zamówienie → paid, wejściówka zostaje cancelled');

-- AC-28: wpłata po odwołaniu za anulowane zamówienie (z wersją regulaminu — bez odwołania byłby e-mail order_paid).
update public.orders set terms_version = public.current_sales_terms_version()
  where id = '00000000-0000-0000-0000-0000000038d4';
select ok(public.fulfil_order('00000000-0000-0000-0000-0000000038d4') is not null, 'AC-28: wpłata realizuje zamówienie');
select is((select row(o.status, p.status)::text from public.orders o join public.user_passes p on p.order_id = o.id
           where o.id = '00000000-0000-0000-0000-0000000038d4'),
  row('paid', 'cancelled')::text, 'AC-28: zamówienie paid, wejściówka od razu cancelled');
select is((select count(*)::integer from public.email_outbox
           where kind = 'order_paid' and order_id = '00000000-0000-0000-0000-0000000038d4'), 0,
  'AC-28: wpłata po odwołaniu — bez potwierdzenia zakupu (order_paid)');

-- ===== AC-26: lista „Zwroty po odwołaniu” i „Ponów zwrot” =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000038a1","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(row(order_id, status, has_account)::text order by order_id)
           from public.admin_event_refunds('00000000-0000-0000-0000-0000000038e1')),
  array[row('00000000-0000-0000-0000-0000000038d1'::uuid, 'paid', true)::text,
        row('00000000-0000-0000-0000-0000000038d2'::uuid, 'refunded', true)::text,
        row('00000000-0000-0000-0000-0000000038d4'::uuid, 'paid', true)::text,
        row('00000000-0000-0000-0000-0000000038d6'::uuid, 'refunded', false)::text],
  'AC-26, AC-28: lista zwrotów — bez prezentu i zwróconych przed odwołaniem');
select is(public.cancel_order('00000000-0000-0000-0000-0000000038d1'), 'refund_pending',
  'AC-51: „Ponów zwrot” — pełny zwrot bez sprawdzania zużycia');
reset role;
select is((select row(o.status, o.refund_amount, o.refund_requested_at is not null, p.status)::text
           from public.orders o join public.user_passes p on p.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000038d1'),
  row('refund_pending', 5000, true, 'cancelled')::text, 'AC-51: ponowienie — zlecony zwrot pełnej kwoty, wejściówka cancelled');

select * from finish();
rollback;
