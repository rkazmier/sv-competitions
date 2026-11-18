-- SPEC-005 US-9 (AC-26…AC-29): przegląd książki przez admina i eksport PDF / CSV.
-- Jedna funkcja zwraca wpisy wg filtrów i — w tej samej transakcji — zapisuje `range_log_export` w `audit_log`
-- (każde wyświetlenie podpisów i każdy eksport, AC-29). Podpisy: podpisane linki 60 s z bucketu `signatures` (klient).

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export'));

-- Filtry (puste = bez filtra): dzień od–do w Europe/Warsaw, fragment imienia i nazwiska, prowadzący.
-- `p_format`: `view` (przegląd z miniaturami podpisów), `pdf`, `csv`. Wynik: tylko kolumny książki (§5) + adnotacje
-- (autor, czas, treść), od najstarszego wpisu. Bez `profile_id`, `is_companion`, `created_by`.
-- Błędy: `forbidden`, `invalid_format`.
create function public.admin_range_log(
  p_format text,
  p_from date default null,
  p_to date default null,
  p_person text default null,
  p_officer_id uuid default null
)
returns table (
  id uuid, entered_at timestamptz, full_name text, permit_number text, permit_authority text, address text,
  range_officer_name text, signature_path text, annotations jsonb
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  pattern text := '%' || replace(replace(replace(trim(coalesce(p_person, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  total integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_format is null or p_format not in ('view', 'pdf', 'csv') then
    raise exception 'invalid_format' using errcode = '22023';
  end if;

  return query
    select r.id, r.entered_at, r.full_name, r.permit_number, r.permit_authority, r.address, r.range_officer_name,
           r.signature_path,
           coalesce((select jsonb_agg(jsonb_build_object('body', a.body, 'created_at', a.created_at,
                                                         'author', p.full_name) order by a.created_at)
                     from public.range_log_annotations a
                     left join public.profiles p on p.id = a.created_by
                     where a.entry_id = r.id), '[]'::jsonb)
    from public.range_log r
    where (p_from is null or r.entered_at >= (p_from::timestamp at time zone 'Europe/Warsaw'))
      and (p_to is null or r.entered_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw'))
      and r.full_name ilike pattern
      and (p_officer_id is null or r.range_officer_id = p_officer_id)
    order by r.entered_at, r.id;
  get diagnostics total = row_count;

  -- AC-29: zakres i format, bez danych osób (filtr nazwiska nie trafia do dziennika).
  insert into public.audit_log (actor_id, action, changes)
    values (auth.uid(), 'range_log_export',
            jsonb_build_object('format', p_format, 'from', p_from, 'to', p_to, 'entries', total));
end;
$$;
revoke execute on function public.admin_range_log(text, date, date, text, uuid) from public, anon;
grant execute on function public.admin_range_log(text, date, date, text, uuid) to authenticated;
