-- SPEC-012 US-7 (AC-35…AC-39): godziny otwarcia strzelnicy — tydzień (pn–nd) i wyjątki dzienne.
-- Odczyt publiczny (strona pobiera w przeglądarce, bez `site-rebuild`), zapis tylko admin. Jeden przedział na dzień;
-- oba czasy `null` = zamknięte. Godziny są informacją — nie wpływają na ważność uprawnień ani wpisy do książki (AC-39).

create table public.opening_hours (
  weekday smallint primary key check (weekday between 1 and 7),
  opens_at time,
  closes_at time,
  constraint opening_hours_both_or_none check ((opens_at is null) = (closes_at is null)),
  constraint opening_hours_closes_after_opens check (closes_at > opens_at)
);
comment on table public.opening_hours is 'SPEC-012 AC-35: godziny dnia tygodnia (ISO, 1 = pn); oba czasy null = zamknięte';

create table public.opening_hours_exceptions (
  day date primary key,
  opens_at time,
  closes_at time,
  note text check (char_length(note) between 1 and 100 and note = trim(note)),
  constraint opening_hours_exceptions_both_or_none check ((opens_at is null) = (closes_at is null)),
  constraint opening_hours_exceptions_closes_after_opens check (closes_at > opens_at)
);
comment on table public.opening_hours_exceptions is
  'SPEC-012 AC-36: wyjątek zastępuje godziny dnia tygodnia; opis publiczny; usuwane 30 dni po dniu wyjątku';

-- §5 RLS: `select` dla wszystkich, zapis — `is_admin()`.
alter table public.opening_hours enable row level security;
alter table public.opening_hours_exceptions enable row level security;
revoke all on public.opening_hours, public.opening_hours_exceptions from anon, authenticated;
grant select on public.opening_hours, public.opening_hours_exceptions to anon, authenticated;
grant insert, update, delete on public.opening_hours, public.opening_hours_exceptions to authenticated;

create policy opening_hours_select on public.opening_hours for select to anon, authenticated using (true);
create policy opening_hours_admin_write on public.opening_hours for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy opening_hours_exceptions_select on public.opening_hours_exceptions for select to anon, authenticated using (true);
create policy opening_hours_exceptions_admin_write on public.opening_hours_exceptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- AC-37: wpisy blokujące karnety w okresie [p_from, p_to] (te same warunki co `range_blocked_on`) — do listy
-- „Dni wydarzeń i zawodów” w `/oferta/#godziny`. Publiczna — tylko dane opublikowanych wpisów. Okres do 366 dni.
create function public.range_blocked_between(p_from date, p_to date)
returns table (kind text, id uuid, name text, starts_on date, ends_on date)
language sql stable security definer set search_path = ''
as $$
  select * from (
    select 'competition', c.id, c.name, c.starts_on, coalesce(c.ends_on, c.starts_on) from public.competitions c
      where c.status = 'published' and c.blocks_passes
    union all
    select 'event', e.id, e.name, e.starts_on, coalesce(e.ends_on, e.starts_on) from public.calendar_events e
      where e.status = 'published' and e.blocks_passes and e.cancelled_at is null
  ) b (kind, id, name, starts_on, ends_on)
  where p_to - p_from between 0 and 366 and b.starts_on <= p_to and b.ends_on >= p_from
  order by b.starts_on, b.name;
$$;
revoke execute on function public.range_blocked_between(date, date) from public;
grant execute on function public.range_blocked_between(date, date) to anon, authenticated, service_role;

-- AC-36: nocne usuwanie wyjątków starszych niż 30 dni (ADR-0006).
create function public.purge_opening_hours_exceptions()
returns integer
language sql volatile security definer set search_path = ''
as $$
  with deleted as (
    delete from public.opening_hours_exceptions where day < public.range_today() - 30 returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke execute on function public.purge_opening_hours_exceptions() from public, anon, authenticated;

-- 02:25 UTC = 03:25 / 04:25 w Warszawie — już po północy Europe/Warsaw.
select cron.schedule('purge-opening-hours-exceptions', '25 2 * * *', 'select public.purge_opening_hours_exceptions()');
