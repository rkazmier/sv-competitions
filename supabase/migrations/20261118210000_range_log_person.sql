-- SPEC-005 US-3 (AC-7, AC-8): osoba we wpisie do książki — podsumowanie po identyfikatorze (karta użytkownika
-- „Rozpocznij wpis do książki”, powrót ze sprzedaży na miejscu) i uzupełnienie brakujących danych przez obsługę.
-- Obsługa nie ma `update` na `profiles` (RLS: własny wiersz lub admin), więc zapis przez funkcję `security definer`;
-- wpis `profile_update` w `audit_log` robi istniejący wyzwalacz `audit_profile_changes` (aktor = `auth.uid()`).

-- AC-8: to samo minimum danych co `staff_find_by_qr`; brak osoby → brak wierszy.
create function public.staff_person_by_id(p_id uuid)
returns table (id uuid, full_name text, is_range_ready boolean, missing_fields text[], last_entry_today timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.* from public.profiles p, public.staff_person_summary(p) s where p.id = p_id;
end;
$$;
revoke execute on function public.staff_person_by_id(uuid) from public, anon;
grant execute on function public.staff_person_by_id(uuid) to authenticated;

-- AC-7: tylko brakujące pola (imię i nazwisko; decyzja z organem lub adres, gdy nie ma żadnego z nich) — istniejących wartości obsługa nie nadpisuje (nie widzi ich i nie poprawia).
-- Numer decyzji zawsze z organem; walidacja długości — `check` w `profiles` (SPEC-002 AC-8, AC-11), puste → null
-- (`profiles_normalize`). Zwraca nowe podsumowanie osoby.
create function public.staff_complete_profile(
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
  if not public.is_staff() then
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
revoke execute on function public.staff_complete_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.staff_complete_profile(uuid, text, text, text, text) to authenticated;
