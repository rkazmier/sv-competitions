-- SPEC-007 US-7, §5 (#120): dyżurny Prowadzący zawodów i wydarzeń. Kolumna `duty_range_officer_id` w `competitions`
-- i `calendar_events` (niepubliczna), wyzwalacz „na liście” i nakładania terminów, odczyt dla formularzy admina
-- (`admin_calendar_duty`) oraz krok zawodów / wydarzeń w `range_duty_for` (książka → zawody / wydarzenie → grafik).

-- ===== Kolumny =====

alter table public.competitions
  add column duty_range_officer_id uuid references public.range_officers (id) on delete set null;
alter table public.calendar_events
  add column duty_range_officer_id uuid references public.range_officers (id) on delete set null;
create index competitions_duty_range_officer_idx on public.competitions (duty_range_officer_id)
  where duty_range_officer_id is not null;
create index calendar_events_duty_range_officer_idx on public.calendar_events (duty_range_officer_id)
  where duty_range_officer_id is not null;

comment on column public.competitions.duty_range_officer_id is
  'Dyżurny Prowadzący na wszystkie dni zawodów (SPEC-007 US-7); niepubliczny — odczyt przez admin_calendar_duty';
comment on column public.calendar_events.duty_range_officer_id is
  'Dyżurny Prowadzący na wszystkie dni wydarzenia (SPEC-007 US-7); niepubliczny — odczyt przez admin_calendar_duty';

-- AC-30: bez `select` dla `anon` / `authenticated` (jak `created_by`) — tabele mają uprawnienia `select` na kolumnach
-- (20261113140000_competitions_schema.sql), nowa kolumna nie dostaje grantu. Zapis: admin, istniejące polityki.

-- ===== Wyzwalacz (AC-28, AC-29) =====

-- „Na liście” przy zmianie prowadzącego (`range_officer_inactive`); nakładanie terminów z innym dyżurnym w zawodach
-- i wydarzeniach (`range_duty_conflict`, `detail` = JSON z pierwszym wspólnym dniem i nazwą) — przy nowym wierszu,
-- zmianie prowadzącego albo dat. Blokada transakcyjna szereguje równoległe zapisy (dwa formularze naraz).
-- `security definer`: sprawdza wiersze, których wywołujący może nie widzieć (`range_officers`).
create function public.check_calendar_duty()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conflict record;
  officer_changed boolean;
begin
  if new.duty_range_officer_id is null then
    return new;
  end if;
  officer_changed := tg_op = 'INSERT' or new.duty_range_officer_id is distinct from old.duty_range_officer_id;
  if officer_changed then
    perform 1 from public.range_officers r
      where r.id = new.duty_range_officer_id and r.is_active and r.status = 'approved'
      for share;
    if not found then
      raise exception 'range_officer_inactive' using errcode = 'P0001';
    end if;
  end if;
  if not officer_changed
     and new.starts_on = old.starts_on and new.ends_on is not distinct from old.ends_on then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.calendar_range_duty'));
  select greatest(o.starts_on, new.starts_on) as day, o.name into conflict
    from (
      select c.id, 'competition' as kind, c.name, c.starts_on, coalesce(c.ends_on, c.starts_on) as ends_on,
             c.duty_range_officer_id
        from public.competitions c
       where c.duty_range_officer_id is not null
      union all
      select e.id, 'event', e.name, e.starts_on, coalesce(e.ends_on, e.starts_on), e.duty_range_officer_id
        from public.calendar_events e
       where e.duty_range_officer_id is not null
    ) o
   where not (o.id = new.id and o.kind = case tg_table_name when 'competitions' then 'competition' else 'event' end)
     and o.duty_range_officer_id <> new.duty_range_officer_id
     and o.starts_on <= coalesce(new.ends_on, new.starts_on)
     and o.ends_on >= new.starts_on
   order by 1, o.name
   limit 1;
  if found then
    raise exception 'range_duty_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('day', conflict.day, 'name', conflict.name)::text;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_calendar_duty() from public, anon, authenticated;

create trigger competitions_range_duty before insert or update of duty_range_officer_id, starts_on, ends_on
  on public.competitions for each row execute function public.check_calendar_duty();
create trigger calendar_events_range_duty before insert or update of duty_range_officer_id, starts_on, ends_on
  on public.calendar_events for each row execute function public.check_calendar_duty();

-- ===== Odczyt dla formularzy admina (AC-26, AC-28) =====

-- Dyżurny zawodów (`p_kind = 'competition'`) albo wydarzenia (`'event'`): identyfikator, imię i nazwisko i czy jest
-- „na liście”; brak wiersza — nie wskazano (albo brak zawodów / wydarzenia). Błędy: `forbidden`, `invalid_kind`.
create function public.admin_calendar_duty(p_kind text, p_id uuid)
returns table (range_officer_id uuid, full_name text, on_list boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('competition', 'event') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  return query
    select r.id, r.full_name, (r.is_active and r.status = 'approved')
      from public.range_officers r
     where r.id = case p_kind
       when 'competition' then (select c.duty_range_officer_id from public.competitions c where c.id = p_id)
       else (select e.duty_range_officer_id from public.calendar_events e where e.id = p_id)
     end;
end;
$$;
revoke execute on function public.admin_calendar_duty(text, uuid) from public, anon;
grant execute on function public.admin_calendar_duty(text, uuid) to authenticated;

-- ===== Dyżurny dnia: krok zawodów / wydarzeń (US-4, AC-27) =====

-- Kolejność: `book` → zawody / wydarzenie trwające w `p_day` (także szkice) → `schedule`; w każdym kroku tylko
-- prowadzący „na liście”. Różnych dyżurnych w jednym dniu blokuje wyzwalacz; przy tym samym — pierwsze zawody.
create or replace function public.range_duty_for(p_day date)
returns table (range_officer_id uuid, full_name text, source text, event_name text)
language sql stable set search_path = ''
as $$
  select o.id, o.full_name, s.source, s.event_name
    from (
      select d.range_officer_id as id, d.source, null::text as event_name,
             case d.source when 'book' then 1 else 3 end as rank, null::text as tiebreak
        from public.range_duty d
       where d.day = p_day
      union all
      select c.duty_range_officer_id, 'event', c.name, 2, '1' || c.starts_on || c.name
        from public.competitions c
       where p_day between c.starts_on and coalesce(c.ends_on, c.starts_on)
      union all
      select e.duty_range_officer_id, 'event', e.name, 2, '2' || e.starts_on || e.name
        from public.calendar_events e
       where p_day between e.starts_on and coalesce(e.ends_on, e.starts_on)
    ) s
    join public.range_officers o on o.id = s.id
   where o.is_active and o.status = 'approved'
   order by s.rank, s.tiebreak
   limit 1;
$$;
revoke execute on function public.range_duty_for(date) from public, anon, authenticated;
