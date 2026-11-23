-- SPEC-012 US-3 (AC-9, AC-11…AC-14), ADR-0009: kolejka e-maili `email_outbox`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000035a1', 'admin35@example.test'),
  ('00000000-0000-0000-0000-0000000035b1', 'staff35@example.test'),
  ('00000000-0000-0000-0000-0000000035c1', 'user35@example.test'),
  ('00000000-0000-0000-0000-0000000035c2', 'gone35@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000035a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000035b1';

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000035f1', 'entries', 'Karnet 3 wejść', 12000, 3);
update public.products set is_active = true where id = '00000000-0000-0000-0000-0000000035f1';
-- Wersja regulaminu obowiązująca dziś (test nie zależy od daty 1.01.2027).
insert into public.sales_terms_versions values (public.range_today() - 1);

create function pg_temp.buy(p_user uuid, p_version date) returns uuid language sql as $$
  select (public.create_tpay_order(p_user, '00000000-0000-0000-0000-0000000035f1', null, gen_random_uuid(),
                                   p_version, true) ->> 'order_id')::uuid;
$$;
create function pg_temp.pay(p_order uuid, p_hash text) returns text language sql as $$
  select public.process_tpay_notification(p_hash, o.tpay_title, o.id, o.amount, o.amount, true)
    from public.orders o where o.id = p_order;
$$;

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values
  ('o1', pg_temp.buy('00000000-0000-0000-0000-0000000035c1', public.range_today() - 1)),
  ('o_gone', pg_temp.buy('00000000-0000-0000-0000-0000000035c2', public.range_today() - 1));
update public.orders set tpay_title = 'TR-35-' || left(id::text, 8) where id in (select id from t);

-- ===== AC-9: wpis w tej samej transakcji, bez duplikatu =====

select is(pg_temp.pay((select id from t where name = 'o1'), 'hash-35-1'), 'paid', 'AC-9: powiadomienie realizuje zamówienie');
select results_eq(
  $$select kind, status, attempts, next_attempt_at <= now() from public.email_outbox where order_id = (select id from t where name = 'o1')$$,
  $$values ('order_paid'::text, 'pending'::text, 0, true)$$,
  'AC-9: realizacja zamówienia Tpay tworzy wpis order_paid (pending, do wysłania od razu)');
select is(pg_temp.pay((select id from t where name = 'o1'), 'hash-35-2'), 'already_paid', 'AC-9: powtórzone powiadomienie');
select is((select count(*)::integer from public.email_outbox where order_id = (select id from t where name = 'o1')), 1,
  'AC-9: powtórzone powiadomienie nie tworzy drugiego wpisu');
select throws_ok($$insert into public.email_outbox (kind, order_id) values ('order_paid', (select id from t where name = 'o1'))$$,
  '23505', null, 'AC-9: unikalne (kind, order_id)');

-- §9: kolejka bez adresu i treści
select is((select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'email_outbox'
           and column_name in ('email', 'recipient', 'subject', 'body', 'html', 'text')), 0, '§9: email_outbox bez adresu i treści');

-- ===== AC-13 i §7: bez e-maila =====

-- Zamówienie sprzed 1.01.2027 / sprzed wdrożenia — bez wersji regulaminu.
insert into t values ('no_version', pg_temp.buy('00000000-0000-0000-0000-0000000035c1', public.range_today() - 1));
update public.orders set tpay_title = 'TR-35-NV', terms_version = null where id = (select id from t where name = 'no_version');
select is(pg_temp.pay((select id from t where name = 'no_version'), 'hash-35-nv'), 'paid', '§7: zamówienie bez wersji opłacone');
select is((select count(*)::integer from public.email_outbox where order_id = (select id from t where name = 'no_version')), 0,
  '§7: zamówienie bez terms_version — bez e-maila (brak PDF)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035b1","role":"authenticated"}', true);
set local role authenticated;
insert into t values ('on_site', public.create_on_site_order('00000000-0000-0000-0000-0000000035c1',
  '00000000-0000-0000-0000-0000000035f1', 'cash', null));
reset role;
select is((select count(*)::integer from public.email_outbox where order_id = (select id from t where name = 'on_site')), 0,
  'AC-13: zamówienie na miejscu — bez e-maila');

-- ===== §5 RLS =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.email_outbox$$, '42501', null, '§5: admin nie czyta kolejki bezpośrednio');
select throws_ok($$select * from public.mail_outbox_claim(10)$$, '42501', null, 'ADR-0009: claim tylko kluczem secret');
select throws_ok($$select public.mail_outbox_result(gen_random_uuid(), null)$$, '42501', null,
  'ADR-0009: wynik wysyłki tylko kluczem secret');
reset role;
set local role anon;
select throws_ok($$select * from public.email_outbox$$, '42501', null, '§5: gość nie czyta kolejki');
reset role;

-- ===== AC-12: konto usunięte przed wysyłką =====

delete from auth.users where id = '00000000-0000-0000-0000-0000000035c2';
select is(pg_temp.pay((select id from t where name = 'o_gone'), 'hash-35-g'), 'paid',
  'AC-12: wpłata za zamówienie usuniętego konta');

-- ===== AC-10: dane do szablonu =====

set local role service_role;
create temp table claimed as select * from public.mail_outbox_claim(10);
reset role;
select results_eq(
  $$select kind, order_number, item_name, amount, terms_version, early_performance_consent_at is not null, pass_kind,
           expires_on is not null, email from claimed$$,
  $$select 'order_paid'::text, o.order_number, 'Karnet 3 wejść'::text, 12000, public.range_today() - 1, true,
           'entries'::text, true, 'user35@example.test'::text
      from public.orders o where o.id = (select id from t where name = 'o1')$$,
  'AC-10: claim zwraca dane zamówienia i e-mail konta z auth.users (tylko wpisy do wysłania)');
select is((select status from public.email_outbox where order_id = (select id from t where name = 'o_gone')), 'skipped',
  'AC-12: wpis zamówienia bez konta → skipped, nie jest zwracany');
select ok((select next_attempt_at > now() + interval '10 minutes' from public.email_outbox
            where order_id = (select id from t where name = 'o1')),
  'ADR-0009: zarezerwowany wpis nie jest zwracany ponownie (równoległe wywołania)');
set local role service_role;
select is((select count(*)::integer from public.mail_outbox_claim(10)), 0, 'ADR-0009: drugi claim nic nie zwraca');
reset role;

-- ===== AC-11: ponowienia z rosnącym odstępem, potem failed =====

create function pg_temp.fail() returns text language sql as $$
  select public.mail_outbox_result((select id from claimed), 'smtp_error');
$$;
create function pg_temp.delay() returns interval language sql as $$
  select next_attempt_at - now() from public.email_outbox where id = (select id from claimed);
$$;
select is(pg_temp.fail(), 'pending', 'AC-11: 1. nieudana próba → pending');
select is(pg_temp.delay(), interval '10 minutes', 'AC-11: odstęp po 1. próbie — 10 min');
select is(pg_temp.fail(), 'pending', 'AC-11: 2. nieudana próba → pending');
select is(pg_temp.delay(), interval '30 minutes', 'AC-11: odstęp po 2. próbie — 30 min');
select is(pg_temp.fail(), 'pending', 'AC-11: 3. nieudana próba → pending');
select is(pg_temp.delay(), interval '1 hour', 'AC-11: odstęp po 3. próbie — 1 h');
select is(pg_temp.fail(), 'pending', 'AC-11: 4. nieudana próba → pending');
select is(pg_temp.delay(), interval '3 hours', 'AC-11: odstęp po 4. próbie — 3 h');
select is(pg_temp.fail(), 'failed', 'AC-11: po 5 nieudanych próbach → failed');
select results_eq($$select status, attempts, last_error, next_attempt_at from public.email_outbox where id = (select id from claimed)$$,
  $$values ('failed'::text, 5, 'smtp_error'::text, null::timestamptz)$$, 'AC-11: failed z licznikiem 5 i kodem błędu');

-- ===== AC-11, AC-14: panel — stan i „Wyślij ponownie” =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.admin_resend_email((select id from t where name = 'o1'))$$, '42501', null,
  'AC-11: „Wyślij ponownie” tylko admin');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a1","role":"authenticated"}', true);
set local role authenticated;
select is((select email_status from public.admin_list_orders(p_person => (select order_number from public.orders where id = (select id from t where name = 'o1')))),
  'failed', 'AC-14: admin_list_orders zwraca stan e-maila („Nie wysłano”)');
select lives_ok($$select public.admin_resend_email((select id from t where name = 'o1'))$$, 'AC-11: admin wysyła ponownie');
select throws_ok($$select public.admin_resend_email((select id from t where name = 'o1'))$$, '22023', 'email_not_failed',
  'AC-11: ponownie tylko dla wpisu failed');
reset role;
select results_eq(
  $$select e.status, e.attempts, e.last_error, a.action, a.actor_id, a.changes ->> 'kind'
      from public.email_outbox e join public.audit_log a on (a.changes ->> 'order_id')::uuid = e.order_id and a.action = 'email_resend'
     where e.id = (select id from claimed)$$,
  $$values ('pending'::text, 0, null::text, 'email_resend'::text, '00000000-0000-0000-0000-0000000035a1'::uuid, 'order_paid'::text)$$,
  'AC-11: „Wyślij ponownie” — pending, licznik od zera, audit_log email_resend');

set local role service_role;
select is(public.mail_outbox_result((select id from claimed), null), 'sent', 'AC-10: udana wysyłka → sent');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select email_status, email_sent_at from public.admin_list_orders(p_person => (select order_number from public.orders where id = (select id from t where name = 'o1')))$$,
  $$values ('sent'::text, now())$$, 'AC-14: admin_list_orders — „Wysłano <data>”');
reset role;

select * from finish();
rollback;
