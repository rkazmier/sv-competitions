-- SPEC-012 US-8 (AC-40…AC-43, AC-45): karnety i wejścia jednorazowe nie obowiązują w dniach wydarzeń i zawodów.
-- Flaga `blocks_passes` (domyślnie `true`, także istniejące wpisy), publiczna lista blokad dnia `range_blocked_on(date)`,
-- `pass_valid_on` — wszystkie rodzaje poza `event_ticket` nieważne w dzień blokady (także karnety czasowe sprzedane
-- do 31.12.2026; `valid_until` bez zmian). Ważność liczona w chwili sprawdzenia (AC-45) — bez zapisanych dni blokady.
-- `create_on_site_order`: osoba bez konta nie kupi wejścia jednorazowego w dzień blokady (`range_blocked`).
-- Odwołanie wpisu (`cancelled_at`, SPEC-012 US-5) dopisze warunek w `range_blocked_on` w swoim zadaniu.

alter table public.competitions add column blocks_passes boolean not null default true;
alter table public.calendar_events add column blocks_passes boolean not null default true;
comment on column public.competitions.blocks_passes is
  'SPEC-012 AC-40: karnety i wejścia jednorazowe nie obowiązują w dniach zawodów';
comment on column public.calendar_events.blocks_passes is
  'SPEC-012 AC-40: karnety i wejścia jednorazowe nie obowiązują w dniach wydarzenia';
-- Kolumny publiczne (odczyt kolumnowy jak w 20261113140000_competitions_schema.sql).
grant select (blocks_passes) on public.competitions to anon, authenticated;
grant select (blocks_passes) on public.calendar_events to anon, authenticated;

-- AC-41: opublikowane wpisy z flagą, które obejmują dzień `p_date` (`starts_on ≤ D ≤ coalesce(ends_on, starts_on)`).
-- Publiczna — tylko dane opublikowanych wpisów (rodzaj, id, nazwa). Kilka wpisów tego samego dnia — wszystkie.
create function public.range_blocked_on(p_date date)
returns table (kind text, id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select 'competition', c.id, c.name from public.competitions c
    where c.status = 'published' and c.blocks_passes
      and p_date between c.starts_on and coalesce(c.ends_on, c.starts_on)
  union all
  select 'event', e.id, e.name from public.calendar_events e
    where e.status = 'published' and e.blocks_passes
      and p_date between e.starts_on and coalesce(e.ends_on, e.starts_on)
  order by 3, 2;
$$;
revoke execute on function public.range_blocked_on(date) from public;
grant execute on function public.range_blocked_on(date) to anon, authenticated, service_role;

-- Jak w 20261118150000_range_log.sql + AC-41 (zmiana SPEC-003 §5): poza wejściówką — dzień bez blokady.
-- Używana przez `passes_valid_on`, `passes_for_range_entry` i zapis wpisu do książki.
create or replace function public.pass_valid_on(p public.user_passes, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p.status = 'active'
    and (p.kind = 'event_ticket' or not exists (select 1 from public.range_blocked_on(p_date)))
    and case p.kind
      when 'days' then
        case when p.first_used_on is null then p_date <= p.expires_on
             else p_date between p.first_used_on and p.valid_until end
      when 'single_entry' then
        p_date <= p.expires_on and (extract(isodow from p_date) in (6, 7)) = (p.day_type = 'weekend')
      when 'event_ticket' then
        p_date <= p.expires_on and p_date between
          (select e.starts_on from public.calendar_events e where e.id = p.calendar_event_id) and p.valid_until
      else p_date <= p.expires_on
    end;
$$;

-- Jak w 20261118190000_on_site_sales.sql + AC-43: osoba bez konta nie kupi wejścia jednorazowego w dzień blokady
-- (`range_blocked`). Osobie z kontem karnet można sprzedać — ostrzeżenie pokazuje panel.
create or replace function public.create_on_site_order(
  p_user_id uuid,
  p_product_id uuid,
  p_on_site_method text,
  p_event_id uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  prod public.products;
  ev public.calendar_events;
  today date := public.range_today();
  taken integer;
  new_id uuid;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on_site_method is null or p_on_site_method not in ('cash', 'terminal') then
    raise exception 'invalid_on_site_method' using errcode = '22023';
  end if;
  if num_nonnulls(p_product_id, p_event_id) <> 1 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if p_product_id is not null then
    select * into prod from public.products where id = p_product_id;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if p_user_id is null and (prod.kind <> 'single_entry'
        or (extract(isodow from today) in (6, 7)) <> (prod.day_type = 'weekend')) then
      raise exception 'guest_product_not_allowed' using errcode = 'P0001';
    end if;
    if p_user_id is null and exists (select 1 from public.range_blocked_on(today)) then
      raise exception 'range_blocked' using errcode = 'P0001';
    end if;
    insert into public.orders (user_id, product_id, item_name, amount, payment_method, on_site_method, created_by)
      values (p_user_id, prod.id, prod.name, prod.price, 'on_site', p_on_site_method, auth.uid())
      returning id into new_id;
  else
    select * into ev from public.calendar_events
      where id = p_event_id and status = 'published' and access_mode = 'paid' for update;
    if not found then
      raise exception 'event_unavailable' using errcode = 'P0001';
    end if;
    if today > coalesce(ev.ends_on, ev.starts_on) then
      raise exception 'sales_closed' using errcode = 'P0001';
    end if;
    if p_user_id is null and today < ev.starts_on then
      raise exception 'guest_product_not_allowed' using errcode = 'P0001';
    end if;
    if ev.capacity is not null then
      select count(*) into taken from public.orders
        where calendar_event_id = ev.id
          and (status = 'paid' or (status = 'pending' and created_at > now() - public.ticket_reservation()));
      if taken >= ev.capacity then
        raise exception 'sold_out' using errcode = 'P0001';
      end if;
    end if;
    insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, on_site_method, created_by)
      values (p_user_id, ev.id, 'Wejściówka: ' || ev.name, ev.ticket_price, 'on_site', p_on_site_method, auth.uid())
      returning id into new_id;
  end if;
  perform public.fulfil_order(new_id);
  return new_id;
end;
$$;
