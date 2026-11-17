-- SPEC-002 §3, ADR-0004: role user / staff / admin zamiast competitor / organizer (AC-28).
-- Hierarchia admin ⊃ staff ⊃ user. RLS czyta rolę z `profiles` funkcjami is_staff() / is_admin();
-- is_organizer() zostaje aliasem is_admin() dla istniejących polityk i `site-rebuild`.

-- ===== Migracja ról =====

alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role = case role when 'organizer' then 'admin' else 'user' end
  where role in ('competitor', 'organizer');
alter table public.profiles alter column role set default 'user';
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'staff', 'admin'));

-- ===== Funkcje ról =====

create function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('staff', 'admin'));
$$;
revoke execute on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Alias dla polityk SPEC-001 i Edge Function `site-rebuild`; nowy kod używa is_admin().
create or replace function public.is_organizer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin();
$$;

-- Custom Access Token Hook: claim `app_role` (user / staff / admin) tylko dla UI; RLS używa funkcji powyżej.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  user_role text;
begin
  select role into user_role from public.profiles where id = (event ->> 'user_id')::uuid;
  return jsonb_set(event, '{claims,app_role}', to_jsonb(coalesce(user_role, 'user')));
end;
$$;

comment on column public.profiles.role is 'user | staff | admin (ADR-0004); zmiana tylko przez właściciela SQL-em lub set_user_role (SPEC-002 #46)';
