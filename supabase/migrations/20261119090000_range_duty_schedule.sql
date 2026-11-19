-- SPEC-007 US-6, §5 (#119): grafik dyżurów — dyżurni Prowadzący na kolejne dni (`range_duty`, `source = 'schedule'`,
-- od dziś do 90 dni naprzód). Zapis i usuwanie wpisu grafiku oraz odczyt grafiku z dyżurnym wynikającym z kolejności
-- źródeł (`range_duty_for`: książka → (#120: zawody / wydarzenie) → grafik) — dla Obsługi i admina.

-- Grafik sięga od dziś (Europe/Warsaw, zegar bazy) do dziś + 90 dni (AC-23). Wewnętrzna.
create function public.range_schedule_day_valid(p_day date)
returns boolean
language sql stable set search_path = ''
as $$
  select p_day is not null and p_day between public.range_today() and public.range_today() + 90;
$$;
revoke execute on function public.range_schedule_day_valid(date) from public, anon, authenticated;

-- „Ustaw” / „Zmień” w grafiku: jeden wpis na dzień (upsert, ostatni zapis wygrywa — §7). Ukrytego dla innych można
-- wybrać (wyszukiwarka). Wpis grafiku i zmiana w książce to osobne wiersze (AC-25).
-- Błędy: `forbidden`, `invalid_day`, `range_officer_inactive`.
create function public.set_scheduled_range_duty(p_day date, p_range_officer_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.range_schedule_day_valid(p_day) then
    raise exception 'invalid_day' using errcode = 'P0001';
  end if;
  perform 1 from public.range_officers r
    where r.id = p_range_officer_id and r.is_active and r.status = 'approved'
    for share;
  if not found then
    raise exception 'range_officer_inactive' using errcode = 'P0001';
  end if;
  insert into public.range_duty (day, source, range_officer_id, set_by, set_at)
    values (p_day, 'schedule', p_range_officer_id, auth.uid(), now())
    on conflict on constraint range_duty_pkey do update
      set range_officer_id = excluded.range_officer_id, set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

-- „Usuń z grafiku” (AC-22): usuwa tylko wpis grafiku; zmiana w książce na dziś zostaje (AC-25).
-- Brak wpisu — bez błędu. Błędy: `forbidden`, `invalid_day`.
create function public.clear_scheduled_range_duty(p_day date)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.range_schedule_day_valid(p_day) then
    raise exception 'invalid_day' using errcode = 'P0001';
  end if;
  delete from public.range_duty d where d.day = p_day and d.source = 'schedule';
end;
$$;

-- Grafik na `p_days` dni od dziś (1…91; poza zakresem — przycięte): dla każdego dnia dyżurny wynikający z kolejności
-- źródeł (jak `current_range_duty`: `range_officer_id`, `full_name`, `source` = `book` | `event` | `schedule`,
-- `event_name`; `null`, gdy brak) oraz osobno wpis grafiku na ten dzień (`schedule_*`; także gdy prowadzący nie jest
-- już „na liście” — wtedy `schedule_on_list = false`, a wpis można zmienić lub usunąć). AC-22, AC-24, AC-25.
-- Błąd: `forbidden`.
create function public.range_duty_schedule(p_days integer default 30)
returns table (
  day date,
  range_officer_id uuid,
  full_name text,
  source text,
  event_name text,
  schedule_range_officer_id uuid,
  schedule_full_name text,
  schedule_on_list boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  today date := public.range_today();
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select g.day::date, f.range_officer_id, f.full_name, f.source, f.event_name,
           s.range_officer_id, r.full_name, (r.is_active and r.status = 'approved')
      from generate_series(today, today + least(greatest(coalesce(p_days, 30), 1), 91) - 1, interval '1 day') as g (day)
      left join lateral public.range_duty_for(g.day::date) f on true
      left join public.range_duty s on s.day = g.day::date and s.source = 'schedule'
      left join public.range_officers r on r.id = s.range_officer_id
     order by g.day;
end;
$$;

revoke execute on function public.set_scheduled_range_duty(date, uuid), public.clear_scheduled_range_duty(date),
  public.range_duty_schedule(integer) from public, anon;
grant execute on function public.set_scheduled_range_duty(date, uuid), public.clear_scheduled_range_duty(date),
  public.range_duty_schedule(integer) to authenticated;
