-- SPEC-002 US-6 (AC-24, AC-25, §5): wpis `account_delete` przed usunięciem konta przez Edge Function `admin-delete-user`.
-- Wywoływana z JWT admina (auth.uid() = autor wpisu). Odmawia usunięcia własnego konta i nieistniejącego konta.
-- Samo usunięcie robi funkcja (`auth.admin.deleteUser`); kaskady i `set null` są w kluczach obcych:
-- profiles → cascade; user_passes → cascade (niewykorzystane karnety przepadają); orders.user_id, created_by,
-- audit_log.actor_id → set null. audit_log.target_user_id nie ma FK, więc wpis zostaje.
create function public.admin_log_account_delete(user_id uuid)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  entry_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if admin_log_account_delete.user_id = auth.uid() then
    raise exception 'own_account' using errcode = 'P0001', hint = 'Nie możesz usunąć własnego konta.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = admin_log_account_delete.user_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Bez danych osobowych: tylko identyfikator konta (changes = null).
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), admin_log_account_delete.user_id, 'account_delete', null)
    returning id into entry_id;
  return entry_id;
end;
$$;
revoke execute on function public.admin_log_account_delete(uuid) from public, anon;
grant execute on function public.admin_log_account_delete(uuid) to authenticated;
