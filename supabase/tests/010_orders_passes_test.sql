-- SPEC-003 §5 (AC-9, AC-11, AC-21, AC-22, AC-25…AC-27): zamówienia, uprawnienia, reguły ważności.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';

insert into public.products (id, kind, name, price, entries, days, day_type) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10, null, null),
  ('00000000-0000-0000-0000-00000000f002', 'days', 'Karnet 30 dni', 30000, null, 30, null),
  ('00000000-0000-0000-0000-00000000f003', 'single_entry', 'Wejście weekendowe', 5000, null, null, 'weekend'),
  ('00000000-0000-0000-0000-00000000f004', 'single_entry', 'Wejście w tygodniu', 4000, null, null, 'weekday');
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000f0e0', 'Zawody SV');
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, external_url) values
  ('00000000-0000-0000-0000-00000000f0e1', 'Puchar SV', '00000000-0000-0000-0000-00000000f0e0',
   '2026-12-05', '2026-12-06', 'published', 'https://example.test');

-- Zamówienie Tpay `pending` (jak `payments-create`, #49).
create function pg_temp.tpay_order(p_user uuid, p_product uuid) returns uuid language sql as $$
  insert into public.orders (user_id, product_id, item_name, amount, payment_method)
    select p_user, id, name, price, 'tpay' from public.products where id = p_product returning id;
$$;
create function pg_temp.pass_of(p_order uuid) returns public.user_passes language sql as $$
  select * from public.user_passes where order_id = p_order;
$$;
create function pg_temp.valid(p_pass uuid, p_date date) returns boolean language sql as $$
  select exists (select 1 from public.passes_valid_on('00000000-0000-0000-0000-0000000000c1', p_date) where id = p_pass);
$$;

-- ===== Stała ważności, 29.02 =====

select is(public.pass_validity(), interval '1 year', '§5: pass_validity() = 1 rok');
select is(public.pass_expires_on('2026-11-17'), date '2027-11-17', '§5: expires_on = data zakupu + 1 rok');
select is(public.pass_expires_on('2028-02-29'), date '2029-02-28', '§7: zakup 29.02 → expires_on 28.02 następnego roku');

-- ===== AC-9: fulfil_order =====

create temp table t (name text primary key, id uuid);
grant all on t to public;
insert into t values
  ('o_entries', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001')),
  ('o_days', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f002')),
  ('o_weekend', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f003')),
  ('o_weekday', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f004')),
  ('o_other', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f001'));
insert into public.orders (id, user_id, calendar_event_id, item_name, amount, payment_method) values
  ('00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-00000000f0e1', 'Wejściówka: Puchar SV', 5000, 'tpay');

set local role service_role;
select lives_ok($$select public.fulfil_order(id) from t$$, 'AC-9: payments-notify (klucz secret) realizuje zamówienia');
select lives_ok($$select public.fulfil_order('00000000-0000-0000-0000-00000000f0d1')$$, 'AC-9: realizacja wejściówki');
reset role;

select is(
  (select row(o.status, o.paid_at is not null, p.kind, p.entries_total, p.entries_left, p.status, p.expires_on, p.user_id)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'o_entries')),
  row('paid', true, 'entries', 10, 10, 'active', public.pass_expires_on(current_date), '00000000-0000-0000-0000-0000000000c1'::uuid)::text,
  'AC-9: zamówienie paid i uprawnienie z expires_on = data zakupu + 1 rok'
);
select is(
  public.fulfil_order((select id from t where name = 'o_entries')),
  (pg_temp.pass_of((select id from t where name = 'o_entries'))).id,
  'AC-9: ponowna realizacja zwraca to samo uprawnienie (idempotencja)'
);
select is((select count(*)::int from public.user_passes), 6, 'AC-9: jedno zamówienie = jedno uprawnienie');
select is(
  (select row(kind, calendar_event_id, valid_until)::text from public.user_passes where order_id = '00000000-0000-0000-0000-00000000f0d1'),
  row('event_ticket', '00000000-0000-0000-0000-00000000f0e1'::uuid, date '2026-12-06')::text,
  'AC-9: wejściówka ważna do ostatniego dnia wydarzenia'
);

insert into t values ('o_late', pg_temp.tpay_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001'));
update public.orders set status = 'cancelled', cancelled_at = now() where id = (select id from t where name = 'o_late');
select isnt(public.fulfil_order((select id from t where name = 'o_late')), null, '§5: wpłata za anulowane zamówienie tworzy uprawnienie');
select is((select status from public.orders where id = (select id from t where name = 'o_late')), 'paid', '§5: anulowane → paid po wpłacie');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.fulfil_order(id) from t limit 1$$, '42501', null, 'AC-9: fulfil_order niedostępna z przeglądarki (nawet dla admina)');
reset role;

-- AC-3: produkt ma zamówienia → rodzaj i liczba wejść zamrożone.
select throws_ok(
  $$update public.products set entries = 20 where id = '00000000-0000-0000-0000-00000000f001'$$,
  '23514', 'product_has_orders', 'AC-3: product_order_exists widzi zamówienia'
);

-- ===== Reguły ważności (§5) =====

update public.user_passes set expires_on = '2027-01-01'
  where order_id in (select id from t where name in ('o_weekend', 'o_weekday'));
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekend'))).id, '2026-11-21'), '§5: wejście weekendowe ważne w sobotę');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekend'))).id, '2026-11-22'), '§5: wejście weekendowe ważne w niedzielę');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekend'))).id, '2026-11-23'), '§5: wejście weekendowe nieważne w poniedziałek');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekday'))).id, '2026-11-27'), '§5: wejście w tygodniu ważne w piątek');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekday'))).id, '2026-11-21'), '§5: wejście w tygodniu nieważne w sobotę');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekday'))).id, '2026-12-25'), '§5: święto w dzień powszedni = dzień powszedni');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_weekday'))).id, '2027-01-04'), '§5: po expires_on nieważne');

-- Karnet czasowy: przed aktywacją ważny do expires_on; po aktywacji first_used_on…valid_until (także po expires_on, §7).
update public.user_passes set expires_on = '2027-11-17' where order_id = (select id from t where name = 'o_days');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_days'))).id, '2027-11-17'), '§5: nieaktywowany czasowy ważny do expires_on');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_days'))).id, '2027-11-18'), '§5: nieaktywowany czasowy nieważny po expires_on');
select throws_ok(
  $$update public.user_passes set first_used_on = '2027-11-18' where order_id = (select id from t where name = 'o_days')$$,
  '23514', null, '§7: aktywacja czasowego po expires_on niemożliwa'
);
update public.user_passes set first_used_on = '2027-11-07' where order_id = (select id from t where name = 'o_days');
select is((pg_temp.pass_of((select id from t where name = 'o_days'))).valid_until, date '2027-12-06', '§5: aktywacja: valid_until = first_used_on + 30 − 1');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_days'))).id, '2027-12-06'), '§7: aktywowany czasowy ważny do valid_until mimo expires_on');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_days'))).id, '2027-12-07'), '§5: aktywowany czasowy nieważny po valid_until');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_days'))).id, '2027-11-06'), '§5: aktywowany czasowy nieważny przed pierwszym użyciem');

-- Wejściówka: tylko w dniach wydarzenia.
select ok(pg_temp.valid((pg_temp.pass_of('00000000-0000-0000-0000-00000000f0d1')).id, '2026-12-06'), '§5: wejściówka ważna w dniu wydarzenia');
select ok(not pg_temp.valid((pg_temp.pass_of('00000000-0000-0000-0000-00000000f0d1')).id, '2026-12-04'), '§5: wejściówka nieważna przed wydarzeniem');

-- Karnet ilościowy: ostatnie wejście → used_up.
update public.user_passes set entries_left = 0 where order_id = (select id from t where name = 'o_late');
select is((pg_temp.pass_of((select id from t where name = 'o_late'))).status, 'used_up', '§5: ostatnie wejście karnetu ilościowego → used_up');
select ok(not pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_late'))).id, current_date), '§5: wykorzystany karnet nieważny');
select ok(pg_temp.valid((pg_temp.pass_of((select id from t where name = 'o_entries'))).id, current_date), '§5: karnet ilościowy ważny przed expires_on');

-- ===== RLS (§5) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 1, 'RLS: użytkownik widzi tylko własne zamówienia');
select is((select count(*)::int from public.passes_valid_on('00000000-0000-0000-0000-0000000000c1', current_date)), 0,
  'RLS: passes_valid_on nie pokazuje cudzych uprawnień');
select throws_ok($$update public.orders set status = 'paid'$$, '42501', null, 'RLS: klient nie zmienia zamówień');
select throws_ok($$insert into public.user_passes (order_id, kind, expires_on) select id, 'entries', current_date from public.orders$$,
  '42501', null, 'RLS: klient nie tworzy uprawnień');
select throws_ok($$select * from public.payment_notifications$$, '42501', null, 'RLS: payment_notifications bez dostępu dla klientów');
select throws_ok($$select public.create_on_site_order(null, '00000000-0000-0000-0000-00000000f003', 'cash')$$,
  '42501', null, 'AC-21: sprzedaż na miejscu tylko dla obsługi');
reset role;
set local role anon;
select throws_ok($$select * from public.orders$$, '42501', null, 'RLS: gość nie widzi zamówień');
reset role;

-- ===== AC-21, AC-22: sprzedaż na miejscu =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 7, 'RLS: obsługa widzi wszystkie zamówienia');
insert into t values ('o_site', public.create_on_site_order('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f002', 'terminal'));
select is(
  (select row(o.payment_method, o.on_site_method, o.status, o.created_by, o.amount, p.user_id, p.kind)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'o_site')),
  row('on_site', 'terminal', 'paid', '00000000-0000-0000-0000-0000000000b1'::uuid, 30000,
      '00000000-0000-0000-0000-0000000000c2'::uuid, 'days')::text,
  'AC-21: zamówienie on_site opłacone, created_by = obsługa, uprawnienie dla osoby'
);
insert into t values ('o_guest', public.create_on_site_order(null,
  case when extract(isodow from (now() at time zone 'Europe/Warsaw')::date) in (6, 7)
       then '00000000-0000-0000-0000-00000000f003'::uuid else '00000000-0000-0000-0000-00000000f004'::uuid end, 'cash'));
select is(
  (select row(o.user_id, p.user_id, p.expires_on)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'o_guest')),
  row(null::uuid, null::uuid, (now() at time zone 'Europe/Warsaw')::date)::text,
  'AC-22: osoba bez konta — bez user_id, uprawnienie wygasa z końcem dnia'
);
select throws_ok(
  $$select public.create_on_site_order(null,
    case when extract(isodow from (now() at time zone 'Europe/Warsaw')::date) in (6, 7)
         then '00000000-0000-0000-0000-00000000f004'::uuid else '00000000-0000-0000-0000-00000000f003'::uuid end, 'cash')$$,
  'P0001', 'guest_product_not_allowed', 'AC-22: bez konta tylko wejście pasujące do dzisiejszego dnia'
);
select throws_ok($$select public.create_on_site_order(null, '00000000-0000-0000-0000-00000000f001', 'cash')$$,
  'P0001', 'guest_product_not_allowed', 'AC-22: bez konta nie można sprzedać karnetu');
select throws_ok($$select public.create_on_site_order('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001', 'card')$$,
  '22023', 'invalid_on_site_method', 'AC-21: metoda tylko gotówka / terminal');
select throws_ok($$select public.cancel_order((select id from t where name = 'o_site'))$$, '42501', null, 'AC-25: obsługa nie anuluje zamówień');
reset role;

-- ===== AC-25…AC-27: anulowanie i zwrot =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.cancel_order((select id from t where name = 'o_site')), 'refunded', 'AC-25: na miejscu → od razu refunded');
select is(
  (select row(o.refund_note, o.refunded_at is not null, p.status)::text
   from public.orders o join public.user_passes p on p.order_id = o.id where o.id = (select id from t where name = 'o_site')),
  row('Zwrot gotówki / na terminal', true, 'cancelled')::text, 'AC-25: adnotacja zwrotu i uprawnienie cancelled'
);
select is(public.cancel_order((select id from t where name = 'o_other'), 'Na prośbę klienta'), 'refund_pending', 'AC-25: Tpay → refund_pending');
select throws_ok($$select public.cancel_order((select id from t where name = 'o_days'))$$,
  'P0001', 'pass_used', 'AC-26: uprawnienie używane — bez zwrotu w systemie');
select throws_ok($$select public.cancel_order((select id from t where name = 'o_other'))$$,
  'P0001', 'order_not_paid', 'AC-25: anulować można tylko opłacone zamówienie');
select is(
  (select changes ->> 'amount' from public.audit_log where action = 'order_refund'
     and actor_id = '00000000-0000-0000-0000-0000000000a1' and changes ->> 'order_id' = (select id::text from t where name = 'o_other')),
  '120000', 'AC-27: audit_log order_refund z kwotą i zamówieniem'
);
reset role;

-- ===== AC-11: anulowanie nieopłaconych po 24 h =====

insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, created_at) values
  ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001', 'K', 100, 'tpay', now() - interval '25 hours'),
  ('00000000-0000-0000-0000-00000000f0a2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001', 'K', 100, 'tpay', now() - interval '23 hours');
select is(public.cancel_unpaid_orders(), 1, 'AC-11: anulowane tylko pending starsze niż 24 h');
select is(
  (select array_agg(status order by id) from public.orders where id in ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f0a2')),
  array['cancelled', 'pending'], 'AC-11: starsze → cancelled, młodsze zostaje pending'
);
select is((select schedule from cron.job where jobname = 'cancel-unpaid-orders'), '5 * * * *', 'AC-11: zadanie pg_cron co godzinę (ADR-0006)');

select * from finish();
rollback;
