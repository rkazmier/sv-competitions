-- SPEC-005 §5 (AC-10, AC-15, AC-16, AC-21, AC-22): książka rejestru pobytu — prowadzący strzelanie, wpisy
-- (tylko `insert`), adnotacje, zużycie uprawnień `pass_usages`, prywatny bucket `signatures`, funkcje obsługi
-- `create_range_log_entry`, `staff_find_by_qr`, `staff_search_people`, `passes_for_range_entry`, `my_range_entries`.
-- Panel, podpis, eksport i retencja (`purge_range_log`) — zadania #59…#64.

-- Dzisiejszy dzień strzelnicy (Europe/Warsaw) z zegara bazy, nie urządzenia (§7).
create function public.range_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Warsaw')::date;
$$;

-- ===== Tabele =====

create table public.range_officers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(full_name) between 2 and 150 and full_name = trim(full_name)),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.range_officers is 'Prowadzący strzelanie (SPEC-005 AC-1): ukrywanie zamiast usuwania';

create table public.range_log (
  id uuid primary key,
  entered_at timestamptz not null default now(),
  full_name text not null check (length(full_name) between 2 and 150),
  permit_number text check (length(permit_number) between 1 and 50),
  permit_authority text check (length(permit_authority) between 2 and 150),
  address text check (length(address) between 5 and 300),
  range_officer_name text not null check (length(range_officer_name) between 2 and 150),
  range_officer_id uuid references public.range_officers (id) on delete set null,
  signature_path text not null unique,
  profile_id uuid references public.profiles (id) on delete set null,
  is_companion boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  constraint range_log_permit_pair check ((permit_number is null) = (permit_authority is null)),
  constraint range_log_permit_or_address check (permit_number is not null or address is not null)
);
create index range_log_entered_at_idx on public.range_log (entered_at);
create index range_log_profile_idx on public.range_log (profile_id, entered_at desc);

comment on table public.range_log is 'Książka rejestru pobytu (SPEC-005 §5): kopie danych osoby i prowadzącego; bez update/delete, retencja 1 rok';
comment on column public.range_log.id is 'Nadawany przez klienta przed wysłaniem podpisu (ścieżka pliku)';
comment on column public.range_log.signature_path is 'Nazwa obiektu w buckecie signatures: <RRRR>/<MM>/<id>.png';

create table public.range_log_annotations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.range_log (id) on delete cascade,
  body text not null check (length(trim(body)) between 5 and 500),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index range_log_annotations_entry_idx on public.range_log_annotations (entry_id, created_at);

comment on table public.range_log_annotations is 'Korekty wpisów (SPEC-005 AC-21): tylko insert';

create table public.pass_usages (
  id uuid primary key default gen_random_uuid(),
  user_pass_id uuid not null references public.user_passes (id) on delete cascade,
  range_log_entry_id uuid unique references public.range_log (id) on delete set null,
  used_on date not null,
  effect text not null check (effect in ('activated', 'covered', 'decremented', 'consumed')),
  reverted_at timestamptz,
  reverted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index pass_usages_pass_idx on public.pass_usages (user_pass_id, created_at);

comment on table public.pass_usages is 'Zużycie uprawnień (SPEC-005 §5); zostaje po retencji wpisu (range_log_entry_id = null)';

-- ===== Niezmienność (AC-21) =====

-- Jedyna dozwolona zmiana: `on delete set null` kluczy obcych (usunięcie konta lub prowadzącego).
create function public.range_log_immutable()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  fk text[] := case tg_table_name when 'range_log' then array['profile_id', 'created_by', 'range_officer_id']
                                  else array['created_by'] end;
  col text;
begin
  if tg_op = 'DELETE' then
    -- Usuwa wyłącznie zadanie retencji (#64), ustawiając `sv.range_log_purge` w swojej transakcji.
    if current_setting('sv.range_log_purge', true) = 'on' then
      return old;
    end if;
    raise exception 'range_log_immutable' using errcode = '23514';
  end if;
  foreach col in array fk loop
    if to_jsonb(new) -> col <> 'null'::jsonb and to_jsonb(new) -> col <> to_jsonb(old) -> col then
      raise exception 'range_log_immutable' using errcode = '23514';
    end if;
  end loop;
  if to_jsonb(new) - fk <> to_jsonb(old) - fk then
    raise exception 'range_log_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger range_log_immutable before update or delete on public.range_log
  for each row execute function public.range_log_immutable();
create trigger range_log_annotations_immutable before update on public.range_log_annotations
  for each row execute function public.range_log_immutable();

-- ===== Ważność jednego uprawnienia (SPEC-003 §5) =====

-- Reguły z `passes_valid_on` dla jednego wiersza — także uprawnienia bez właściciela (osoba bez konta, AC-19).
create function public.pass_valid_on(p public.user_passes, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p.status = 'active'
    and case p.kind
      when 'days' then
        case when p.first_used_on is null then p_date <= p.expires_on
             else p_date between p.first_used_on and p.valid_until end
      when 'single_entry' then
        p_date <= p.expires_on and (extract(isodow from p_date) in (6, 7)) = (p.day_type = 'weekend')
      when 'event_ticket' then
        p_date <= p.expires_on and p_date between
          (select e.starts_on from public.calendar_events e where e.id = p.calendar_event_id) and p.valid_until
      else p_date <= p.expires_on
    end;
$$;

create or replace function public.passes_valid_on(p_user_id uuid, p_date date)
returns setof public.user_passes
language sql stable security invoker set search_path = ''
as $$
  select p.* from public.user_passes p
  where p.user_id = p_user_id and public.pass_valid_on(p, p_date)
  order by p.expires_on, p.created_at;
$$;

-- AC-10: kolejność zużycia — (0) wejściówka, (1) aktywny czasowy, (2) nieaktywowany czasowy, (3) ilościowy,
-- (4) jednorazowe; w grupie wg najwcześniejszego `expires_on`. Invoker: RLS `user_passes`/`orders` (własne lub obsługa).
create function public.passes_for_range_entry(p_user_id uuid)
returns table (
  priority integer, id uuid, kind text, item_name text, entries_left integer, days_total integer,
  first_used_on date, valid_until date, expires_on date
)
language sql stable security invoker set search_path = ''
as $$
  select case p.kind when 'event_ticket' then 0
                     when 'days' then case when p.first_used_on is null then 2 else 1 end
                     when 'entries' then 3 else 4 end,
         p.id, p.kind, o.item_name, p.entries_left, p.days_total, p.first_used_on, p.valid_until, p.expires_on
  from public.passes_valid_on(p_user_id, public.range_today()) p
  join public.orders o on o.id = p.order_id
  order by 1, p.expires_on, p.created_at;
$$;
revoke execute on function public.passes_for_range_entry(uuid) from public, anon;
grant execute on function public.passes_for_range_entry(uuid) to authenticated;

-- SPEC-003 AC-25: od teraz także zapisane (niewycofane) zużycia.
create or replace function public.pass_has_usage(p_pass_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.user_passes p where p.id = p_pass_id
        and (p.status <> 'active' or p.first_used_on is not null or p.entries_left < p.entries_total))
    or exists (select 1 from public.pass_usages u where u.user_pass_id = p_pass_id and u.reverted_at is null);
$$;

-- ===== Obsługa: znalezienie osoby (AC-5, AC-6, AC-9) =====

-- Minimum danych: imię i nazwisko, gotowość, braki (`full_name`, `permit_or_address`), godzina dzisiejszego wpisu.
create function public.staff_person_summary(p public.profiles)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.is_range_ready,
         array_remove(array[
           case when p.full_name is null then 'full_name' end,
           case when p.permit_number is null and p.address is null then 'permit_or_address' end], null),
         (select max(r.entered_at) from public.range_log r
           where r.profile_id = p.id and r.entered_at >= (public.range_today()::timestamp at time zone 'Europe/Warsaw'));
$$;
revoke execute on function public.staff_person_summary(public.profiles) from public, anon, authenticated;

-- AC-5: nieznany lub stary kod → brak wierszy.
create function public.staff_find_by_qr(p_token text)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.* from public.profiles p, public.staff_person_summary(p) s where p.qr_token = p_token;
end;
$$;
revoke execute on function public.staff_find_by_qr(text) from public, anon;
grant execute on function public.staff_find_by_qr(text) to authenticated;

-- AC-6: min. 3 znaki imienia i nazwiska lub e-maila, maks. 10 osób; e-mail tylko częściowo („ja…@example.com”).
create function public.staff_search_people(p_query text)
returns table (id uuid, full_name text, email_hint text, is_range_ready boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 3 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.full_name, left(split_part(u.email, '@', 1), 2) || '…@' || split_part(u.email, '@', 2),
           p.is_range_ready
    from public.profiles p join auth.users u on u.id = p.id
    where p.full_name ilike pattern or u.email ilike pattern
    order by p.full_name nulls last, p.id
    limit 10;
end;
$$;
revoke execute on function public.staff_search_people(text) from public, anon;
grant execute on function public.staff_search_people(text) to authenticated;

-- ===== Zapis wpisu (AC-15, AC-16, AC-19, AC-20) =====

-- Jedna transakcja: podpis w buckecie, dane osoby (kopia z profilu albo podane dla osoby bez konta), aktywny
-- prowadzący, ważność uprawnienia z blokadą wiersza (`for update` — równoległe zużycie ostatniego wejścia → błąd),
-- wpis i zużycie. Osoba towarzysząca: bez uprawnienia i zużycia. Ponowienie z tym samym id → istniejący wpis.
-- Błędy: `forbidden`, `invalid_signature_path`, `signature_missing`, `range_officer_inactive`, `person_not_found`,
-- `person_data_incomplete`, `pass_required`, `pass_not_valid`, `entry_exists`.
create function public.create_range_log_entry(
  p_id uuid,
  p_signature_path text,
  p_range_officer_id uuid,
  p_profile_id uuid default null,
  p_user_pass_id uuid default null,
  p_is_companion boolean default false,
  p_full_name text default null,
  p_permit_number text default null,
  p_permit_authority text default null,
  p_address text default null
)
returns table (id uuid, entered_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  today date := public.range_today();
  existing public.range_log;
  officer public.range_officers;
  person public.profiles;
  pass public.user_passes;
  usage_effect text;
  entry public.range_log;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into existing from public.range_log r where r.id = p_id;
  if found then
    if existing.created_by is distinct from auth.uid() then
      raise exception 'entry_exists' using errcode = '23505';
    end if;
    return query select existing.id, existing.entered_at;
    return;
  end if;
  if p_id is null or p_signature_path is null
     or p_signature_path !~ ('^[0-9]{4}/[0-9]{2}/' || p_id::text || '\.png$') then
    raise exception 'invalid_signature_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'signatures' and o.name = p_signature_path) then
    raise exception 'signature_missing' using errcode = 'P0001';
  end if;
  select * into officer from public.range_officers r where r.id = p_range_officer_id and r.is_active;
  if not found then
    raise exception 'range_officer_inactive' using errcode = 'P0001';
  end if;

  if p_profile_id is not null then
    select * into person from public.profiles p where p.id = p_profile_id;
    if not found then
      raise exception 'person_not_found' using errcode = 'P0002';
    end if;
  else
    person.full_name := nullif(trim(p_full_name), '');
    person.permit_number := nullif(trim(p_permit_number), '');
    person.permit_authority := nullif(trim(p_permit_authority), '');
    person.address := nullif(trim(p_address), '');
  end if;
  if person.full_name is null or (person.permit_number is null and person.address is null)
     or (person.permit_number is null) <> (person.permit_authority is null) then
    raise exception 'person_data_incomplete' using errcode = 'P0001';
  end if;

  if not coalesce(p_is_companion, false) then
    if p_user_pass_id is null then
      raise exception 'pass_required' using errcode = '22023';
    end if;
    select * into pass from public.user_passes p where p.id = p_user_pass_id for update;
    if not found or pass.user_id is distinct from p_profile_id or not public.pass_valid_on(pass, today)
       -- Uprawnienie bez właściciela (AC-19) zużywa się jednym wpisem.
       or (pass.user_id is null and public.pass_has_usage(pass.id)) then
      raise exception 'pass_not_valid' using errcode = 'P0001';
    end if;
    usage_effect := case pass.kind
      when 'days' then case when pass.first_used_on is null then 'activated' else 'covered' end
      when 'event_ticket' then 'covered'
      when 'entries' then 'decremented'
      else 'consumed' end;
    update public.user_passes p set
        first_used_on = case when usage_effect = 'activated' then today else p.first_used_on end,
        entries_left = case when usage_effect = 'decremented' then p.entries_left - 1 else p.entries_left end,
        status = case when usage_effect = 'consumed' then 'used_up' else p.status end
      where p.id = pass.id;
  elsif p_user_pass_id is not null then
    raise exception 'pass_not_allowed' using errcode = '22023';
  end if;

  insert into public.range_log (id, full_name, permit_number, permit_authority, address, range_officer_name,
                                range_officer_id, signature_path, profile_id, is_companion, created_by)
    values (p_id, person.full_name, person.permit_number, person.permit_authority, person.address, officer.full_name,
            officer.id, p_signature_path, p_profile_id, coalesce(p_is_companion, false), auth.uid())
    returning * into entry;
  if usage_effect is not null then
    insert into public.pass_usages (user_pass_id, range_log_entry_id, used_on, effect)
      values (pass.id, entry.id, today, usage_effect);
  end if;
  return query select entry.id, entry.entered_at;
end;
$$;
revoke execute on function public.create_range_log_entry(uuid, text, uuid, uuid, uuid, boolean, text, text, text, text)
  from public, anon;
grant execute on function public.create_range_log_entry(uuid, text, uuid, uuid, uuid, boolean, text, text, text, text)
  to authenticated;

-- ===== Użytkownik: historia wejść (AC-24) =====

-- Własne wpisy bez podpisu i kolumn technicznych; nazwa wykorzystanego uprawnienia z zamówienia.
create function public.my_range_entries()
returns table (id uuid, entered_at timestamptz, range_officer_name text, is_companion boolean, pass_name text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.entered_at, r.range_officer_name, r.is_companion, o.item_name
  from public.range_log r
  left join public.pass_usages u on u.range_log_entry_id = r.id and u.reverted_at is null
  left join public.user_passes p on p.id = u.user_pass_id
  left join public.orders o on o.id = p.order_id
  where r.profile_id = auth.uid()
  order by r.entered_at desc;
$$;
revoke execute on function public.my_range_entries() from public, anon;
grant execute on function public.my_range_entries() to authenticated;

-- ===== RLS (§5) =====

alter table public.range_officers enable row level security;
alter table public.range_log enable row level security;
alter table public.range_log_annotations enable row level security;
alter table public.pass_usages enable row level security;

create policy "range_officers: staff read" on public.range_officers for select to authenticated
  using ((select public.is_staff()));
create policy "range_officers: admin insert" on public.range_officers for insert to authenticated
  with check ((select public.is_admin()));
create policy "range_officers: admin update" on public.range_officers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "range_log: admin all, staff today" on public.range_log for select to authenticated
  using ((select public.is_admin())
         or ((select public.is_staff()) and (entered_at at time zone 'Europe/Warsaw')::date = public.range_today()));

-- Wpis widoczny przez RLS `range_log` (obsługa — tylko dzisiejsze), więc AC-22 wynika z tego samego warunku.
create policy "range_log_annotations: read as entry" on public.range_log_annotations for select to authenticated
  using ((select public.is_staff()) and exists (select 1 from public.range_log r where r.id = entry_id));
create policy "range_log_annotations: admin any, staff today" on public.range_log_annotations for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      (select public.is_admin())
      or ((select public.is_staff()) and exists (
        select 1 from public.range_log r
        where r.id = entry_id and (r.entered_at at time zone 'Europe/Warsaw')::date = public.range_today())))
  );

create policy "pass_usages: own or staff read" on public.pass_usages for select to authenticated
  using ((select public.is_staff())
         or exists (select 1 from public.user_passes p where p.id = user_pass_id and p.user_id = (select auth.uid())));

-- Brak update/delete dla wszystkich ról (także service_role); wpis — tylko create_range_log_entry().
revoke all on public.range_officers, public.range_log, public.range_log_annotations, public.pass_usages
  from anon, authenticated;
revoke insert, update, delete, truncate on public.range_log, public.range_log_annotations, public.pass_usages
  from service_role;
grant select, insert (full_name, is_active), update (full_name, is_active) on public.range_officers to authenticated;
grant select on public.range_log, public.range_log_annotations, public.pass_usages to authenticated;
grant insert (entry_id, body) on public.range_log_annotations to authenticated;

-- ===== Storage: podpisy =====

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 204800, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Zapis: obsługa, nazwa <RRRR>/<MM>/<uuid>.png; odczyt (podpisane linki 60 s): admin; brak update/delete.
create policy "signatures: staff insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures' and (select public.is_staff())
    and name ~ '^[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  );
create policy "signatures: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (select public.is_admin()));
