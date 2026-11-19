-- SPEC-007 US-4, §5 (#116): dyżurny Prowadzący w bazie (jeden na dzień dla całej strzelnicy) zamiast wyboru
-- zapamiętanego na urządzeniu. Tabela `range_duty` (źródła `book` i `schedule`), `set_range_duty`, `range_duty_for`
-- / `current_range_duty` (kolejność: książka → grafik; krok zawodów / wydarzeń dodaje #120), wyszukiwarka
-- prowadzących (AC-19) i nocne czyszczenie dni minionych (ADR-0006).

-- ===== Tabela =====

create table public.range_duty (
  day date not null,
  source text not null check (source in ('book', 'schedule')),
  range_officer_id uuid not null references public.range_officers (id) on delete cascade,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (day, source)
);
create index range_duty_officer_idx on public.range_duty (range_officer_id);

comment on table public.range_duty is
  'Dyżurny Prowadzący (SPEC-007 §5): book — wybór / „Zmień” w /panel/ksiazka/ (dziś), schedule — grafik dyżurów';

-- Odczyt: Obsługa i admin. Zapis wyłącznie przez funkcje `security definer` niżej.
alter table public.range_duty enable row level security;
create policy "range_duty: staff read" on public.range_duty for select to authenticated
  using ((select public.is_staff()));
revoke all on public.range_duty from anon, authenticated;
grant select on public.range_duty to authenticated;

-- ===== Dyżurny dnia (AC-15…AC-17) =====

-- Pierwsze źródło, które wskazuje prowadzącego „na liście” (`is_active and status = 'approved'`): `book` → (#120:
-- zawody / wydarzenie) → `schedule`; inaczej brak wiersza. Wewnętrzna — wywołują ją funkcje dla Obsługi.
create function public.range_duty_for(p_day date)
returns table (range_officer_id uuid, full_name text, source text, event_name text)
language sql stable set search_path = ''
as $$
  select r.id, r.full_name, d.source, null::text
    from public.range_duty d
    join public.range_officers r on r.id = d.range_officer_id
   where d.day = p_day and r.is_active and r.status = 'approved'
   order by case d.source when 'book' then 1 else 3 end
   limit 1;
$$;
revoke execute on function public.range_duty_for(date) from public, anon, authenticated;

-- Dzisiejszy dyżurny (Europe/Warsaw, zegar bazy): `source` = `book` | `event` | `schedule`, `event_name` — nazwa
-- zawodów lub wydarzenia (#120). Brak wiersza = brak dyżurnego (AC-15). Błąd: `forbidden`.
create function public.current_range_duty()
returns table (range_officer_id uuid, full_name text, source text, event_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.range_duty_for(public.range_today());
end;
$$;

-- Wybór / „Zmień” w książce: dyżurny na dziś dla całej strzelnicy, pierwszeństwo przed grafikiem (AC-15, AC-16).
-- Ostatni zapis wygrywa (§7). Ukrytego dla innych można wybrać (wyszukiwarka). Zwraca aktualnego dyżurnego.
-- Błędy: `forbidden`, `range_officer_inactive`.
create function public.set_range_duty(p_range_officer_id uuid)
returns table (range_officer_id uuid, full_name text, source text, event_name text)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.range_officers r
    where r.id = p_range_officer_id and r.is_active and r.status = 'approved'
    for share;
  if not found then
    raise exception 'range_officer_inactive' using errcode = 'P0001';
  end if;
  insert into public.range_duty (day, source, range_officer_id, set_by, set_at)
    values (public.range_today(), 'book', p_range_officer_id, auth.uid(), now())
    -- Nazwa ograniczenia zamiast kolumn: `source` to też nazwa kolumny wyniku funkcji (niejednoznaczność w plpgsql).
    on conflict on constraint range_duty_pkey do update
      set range_officer_id = excluded.range_officer_id, set_by = excluded.set_by, set_at = excluded.set_at;
  return query select * from public.range_duty_for(public.range_today());
end;
$$;

-- ===== Wyszukiwarka prowadzących (AC-19) =====

-- Od 3 znaków, maks. 10, zatwierdzeni i aktywni — także ukryci dla innych; tylko identyfikator i imię i nazwisko.
-- Znaki wzorca (`%`, `_`, `\`) traktowane dosłownie. Błąd: `forbidden`.
create function public.staff_search_range_officers(p_query text)
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 3 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select r.id, r.full_name from public.range_officers r
     where r.is_active and r.status = 'approved' and r.full_name ilike pattern
     order by r.full_name, r.id
     limit 10;
end;
$$;

revoke execute on function public.current_range_duty(), public.set_range_duty(uuid),
  public.staff_search_range_officers(text) from public, anon;
grant execute on function public.current_range_duty(), public.set_range_duty(uuid),
  public.staff_search_range_officers(text) to authenticated;

-- ===== Nocne czyszczenie (ADR-0006, SPEC-007 §9) =====

-- Usuwa dyżury sprzed dzisiaj (wpisy książki mają kopię nazwiska); dziś i grafik na kolejne dni zostają.
create function public.purge_range_duty()
returns integer
language sql volatile security definer set search_path = ''
as $$
  with deleted as (
    delete from public.range_duty where day < public.range_today() returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke execute on function public.purge_range_duty() from public, anon, authenticated;

-- 02:20 UTC = 03:20 / 04:20 w Warszawie — już po północy Europe/Warsaw.
select cron.schedule('purge-range-duty', '20 2 * * *', 'select public.purge_range_duty()');
