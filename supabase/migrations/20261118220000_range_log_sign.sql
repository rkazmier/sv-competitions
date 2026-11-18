-- SPEC-005 US-5 (AC-13): ekran podpisu pokazuje dane wpisu — także numer decyzji i organ albo adres osoby z kontem.
-- `staff_person_summary` zwraca tylko braki, więc obsługa (bez `select` cudzych profili) dostaje te pola funkcją
-- — dokładnie to, co `create_range_log_entry` skopiuje do wpisu (§3: „dane obsługiwanej osoby”).
create function public.staff_person_entry_data(p_id uuid)
returns table (full_name text, permit_number text, permit_authority text, address text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select p.full_name, p.permit_number, p.permit_authority, p.address
    from public.profiles p where p.id = p_id;
end;
$$;
revoke execute on function public.staff_person_entry_data(uuid) from public, anon;
grant execute on function public.staff_person_entry_data(uuid) to authenticated;
