-- SPEC-002 §5: dane do książki rejestru pobytu w `profiles`, `is_range_ready`, kod QR (`qr_token`),
-- dziennik zmian `audit_log`, uprawnienia kolumnowe, wyzwalacz `audit_profile_changes`,
-- funkcje `set_user_role`, `rotate_qr_token`, `admin_list_users` (AC-4, AC-8, AC-10, AC-15, AC-17…AC-19, AC-22).

create extension if not exists pgcrypto with schema extensions;

-- ===== Kod QR =====

-- 32 znaki base64url z 24 losowych bajtów (bez dopełnienia `=`); nie zawiera danych osobowych.
create function public.new_qr_token()
returns text
language sql volatile set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
$$;
revoke execute on function public.new_qr_token() from public, anon, authenticated;

-- ===== profiles: dane osobowe, gotowość, kod QR =====

alter table public.profiles
  add column full_name text check (length(full_name) between 2 and 150),
  add column phone text check (phone ~ '^\+?[0-9 ]{9,20}$'),
  add column permit_number text check (length(permit_number) between 1 and 50),
  add column permit_authority text check (length(permit_authority) between 2 and 150),
  add column address text check (length(address) between 5 and 300),
  add column is_range_ready boolean not null generated always as
    (full_name is not null and (permit_number is not null or address is not null)) stored,
  add column qr_token text not null default public.new_qr_token(),
  add column qr_token_rotated_at timestamptz,
  add column privacy_notice_ack_at timestamptz,
  add column updated_at timestamptz not null default now(),
  -- AC-8: numer decyzji tylko razem z organem wydającym.
  add constraint profiles_permit_pair check ((permit_number is null) = (permit_authority is null)),
  add constraint profiles_qr_token_key unique (qr_token);

comment on column public.profiles.full_name is 'Imię i nazwisko, 2–150 znaków po trim (SPEC-002 §5)';
comment on column public.profiles.permit_number is 'Numer decyzji (pozwolenia na broń); tylko z permit_authority';
comment on column public.profiles.address is 'Adres zamieszkania jednym polem; wymagany do wpisu, gdy brak pozwolenia';
comment on column public.profiles.is_range_ready is 'Gotowy do wpisu do książki rejestru pobytu (AC-10, SPEC-005)';
comment on column public.profiles.qr_token is 'Losowy kod QR konta; zmiana tylko przez rotate_qr_token()';
comment on column public.profiles.role is 'user | staff | admin (ADR-0004); zmiana tylko przez set_user_role() lub właściciela SQL-em';

-- Pola tekstowe po trim; puste ciągi z formularza → null (SPEC-002 §5). updated_at przy każdej zmianie.
create function public.profiles_normalize()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.full_name := nullif(trim(new.full_name), '');
  new.phone := nullif(trim(new.phone), '');
  new.permit_number := nullif(trim(new.permit_number), '');
  new.permit_authority := nullif(trim(new.permit_authority), '');
  new.address := nullif(trim(new.address), '');
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger profiles_normalize before insert or update on public.profiles
  for each row execute function public.profiles_normalize();

-- ===== audit_log =====

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Bez FK: wpis przetrwa usunięcie konta (AC-24).
  target_user_id uuid,
  action text not null check (action in ('profile_update', 'role_change', 'account_delete')),
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_target_idx on public.audit_log (target_user_id, created_at desc);
create index audit_log_created_at_idx on public.audit_log (created_at);

comment on table public.audit_log is 'Dziennik zmian (SPEC-002 §5): changes = {pole: [stara, nowa]}; retencja 1 rok (ADR-0006)';

-- AC-20, AC-22: loguj tylko zmiany danych dokonane przez inną osobę niż właściciel profilu.
-- Rola ma osobny wpis `role_change` w set_user_role(), qr_token zmienia tylko właściciel.
create function public.audit_profile_changes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  diff jsonb := '{}'::jsonb;
begin
  if actor is null or actor = new.id then
    return null;
  end if;
  if new.full_name is distinct from old.full_name then
    diff := diff || jsonb_build_object('full_name', jsonb_build_array(old.full_name, new.full_name));
  end if;
  if new.phone is distinct from old.phone then
    diff := diff || jsonb_build_object('phone', jsonb_build_array(old.phone, new.phone));
  end if;
  if new.permit_number is distinct from old.permit_number then
    diff := diff || jsonb_build_object('permit_number', jsonb_build_array(old.permit_number, new.permit_number));
  end if;
  if new.permit_authority is distinct from old.permit_authority then
    diff := diff || jsonb_build_object('permit_authority', jsonb_build_array(old.permit_authority, new.permit_authority));
  end if;
  if new.address is distinct from old.address then
    diff := diff || jsonb_build_object('address', jsonb_build_array(old.address, new.address));
  end if;
  if new.privacy_notice_ack_at is distinct from old.privacy_notice_ack_at then
    diff := diff || jsonb_build_object('privacy_notice_ack_at',
      jsonb_build_array(old.privacy_notice_ack_at, new.privacy_notice_ack_at));
  end if;
  if diff <> '{}'::jsonb then
    insert into public.audit_log (actor_id, target_user_id, action, changes)
      values (actor, new.id, 'profile_update', diff);
  end if;
  return null;
end;
$$;
revoke execute on function public.audit_profile_changes() from public, anon, authenticated;
create trigger audit_profile_changes after update on public.profiles
  for each row execute function public.audit_profile_changes();

-- ===== Funkcje =====

-- AC-17…AC-19: zmiana roli tylko przez admina; zawsze zostaje co najmniej jeden admin; wpis `role_change`.
create function public.set_user_role(user_id uuid, role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  old_role text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if set_user_role.role is null or set_user_role.role not in ('user', 'staff', 'admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  -- Blokada wszystkich adminów: równoległe odebrania roli nie zostawią systemu bez admina.
  perform 1 from public.profiles p where p.role = 'admin' for update;
  select p.role into old_role from public.profiles p where p.id = set_user_role.user_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if old_role = set_user_role.role then
    return;
  end if;
  if old_role = 'admin'
     and (select count(*) from public.profiles p where p.role = 'admin') = 1 then
    raise exception 'last_admin' using errcode = 'P0001',
      hint = 'Musi zostać co najmniej jeden admin.';
  end if;
  update public.profiles p set role = set_user_role.role where p.id = set_user_role.user_id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), set_user_role.user_id, 'role_change',
            jsonb_build_object('role', jsonb_build_array(old_role, set_user_role.role)));
end;
$$;
revoke execute on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- AC-15: nowy kod QR wywołującego; stary przestaje działać od razu. Kolizja → ponowne losowanie.
create function public.rotate_qr_token()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  token text;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for attempt in 1..5 loop
    begin
      update public.profiles
        set qr_token = public.new_qr_token(), qr_token_rotated_at = now()
        where id = auth.uid()
        returning qr_token into token;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      return token;
    exception when unique_violation then
      -- ponów losowanie
    end;
  end loop;
  raise exception 'qr_token_collision';
end;
$$;
revoke execute on function public.rotate_qr_token() from public, anon;
grant execute on function public.rotate_qr_token() to authenticated;

-- AC-16: lista kont dla admina z e-mailem z auth.users (e-mail nie jest kopiowany do profiles).
-- Wyszukiwanie po imieniu i nazwisku lub e-mailu od 2 znaków (krótsza fraza = bez filtra), 50 na stronę, page od 1.
create function public.admin_list_users(search text default null, page int default 1)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  is_range_ready boolean,
  created_at timestamptz,
  total_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(search, ''))) >= 2 then
    pattern := '%' || replace(replace(replace(trim(search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select p.id, p.full_name, u.email::text, p.role, p.is_range_ready, p.created_at, count(*) over ()
    from public.profiles p
    join auth.users u on u.id = p.id
    where pattern is null or p.full_name ilike pattern or u.email ilike pattern
    order by p.created_at desc, p.id
    limit 50 offset (greatest(coalesce(page, 1), 1) - 1) * 50;
end;
$$;
revoke execute on function public.admin_list_users(text, int) from public, anon;
grant execute on function public.admin_list_users(text, int) to authenticated;

-- ===== RLS i uprawnienia =====

-- profiles: odczyt — własny wiersz (SPEC-001) oraz obsługa i admin — wszystkie.
create policy "profiles: staff read" on public.profiles for select to authenticated
  using ((select public.is_staff()));
-- Zapis tylko kolumn danych (uprawnienia kolumnowe); role i qr_token — wyłącznie funkcjami powyżej.
create policy "profiles: own update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: admin update" on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, phone, permit_number, permit_authority, address, privacy_notice_ack_at)
  on public.profiles to authenticated;

-- audit_log: odczyt tylko admin; zapis wyłącznie funkcje security definer.
alter table public.audit_log enable row level security;
create policy "audit_log: admin read" on public.audit_log for select to authenticated
  using ((select public.is_admin()));
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
