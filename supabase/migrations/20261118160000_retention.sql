-- SPEC-005 AC-30, AC-31, §8 i SPEC-002 §9 (ADR-0006): retencja książki rejestru pobytu, podpisów i `audit_log`.
-- Okresy przechowywania jako funkcje SQL (zmiana przez PR i migrację). Pliki podpisów usuwa Edge Function `retention`
-- przez Storage API (wywoływana przez `pg_cron` + `pg_net`), dopiero potem `purge_range_log()` usuwa wiersze.

-- ===== Okresy przechowywania =====

create function public.range_log_retention()
returns interval
language sql immutable set search_path = ''
as $$ select interval '1 year' $$;
comment on function public.range_log_retention() is 'SPEC-005 §9: wpisy książki i podpisy — 1 rok od wpisu';

create function public.audit_log_retention()
returns interval
language sql immutable set search_path = ''
as $$ select interval '1 year' $$;
comment on function public.audit_log_retention() is 'SPEC-002 §9: dziennik zmian — 1 rok';

-- AC-31: podpis bez wpisu (zapis wpisu nie doszedł do skutku) czeka 24 h, bo wpis może jeszcze powstać.
create function public.orphan_signature_grace()
returns interval
language sql immutable set search_path = ''
as $$ select interval '24 hours' $$;

-- ===== Książka: pliki do usunięcia i wiersze =====

-- Pliki podpisów do usunięcia: wpisów starszych niż retencja (AC-30) i osierocone starsze niż 24 h (AC-31).
-- Zwraca tylko ścieżki (bez danych osobowych). Wywołuje Edge Function `retention` kluczem secret.
create function public.retention_signatures(p_limit integer default 1000)
returns table (name text, orphan boolean)
language sql stable security definer set search_path = ''
as $$
  (select r.signature_path, false
     from public.range_log r
     join storage.objects o on o.bucket_id = 'signatures' and o.name = r.signature_path
    where r.entered_at < now() - public.range_log_retention()
    order by r.entered_at
    limit p_limit)
  union all
  (select o.name, true
     from storage.objects o
    where o.bucket_id = 'signatures'
      and o.created_at < now() - public.orphan_signature_grace()
      and not exists (select 1 from public.range_log r where r.signature_path = o.name)
    order by o.created_at
    limit p_limit);
$$;
revoke execute on function public.retention_signatures(integer) from public, anon, authenticated;
grant execute on function public.retention_signatures(integer) to service_role;

-- AC-30: usuwa wpisy starsze niż retencja, których plik podpisu już nie istnieje (pliki najpierw — ADR-0006;
-- nieudane usunięcie pliku zostawia wpis do następnego uruchomienia). Adnotacje — kaskadą, `pass_usages` zostaje
-- z `range_log_entry_id = null`. Jedyne miejsce, które ustawia `sv.range_log_purge` (wyzwalacz `range_log_immutable`).
create function public.purge_range_log()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  deleted integer;
begin
  perform set_config('sv.range_log_purge', 'on', true);
  delete from public.range_log r
   where r.entered_at < now() - public.range_log_retention()
     and not exists (select 1 from storage.objects o where o.bucket_id = 'signatures' and o.name = r.signature_path);
  get diagnostics deleted = row_count;
  perform set_config('sv.range_log_purge', 'off', true);
  return deleted;
end;
$$;
revoke execute on function public.purge_range_log() from public, anon, authenticated;
grant execute on function public.purge_range_log() to service_role;

-- ===== Dziennik zmian (SPEC-002 §9) =====

-- Tylko baza, więc wywoływana bezpośrednio przez `pg_cron`. Idempotentna; zwraca liczbę usuniętych wpisów.
create function public.purge_audit_log()
returns integer
language sql volatile security definer set search_path = ''
as $$
  with deleted as (
    delete from public.audit_log where created_at < now() - public.audit_log_retention() returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke execute on function public.purge_audit_log() from public, anon, authenticated;

-- ===== Harmonogram (UTC) =====

create extension if not exists pg_net with schema extensions;

-- Wywołanie Edge Function `retention`. URL projektu i sekret wywołania z Vault (sekrety `project_url`
-- i `retention_invoke_secret`, ustawia właściciel). Bez sekretów (lokalnie, CI) — tylko komunikat, bez błędu.
create function public.invoke_retention()
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'retention_invoke_secret';
  if base_url is null or secret is null then
    raise notice 'retention: brak sekretów project_url / retention_invoke_secret w Vault';
    return null;
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.invoke_retention() from public, anon, authenticated;

select cron.schedule('purge-audit-log', '15 2 * * *', 'select public.purge_audit_log()');
select cron.schedule('range-log-retention', '30 2 * * *', 'select public.invoke_retention()');
