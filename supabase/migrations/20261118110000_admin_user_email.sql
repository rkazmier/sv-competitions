-- SPEC-002 AC-20, §6: karta użytkownika w panelu (`/panel/uzytkownicy/profil/?id=`) pokazuje e-mail konta (tylko do odczytu).
-- E-mail nie jest kopiowany do `profiles` (§5) — funkcja czyta go z `auth.users`, tylko dla admina (jak admin_list_users).
create function public.admin_user_email(user_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select u.email::text from auth.users u where u.id = admin_user_email.user_id);
end;
$$;
revoke execute on function public.admin_user_email(uuid) from public, anon;
grant execute on function public.admin_user_email(uuid) to authenticated;
