-- SPEC-003 US-5 (AC-21…AC-23): sprzedaż na miejscu — także wejściówki na wydarzenia (#51 dodało cenę i limit),
-- osoba bez konta: wejściówka tylko na dzisiejsze wydarzenie; dzisiejsza lista sprzedaży z sumami dla obsługi.

-- Stara sygnatura (bez wejściówek) zastąpiona nową; `p_event_id` z wartością domyślną — dotychczasowe
-- wywołania `(user, product, method)` działają bez zmian.
drop function public.create_on_site_order(uuid, uuid, text);

-- Tylko obsługa. Zamówienie `on_site` opłacone od razu, `created_by` = sprzedający; zwraca id zamówienia.
-- Dokładnie jedno z `p_product_id`, `p_event_id`.
-- Wejściówka (jak `create_tpay_order`): wydarzenie opublikowane, płatne, sprzedaż do ostatniego dnia (Europe/Warsaw),
-- limit miejsc liczony z blokadą wiersza wydarzenia (`paid` + świeże `pending`).
-- Osoba bez konta (`p_user_id` null, AC-22): wejście jednorazowe pasujące do dzisiejszego dnia albo wejściówka
-- na wydarzenie trwające dziś.
-- Błędy: `forbidden`, `invalid_on_site_method`, `invalid_request`, `product_not_found`, `event_unavailable`,
-- `sales_closed`, `sold_out`, `guest_product_not_allowed`, `user_not_found`.
create function public.create_on_site_order(
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
revoke execute on function public.create_on_site_order(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_on_site_order(uuid, uuid, text, uuid) to authenticated;

-- AC-23: dzisiejsza (Europe/Warsaw) sprzedaż na miejscu, od najnowszej. Kto sprzedał — imię i nazwisko z profilu
-- obsługi (bez e-maila); bez danych kupującego. `status` — zamówienie mogło zostać zwrócone (AC-25).
create function public.staff_on_site_sales_today()
returns table (
  id uuid, created_at timestamptz, item_name text, amount integer, on_site_method text, status text, seller_name text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, o.created_at, o.item_name, o.amount, o.on_site_method, o.status, s.full_name
    from public.orders o
    left join public.profiles s on s.id = o.created_by
    where o.payment_method = 'on_site'
      and o.created_at >= (public.range_today()::timestamp at time zone 'Europe/Warsaw')
    order by o.created_at desc, o.id;
end;
$$;
revoke execute on function public.staff_on_site_sales_today() from public, anon;
grant execute on function public.staff_on_site_sales_today() to authenticated;
