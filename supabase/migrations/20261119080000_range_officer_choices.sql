-- SPEC-007 US-5, §5 (#117): lista wyboru Prowadzącego przy wpisie (AC-18) i przy wyborze dyżurnego (AC-15).
-- Kolejność: (1) osoba wpisywana — jeśli ma zatwierdzone, aktywne uprawnienia, także ukryta dla innych
-- (`is_person = true`); (2) prowadzący „na liście” (`is_active and status = 'approved'`) bez „Ukryj mnie dla innych”,
-- po imieniu i nazwisku. Ukrytych (poza osobą wpisywaną) na liście nie ma — tylko wyszukiwarka (AC-19).
-- Tylko identyfikator i imię i nazwisko. Błąd: `forbidden`.

create function public.range_officer_choices(p_person_id uuid default null)
returns table (id uuid, full_name text, is_person boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
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

revoke execute on function public.range_officer_choices(uuid) from public, anon;
grant execute on function public.range_officer_choices(uuid) to authenticated;
