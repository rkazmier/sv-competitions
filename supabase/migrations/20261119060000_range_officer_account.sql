-- SPEC-007 §5 (#113): uprawnienia prowadzącego zgłaszane z konta — kolumny `range_officers`, funkcje użytkownika,
-- zatwierdzanie (`review_range_officer` + `audit_log`), synchronizacja imienia i nazwiska z profilem, RLS
-- i warunek „na liście” (`is_active and status = 'approved'`) w `create_range_log_entry`.

alter table public.range_officers
  add column profile_id uuid unique references public.profiles (id) on delete cascade,
  add column status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  add column hide_from_others boolean not null default false,
  add column submitted_at timestamptz,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add constraint range_officers_hide_own check (profile_id is not null or not hide_from_others),
  -- Zgłoszenie z konta zawsze z nr legitymacji (a przez `range_officers_license_pair` — z instytucją).
  add constraint range_officers_account_license check (profile_id is null or license_number is not null);

comment on column public.range_officers.profile_id is 'Konto zgłaszającego (SPEC-007); null = dodany przez admina';
comment on column public.range_officers.status is 'pending | approved | rejected; „na liście” = is_active and status = approved';
comment on column public.range_officers.hide_from_others is '„Ukryj mnie dla innych” — tylko wyszukiwarka i własny wpis';

-- ===== RLS (§5) =====

-- Admin dodaje tylko wiersze bez konta. Zmiany: polityka dopuszcza admina, a wyzwalacz niżej zawęża zgłoszenia
-- z kont do `is_active` („Ukryj” / „Przywróć”, AC-10) — RLS nie ogranicza kolumn per wiersz.
drop policy "range_officers: admin insert" on public.range_officers;
create policy "range_officers: admin insert" on public.range_officers for insert to authenticated
  with check ((select public.is_admin()) and profile_id is null);

-- Bezpośredni zapis z API (rola `authenticated`) w zgłoszeniu z konta: tylko `is_active`. Funkcje `security definer`
-- (właściciel `postgres`) i synchronizacja nazwiska przechodzą.
create function public.range_officers_account_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.profile_id is not null and current_user in ('authenticated', 'anon')
     and to_jsonb(new) - 'is_active' <> to_jsonb(old) - 'is_active' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger range_officers_account_guard before update on public.range_officers
  for each row execute function public.range_officers_account_guard();

-- ===== Synchronizacja imienia i nazwiska (AC-14) =====

-- Kopia z profilu bez ponownego zatwierdzenia; dawne wpisy książki mają własną kopię. Wyczyszczone imię i nazwisko
-- w profilu (null) nie nadpisuje kopii — `range_officers.full_name` jest wymagane.
create function public.sync_range_officer_name()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.full_name is not null then
    update public.range_officers r set full_name = new.full_name
      where r.profile_id = new.id and r.full_name is distinct from new.full_name;
  end if;
  return null;
end;
$$;
revoke execute on function public.sync_range_officer_name() from public, anon, authenticated;
create trigger sync_range_officer_name after update of full_name on public.profiles
  for each row execute function public.sync_range_officer_name();

-- ===== Funkcje użytkownika (AC-3, AC-4, AC-6, AC-11…AC-13) =====

create function public.my_range_officer()
returns table (status text, license_number text, institution text, institution_other text, hide_from_others boolean,
               is_active boolean, submitted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.status, r.license_number, r.institution, r.institution_other, r.hide_from_others, r.is_active, r.submitted_at
    from public.range_officers r where r.profile_id = auth.uid();
$$;

-- Tworzy, przywraca (po „Usuń” lub „Ukryj” admina) albo edytuje jedyne zgłoszenie konta. `pending` przy nowym,
-- przywróconym albo zmianie nr legitymacji / instytucji; sama zmiana „Ukryj mnie dla innych” — bez zmiany statusu.
-- Błędy: `forbidden`, `full_name_required`, `23514` z nazwą `check` (np. `range_officers_license_pair`,
-- `range_officers_institution_other`, `range_officers_account_license`), `23505` przy równoległym drugim zgłoszeniu.
create function public.save_my_range_officer(
  p_license_number text,
  p_institution text,
  p_institution_other text default null,
  p_hide_from_others boolean default true
)
returns table (status text, license_number text, institution text, institution_other text, hide_from_others boolean,
               is_active boolean, submitted_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text;
  lic text := nullif(trim(p_license_number), '');
  inst text := nullif(trim(p_institution), '');
  inst_other text := nullif(trim(p_institution_other), '');
  existing public.range_officers;
begin
  if uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.full_name into v_name from public.profiles p where p.id = uid;
  if v_name is null then
    raise exception 'full_name_required' using errcode = 'P0001';
  end if;

  select * into existing from public.range_officers r where r.profile_id = uid for update;
  if not found then
    insert into public.range_officers (profile_id, full_name, license_number, institution, institution_other,
                                       hide_from_others, status, submitted_at)
      values (uid, v_name, lic, inst, inst_other, coalesce(p_hide_from_others, true), 'pending', now());
  elsif not existing.is_active
        or (lic, inst, inst_other) is distinct from
           (existing.license_number, existing.institution, existing.institution_other) then
    update public.range_officers r set
        full_name = v_name, license_number = lic, institution = inst, institution_other = inst_other,
        hide_from_others = coalesce(p_hide_from_others, r.hide_from_others), is_active = true,
        status = 'pending', submitted_at = now(), reviewed_by = null, reviewed_at = null
      where r.id = existing.id;
  else
    update public.range_officers r set hide_from_others = coalesce(p_hide_from_others, r.hide_from_others)
      where r.id = existing.id;
  end if;
  return query select * from public.my_range_officer();
end;
$$;

create function public.set_my_range_officer_hidden(p_hidden boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_hidden is null then
    raise exception 'invalid_hidden' using errcode = '22023';
  end if;
  update public.range_officers r set hide_from_others = p_hidden where r.profile_id = auth.uid();
  if not found then
    raise exception 'range_officer_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- „Usuń” wyłącza z list; wiersz zostaje dla `range_log.range_officer_id` (SPEC-005 AC-26, §9).
create function public.remove_my_range_officer()
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.range_officers r set is_active = false where r.profile_id = auth.uid();
  if not found then
    raise exception 'range_officer_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.my_range_officer(), public.save_my_range_officer(text, text, text, boolean),
  public.set_my_range_officer_hidden(boolean), public.remove_my_range_officer() from public, anon;
grant execute on function public.my_range_officer(), public.save_my_range_officer(text, text, text, boolean),
  public.set_my_range_officer_hidden(boolean), public.remove_my_range_officer() to authenticated;

-- ===== Zatwierdzanie (AC-8, AC-9) =====

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked', 'range_officer_review'));

-- Obsługa lub admin; tylko zgłoszenie z konta w stanie `pending` (blokada wiersza — równoległa decyzja → `not_pending`).
-- Błędy: `forbidden`, `invalid_decision`, `not_pending`.
create function public.review_range_officer(p_id uuid, p_decision text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  officer public.range_officers;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into officer from public.range_officers r where r.id = p_id for update;
  if not found or officer.profile_id is null or officer.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.range_officers r set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now()
    where r.id = officer.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), officer.profile_id, 'range_officer_review',
            jsonb_build_object('range_officer_id', officer.id, 'decision', p_decision,
                               'license_number', officer.license_number, 'institution', officer.institution));
end;
$$;
revoke execute on function public.review_range_officer(uuid, text) from public, anon;
grant execute on function public.review_range_officer(uuid, text) to authenticated;

-- ===== Wpis do książki: prowadzący „na liście” (AC-5) =====

-- Bez zmian względem 20261118150000_range_log.sql poza warunkiem prowadzącego: `is_active and status = 'approved'`.
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
