-- SPEC-005 US-7 (AC-23): cofnięcie omyłkowego zużycia karnetu przez admina.
-- Wpis zostaje; zużycie dostaje `reverted_at`/`reverted_by`, do wpisu dochodzi adnotacja, do `audit_log` — `pass_usage_revert`.

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert'));

-- Skutek cofnięcia wg `effect`: licznik +1 (`decremented`), wejście jednorazowe znów aktywne (`consumed`),
-- karnet czasowy bez żadnego innego niewycofanego zużycia → zdjęcie aktywacji (`first_used_on`, `valid_until` = null).
-- Uprawnienie anulowane (zwrot) zostaje anulowane. Blokada wiersza uprawnienia jak w `create_range_log_entry`.
-- Błędy: `forbidden`, `usage_not_found`, `usage_already_reverted`.
create function public.revert_pass_usage(p_usage_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  usage public.pass_usages;
  pass public.user_passes;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into usage from public.pass_usages u where u.id = p_usage_id;
  if not found then
    raise exception 'usage_not_found' using errcode = 'P0002';
  end if;
  select * into pass from public.user_passes p where p.id = usage.user_pass_id for update;
  -- Ponowna kontrola po blokadzie: dwa równoległe cofnięcia tego samego zużycia → drugie dostaje błąd.
  select * into usage from public.pass_usages u where u.id = p_usage_id for update;
  if usage.reverted_at is not null then
    raise exception 'usage_already_reverted' using errcode = 'P0001';
  end if;

  update public.pass_usages u set reverted_at = now(), reverted_by = auth.uid() where u.id = usage.id;

  if usage.effect = 'decremented' then
    update public.user_passes p set
        entries_left = least(p.entries_left + 1, p.entries_total),
        status = case when p.status = 'used_up' then 'active' else p.status end
      where p.id = pass.id;
  elsif usage.effect = 'consumed' then
    update public.user_passes p set status = case when p.status = 'used_up' then 'active' else p.status end
      where p.id = pass.id;
  elsif pass.kind = 'days' and not exists (
      select 1 from public.pass_usages u where u.user_pass_id = pass.id and u.reverted_at is null) then
    update public.user_passes p set first_used_on = null where p.id = pass.id;
  end if;

  -- Po retencji wpisu (`range_log_entry_id = null`) nie ma do czego dopisać adnotacji.
  if usage.range_log_entry_id is not null then
    insert into public.range_log_annotations (entry_id, body, created_by)
      values (usage.range_log_entry_id, 'Cofnięto zużycie karnetu', auth.uid());
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), pass.user_id, 'pass_usage_revert',
            jsonb_build_object('pass_usage_id', usage.id, 'user_pass_id', pass.id, 'used_on', usage.used_on,
                               'effect', usage.effect, 'range_log_entry_id', usage.range_log_entry_id));
end;
$$;
revoke execute on function public.revert_pass_usage(uuid) from public, anon;
grant execute on function public.revert_pass_usage(uuid) to authenticated;
