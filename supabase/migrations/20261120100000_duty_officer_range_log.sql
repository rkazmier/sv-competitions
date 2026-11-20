-- SPEC-008 §5, ADR-0007 (#129): dyżurny Prowadzący z konta prowadzi książkę rejestru pobytu w dniu dyżuru.
-- Dostęp liczony przy każdym wywołaniu (`range_duty_for(range_today())`) — bez nowej roli i bez zapisu uprawnienia.
-- `can_keep_range_log()` zastępuje `is_staff()` tylko w funkcjach i politykach wpisu; definicje funkcji poniżej są
-- kopiami ostatnich wersji (źródło w komentarzu) — jedyna zmiana to warunek dostępu (oraz `security definer`
-- w `passes_for_range_entry`). Bez zmian: ustawianie dyżurnego, grafik, sprzedaż, zatwierdzanie, odczyt tabel.

-- ===== Nowe funkcje =====

-- Wywołujący jest prowadzącym z konta (`profile_id = auth.uid()`), który dziś jest dyżurnym; „na liście” sprawdza
-- `range_duty_for`. Zwraca tylko informację o wywołującym (UI: `/konto/`, bramka panelu).
create function public.is_range_duty_officer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.range_duty_for(public.range_today()) d
      join public.range_officers r on r.id = d.range_officer_id
     where r.profile_id = auth.uid());
$$;
revoke execute on function public.is_range_duty_officer() from public, anon;
grant execute on function public.is_range_duty_officer() to authenticated;

create function public.can_keep_range_log()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_staff() or public.is_range_duty_officer();
$$;
revoke execute on function public.can_keep_range_log() from public, anon;
grant execute on function public.can_keep_range_log() to authenticated;

-- ===== Znalezienie osoby i jej dane (AC-5, AC-6) =====

-- Jak w 20261118150000_range_log.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_find_by_qr(p_token text)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.* from public.profiles p, public.staff_person_summary(p) s where p.qr_token = p_token;
end;
$$;

-- Jak w 20261118150000_range_log.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_search_people(p_query text)
returns table (id uuid, full_name text, email_hint text, is_range_ready boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
begin
  if not public.can_keep_range_log() then
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

-- Jak w 20261118210000_range_log_person.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_person_by_id(p_id uuid)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.* from public.profiles p, public.staff_person_summary(p) s where p.id = p_id;
end;
$$;

-- Jak w 20261118220000_range_log_sign.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_person_entry_data(p_id uuid)
returns table (full_name text, permit_number text, permit_authority text, address text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select p.full_name, p.permit_number, p.permit_authority, p.address
    from public.profiles p where p.id = p_id;
end;
$$;

-- AC-6: `audit_log` (`profile_update`) zapisuje wyzwalacz `audit_profile_changes` z aktorem = `auth.uid()` (dyżurny).
-- Jak w 20261118210000_range_log_person.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_complete_profile(
  p_id uuid,
  p_full_name text default null,
  p_permit_number text default null,
  p_permit_authority text default null,
  p_address text default null
)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_permit_number text := nullif(trim(p_permit_number), '');
  v_permit_authority text := nullif(trim(p_permit_authority), '');
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (v_permit_number is null) <> (v_permit_authority is null) then
    raise exception 'permit_pair' using errcode = '23514';
  end if;
  update public.profiles p set
      full_name = coalesce(p.full_name, p_full_name),
      permit_number = case when p.permit_number is null and p.address is null then v_permit_number else p.permit_number end,
      permit_authority = case when p.permit_number is null and p.address is null then v_permit_authority
                              else p.permit_authority end,
      address = case when p.permit_number is null and p.address is null then p_address else p.address end
    where p.id = p_id;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;
  return query select s.* from public.profiles p, public.staff_person_summary(p) s where p.id = p_id;
end;
$$;

-- ===== Wpis (AC-9, AC-10) — `created_by = auth.uid()` jak dotąd =====

-- Jak w 20261119060000_range_officer_account.sql; warunek: `can_keep_range_log()`.
create or replace function public.create_range_log_entry(
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
  if not public.can_keep_range_log() then
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
  select * into officer from public.range_officers r
    where r.id = p_range_officer_id and r.is_active and r.status = 'approved';
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

-- ===== Dyżurny i wybór Prowadzącego przy wpisie (AC-2, AC-9) — tylko odczyt =====

-- Jak w 20261119070000_range_duty.sql; warunek: `can_keep_range_log()`.
create or replace function public.current_range_duty()
returns table (range_officer_id uuid, full_name text, source text, event_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.range_duty_for(public.range_today());
end;
$$;

-- Jak w 20261119070000_range_duty.sql; warunek: `can_keep_range_log()`.
create or replace function public.staff_search_range_officers(p_query text)
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 3 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select r.id, r.full_name from public.range_officers r
     where r.is_active and r.status = 'approved' and r.full_name ilike pattern
     order by r.full_name, r.id
     limit 10;
end;
$$;

-- Jak w 20261119080000_range_officer_choices.sql; warunek: `can_keep_range_log()`.
create or replace function public.range_officer_choices(p_person_id uuid default null)
returns table (id uuid, full_name text, is_person boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.id, r.full_name, (p_person_id is not null and r.profile_id is not distinct from p_person_id)
      from public.range_officers r
     where r.is_active and r.status = 'approved'
       and (not r.hide_from_others or (p_person_id is not null and r.profile_id = p_person_id))
     order by 3 desc, r.full_name, r.id;
end;
$$;

-- ===== Uprawnienia osoby (AC-7) =====

-- Jak w 20261118150000_range_log.sql, ale `security definer` z jawnym warunkiem: dotąd działała dzięki RLS
-- `orders` / `user_passes` dla Obsługi, a dyżurny nie dostaje odczytu tych tabel (ADR-0007).
create or replace function public.passes_for_range_entry(p_user_id uuid)
returns table (
  priority integer, id uuid, kind text, item_name text, entries_left integer, days_total integer,
  first_used_on date, valid_until date, expires_on date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select case p.kind when 'event_ticket' then 0
                       when 'days' then case when p.first_used_on is null then 2 else 1 end
                       when 'entries' then 3 else 4 end,
           p.id, p.kind, o.item_name, p.entries_left, p.days_total, p.first_used_on, p.valid_until, p.expires_on
    from public.passes_valid_on(p_user_id, public.range_today()) p
    join public.orders o on o.id = p.order_id
    order by 1, p.expires_on, p.created_at;
end;
$$;

-- ===== RLS: dzisiejsze wpisy, adnotacje, podpisy (AC-11, AC-12, AC-10) =====

drop policy "range_log: admin all, staff today" on public.range_log;
create policy "range_log: admin all, staff today" on public.range_log for select to authenticated
  using ((select public.is_admin())
         or ((select public.can_keep_range_log())
             and (entered_at at time zone 'Europe/Warsaw')::date = public.range_today()));

-- Wpis widoczny przez RLS `range_log` (prowadzący książkę — tylko dzisiejsze), więc AC-12 wynika z tego samego warunku.
drop policy "range_log_annotations: read as entry" on public.range_log_annotations;
create policy "range_log_annotations: read as entry" on public.range_log_annotations for select to authenticated
  using ((select public.can_keep_range_log()) and exists (select 1 from public.range_log r where r.id = entry_id));
drop policy "range_log_annotations: admin any, staff today" on public.range_log_annotations;
create policy "range_log_annotations: admin any, staff today" on public.range_log_annotations for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      (select public.is_admin())
      or ((select public.can_keep_range_log()) and exists (
        select 1 from public.range_log r
        where r.id = entry_id and (r.entered_at at time zone 'Europe/Warsaw')::date = public.range_today())))
  );

-- Nazwy polityk bez zmian (SPEC-008 §5); „staff” = prowadzący książkę (`can_keep_range_log()`).
-- Odczyt podpisów nadal tylko admin („signatures: admin read”).
drop policy "signatures: staff insert" on storage.objects;
create policy "signatures: staff insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures' and (select public.can_keep_range_log())
    and name ~ '^[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  );
