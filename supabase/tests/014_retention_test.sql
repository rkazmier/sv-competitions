-- SPEC-005 AC-30, AC-31 i SPEC-002 §9 (ADR-0006): retencja książki, podpisów i dziennika zmian.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'jan.kowalski@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10);
create temp table t (name text primary key, id uuid);
with o as (
  insert into public.orders (user_id, product_id, item_name, amount, payment_method)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001', 'Karnet 10 wejść',
            120000, 'tpay')
    returning id
)
insert into t select 'pass', public.fulfil_order(o.id) from o;

-- Wpis z podpisem (dane wstawione bezpośrednio, z datą wpisu w przeszłości) i plikiem w buckecie.
create function pg_temp.entry(p_id uuid, p_age interval) returns void language sql as $$
  insert into storage.objects (bucket_id, name, created_at)
    values ('signatures', '2025/01/' || p_id || '.png', now() - p_age);
  insert into public.range_log (id, entered_at, full_name, address, range_officer_name, signature_path, profile_id)
    values (p_id, now() - p_age, 'Jan Kowalski', 'ul. Testowa 1, Katowice', 'Piotr Prowadzący',
            '2025/01/' || p_id || '.png', '00000000-0000-0000-0000-0000000000c1');
$$;
-- Plik bez wpisu (zapis wpisu nie doszedł do skutku).
create function pg_temp.orphan(p_id uuid, p_age interval) returns void language sql as $$
  insert into storage.objects (bucket_id, name, created_at)
    values ('signatures', '2026/11/' || p_id || '.png', now() - p_age);
$$;
-- Usunięcie plików jak przez Storage API (Edge Function `retention`).
create function pg_temp.remove_files(p_names text[]) returns void language plpgsql as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'signatures' and name = any (p_names);
  perform set_config('storage.allow_delete_query', 'false', true);
end;
$$;

select pg_temp.entry('10000000-0000-0000-0000-000000000001', interval '1 year 1 day');  -- stary
select pg_temp.entry('10000000-0000-0000-0000-000000000002', interval '364 days');      -- jeszcze w retencji
select pg_temp.orphan('20000000-0000-0000-0000-000000000001', interval '25 hours');     -- osierocony, do usunięcia
select pg_temp.orphan('20000000-0000-0000-0000-000000000002', interval '23 hours');     -- osierocony, jeszcze czeka
insert into public.range_log_annotations (entry_id, body, created_by)
  values ('10000000-0000-0000-0000-000000000001', 'Korekta numeru decyzji', '00000000-0000-0000-0000-0000000000a1');
insert into public.pass_usages (user_pass_id, range_log_entry_id, used_on, effect)
  select id, '10000000-0000-0000-0000-000000000001', current_date - 366, 'decremented' from t where name = 'pass';

-- ===== Okresy przechowywania =====

select is(public.range_log_retention(), interval '1 year', 'SPEC-005 §9: retencja książki = 1 rok');
select is(public.audit_log_retention(), interval '1 year', 'SPEC-002 §9: retencja audit_log = 1 rok');
select is(public.orphan_signature_grace(), interval '24 hours', 'AC-31: osierocony podpis czeka 24 h');

-- ===== Pliki do usunięcia (AC-30, AC-31) =====

select set_eq(
  $$select name, orphan from public.retention_signatures()$$,
  $$values ('2025/01/10000000-0000-0000-0000-000000000001.png', false),
           ('2026/11/20000000-0000-0000-0000-000000000001.png', true)$$,
  'AC-30, AC-31: pliki starego wpisu i osierocone starsze niż 24 h; świeże zostają');
select is((select count(*)::integer from public.retention_signatures(1)), 2, 'AC-30: limit na każde źródło osobno');

-- ===== Wiersze dopiero po plikach (ADR-0006) =====

select is(public.purge_range_log(), 0, 'AC-30: wpis z istniejącym plikiem podpisu nie jest usuwany');
select ok(exists (select 1 from public.range_log where id = '10000000-0000-0000-0000-000000000001'),
  'AC-30: stary wpis zostaje do usunięcia pliku');

select pg_temp.remove_files(array(select name from public.retention_signatures()));

select is(public.purge_range_log(), 1, 'AC-30: po usunięciu pliku usuwany jest stary wpis');
select ok(not exists (select 1 from public.range_log where id = '10000000-0000-0000-0000-000000000001'),
  'AC-30: stary wpis usunięty');
select ok(not exists (select 1 from public.range_log_annotations where entry_id = '10000000-0000-0000-0000-000000000001'),
  'AC-30: adnotacje usunięte razem z wpisem');
select is((select count(*)::integer from public.pass_usages where range_log_entry_id is null), 1,
  'AC-30: pass_usages zostaje z range_log_entry_id = null');
select ok(exists (select 1 from public.range_log where id = '10000000-0000-0000-0000-000000000002'),
  'AC-30: wpis młodszy niż rok zostaje');
select ok(exists (select 1 from storage.objects where name = '2025/01/10000000-0000-0000-0000-000000000002.png'),
  'AC-30: podpis wpisu młodszego niż rok zostaje');
select ok(not exists (select 1 from storage.objects where name = '2026/11/20000000-0000-0000-0000-000000000001.png'),
  'AC-31: osierocony podpis starszy niż 24 h usunięty');
select ok(exists (select 1 from storage.objects where name = '2026/11/20000000-0000-0000-0000-000000000002.png'),
  'AC-31: osierocony podpis młodszy niż 24 h zostaje');
select is_empty($$select * from public.retention_signatures()$$, 'ADR-0006: kolejne uruchomienie — nic do usunięcia');
select is(public.purge_range_log(), 0, 'ADR-0006: purge_range_log idempotentne');

-- Poza zadaniem retencji wpisu nadal nie da się usunąć (flaga tylko w transakcji purge_range_log).
select throws_ok($$delete from public.range_log$$, '23514', 'range_log_immutable',
  'AC-21: po purge_range_log zwykły delete nadal zablokowany');

-- ===== Dziennik zmian (SPEC-002 §9) =====

insert into public.audit_log (actor_id, target_user_id, action, changes, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'profile_update', '{}',
   now() - interval '1 year 1 day'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'role_change', '{}',
   now() - interval '364 days');
select is(public.purge_audit_log(), 1, 'SPEC-002 §9: usuwa wpisy dziennika starsze niż rok');
select is((select array_agg(action) from public.audit_log), array['role_change'],
  'SPEC-002 §9: wpis młodszy niż rok zostaje');

-- ===== Uprawnienia i harmonogram =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.purge_range_log()$$, '42501', null, 'ADR-0006: admin nie wywoła purge_range_log');
select throws_ok($$select * from public.retention_signatures()$$, '42501', null,
  'ADR-0006: admin nie pobierze ścieżek podpisów');
select throws_ok($$select public.purge_audit_log()$$, '42501', null, 'ADR-0006: admin nie wywoła purge_audit_log');
select throws_ok($$select public.invoke_retention()$$, '42501', null, 'ADR-0006: admin nie wywoła invoke_retention');
reset role;
set local role service_role;
select lives_ok($$select public.purge_range_log()$$, 'ADR-0006: service_role (Edge Function) wywołuje purge_range_log');
reset role;

select set_eq($$select jobname, schedule from cron.job where jobname in ('purge-audit-log', 'range-log-retention')$$,
  $$values ('purge-audit-log', '15 2 * * *'), ('range-log-retention', '30 2 * * *')$$,
  'ADR-0006: codzienne zadania pg_cron (UTC)');
select is(public.invoke_retention(), null, 'ADR-0006: bez sekretów w Vault — brak wywołania, bez błędu');

select * from finish();
rollback;
