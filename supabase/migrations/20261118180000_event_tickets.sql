-- SPEC-003 US-4 (AC-16…AC-20): wejściówki na wydarzenia — warunek publikacji zależny od trybu,
-- liczba wolnych miejsc dla przeglądarki i blokada zmian wydarzenia ze sprzedanymi wejściówkami.

-- AC-16: link wymagany do publikacji tylko w trybie `external` (płatne i bezpłatne — opcjonalny).
-- Ta sama nazwa ograniczenia — UI mapuje ją na „Aby opublikować wydarzenie, podaj link do szczegółów.”.
alter table public.calendar_events
  drop constraint calendar_events_published_needs_url,
  add constraint calendar_events_published_needs_url
    check (status = 'draft' or access_mode <> 'external' or external_url is not null);

-- AC-17, AC-18: wolne miejsca = `capacity` − (`paid` + `pending` młodsze niż `ticket_reservation()`), nie mniej niż 0.
-- `null` — bez limitu albo wydarzenie nieopublikowane / niepłatne. Bez danych osobowych — dostępna dla `anon`.
create function public.event_seats_left(p_event_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select greatest(e.capacity - (
    select count(*)::integer from public.orders o
    where o.calendar_event_id = e.id
      and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - public.ticket_reservation()))
  ), 0)
  from public.calendar_events e
  where e.id = p_event_id and e.status = 'published' and e.access_mode = 'paid' and e.capacity is not null;
$$;
revoke execute on function public.event_seats_left(uuid) from public;
grant execute on function public.event_seats_left(uuid) to anon, authenticated;

-- AC-20: sprzedane (`paid`) wejściówki blokują zmianę trybu i ceny oraz usunięcie wydarzenia;
-- limit nie może spaść poniżej liczby sprzedanych. Nazwa, opis, daty, link — bez zmian w zasadach.
create function public.calendar_events_tickets_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  sold integer;
begin
  select count(*) into sold from public.orders where calendar_event_id = old.id and status = 'paid';
  if sold = 0 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE'
    or new.access_mode is distinct from old.access_mode
    or new.ticket_price is distinct from old.ticket_price then
    raise exception 'event_has_tickets' using errcode = 'P0001';
  end if;
  if new.capacity is not null and new.capacity < sold then
    raise exception 'capacity_below_sold' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_events_tickets_guard() from public, anon, authenticated;
create trigger calendar_events_tickets_guard before update or delete on public.calendar_events
  for each row execute function public.calendar_events_tickets_guard();
