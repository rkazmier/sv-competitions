-- SPEC-003 §5, §7, §8 (AC-8, AC-9, AC-18): płatności Tpay — funkcje dla Edge Functions `payments-create`
-- i `payments-notify` (ADR-0002). Wywołuje je wyłącznie `service_role` (klucz secret).
-- Model wejściówek z §5 (`access_mode`, `ticket_price`, `capacity`) — potrzebny do limitu miejsc (AC-18);
-- formularz, warunek publikacji i karta w kalendarzu — zadanie #51.

alter table public.calendar_events
  add column access_mode text not null default 'external' check (access_mode in ('external', 'free', 'paid')),
  add column ticket_price integer check (ticket_price between 1 and 1000000),
  add column capacity integer check (capacity between 1 and 1000),
  add constraint calendar_events_paid_needs_price check (access_mode <> 'paid' or ticket_price is not null);
grant select (access_mode, ticket_price, capacity) on public.calendar_events to anon, authenticated;

-- §7: podwójne kliknięcie „Zapłać” → jedno zamówienie (klucz idempotencji żądania od przeglądarki).
alter table public.orders add column request_key uuid;
create unique index orders_request_key_idx on public.orders (user_id, request_key);

-- Rezerwacja miejsca: `pending` młodsze niż 30 min (założenie analityka, AC-18).
create function public.ticket_reservation()
returns interval
language sql immutable set search_path = ''
as $$
  select interval '30 minutes';
$$;

-- AC-8, AC-18: zamówienie `pending` z ceną z bazy. Zwraca `{ order_id, amount, item_name, duplicate }`;
-- ten sam `request_key` tego samego konta → istniejące zamówienie z `duplicate = true`.
-- Wejściówka: blokada wiersza wydarzenia (`for update`), potem liczba `paid` + świeżych `pending` wobec `capacity`.
-- Błędy: `product_unavailable` (nie istnieje albo ukryty), `event_unavailable`, `sales_closed`, `sold_out`.
create function public.create_tpay_order(p_user_id uuid, p_product_id uuid, p_event_id uuid, p_request_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  prod public.products;
  ev public.calendar_events;
  taken integer;
begin
  if p_user_id is null or p_request_key is null or num_nonnulls(p_product_id, p_event_id) <> 1 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into o from public.orders where user_id = p_user_id and request_key = p_request_key;
  if found then
    return jsonb_build_object('order_id', o.id, 'amount', o.amount, 'item_name', o.item_name, 'duplicate', true);
  end if;
  if p_product_id is not null then
    select * into prod from public.products where id = p_product_id and is_active;
    if not found then
      raise exception 'product_unavailable' using errcode = 'P0001';
    end if;
    insert into public.orders (user_id, product_id, item_name, amount, payment_method, request_key)
      values (p_user_id, prod.id, prod.name, prod.price, 'tpay', p_request_key)
      returning * into o;
  else
    select * into ev from public.calendar_events
      where id = p_event_id and status = 'published' and access_mode = 'paid' for update;
    if not found then
      raise exception 'event_unavailable' using errcode = 'P0001';
    end if;
    if (now() at time zone 'Europe/Warsaw')::date > coalesce(ev.ends_on, ev.starts_on) then
      raise exception 'sales_closed' using errcode = 'P0001';
    end if;
    if ev.capacity is not null then
      select count(*) into taken from public.orders
        where calendar_event_id = ev.id
          and (status = 'paid' or (status = 'pending' and created_at > now() - public.ticket_reservation()));
      if taken >= ev.capacity then
        raise exception 'sold_out' using errcode = 'P0001';
      end if;
    end if;
    insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, request_key)
      values (p_user_id, ev.id, 'Wejściówka: ' || ev.name, ev.ticket_price, 'tpay', p_request_key)
      returning * into o;
  end if;
  return jsonb_build_object('order_id', o.id, 'amount', o.amount, 'item_name', o.item_name, 'duplicate', false);
end;
$$;
revoke execute on function public.create_tpay_order(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_tpay_order(uuid, uuid, uuid, uuid) to service_role;

-- AC-9, ADR-0002: powiadomienie Tpay po weryfikacji JWS w Edge Function. W jednej transakcji:
-- idempotencja (`payload_hash`), zgodność tytułu transakcji i kwoty (grosze, waluta zamówienia zawsze PLN),
-- realizacja `fulfil_order` i wpis do `payment_notifications`. Zwraca wynik:
-- `paid`, `already_paid`, `ignored_status` (inny stan niż wpłata), `order_not_found`, `transaction_mismatch`,
-- `amount_mismatch`; powtórzone powiadomienie → `duplicate:<pierwszy wynik>` bez zmian.
create function public.process_tpay_notification(
  p_payload_hash text, p_transaction_title text, p_order_id uuid, p_amount integer, p_paid integer, p_is_payment boolean
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  previous text;
  outcome text;
begin
  perform pg_advisory_xact_lock(hashtext(p_payload_hash));
  select result into previous from public.payment_notifications where payload_hash = p_payload_hash;
  if found then
    return 'duplicate:' || previous;
  end if;
  select * into o from public.orders where id = p_order_id and payment_method = 'tpay' for update;
  if not found then
    outcome := 'order_not_found';
  elsif o.tpay_title is distinct from p_transaction_title then
    outcome := 'transaction_mismatch';
  elsif not p_is_payment then
    outcome := 'ignored_status';
  elsif p_amount is distinct from o.amount or p_paid is distinct from o.amount then
    outcome := 'amount_mismatch';
  elsif o.status in ('pending', 'cancelled') then
    perform public.fulfil_order(o.id);
    outcome := 'paid';
  else
    outcome := 'already_paid';
  end if;
  insert into public.payment_notifications (tpay_transaction_id, payload_hash, result)
    values (p_transaction_title, p_payload_hash, outcome);
  return outcome;
end;
$$;
revoke execute on function public.process_tpay_notification(text, text, uuid, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.process_tpay_notification(text, text, uuid, integer, integer, boolean) to service_role;

-- AC-8: transakcja Tpay utworzona → identyfikator i tytuł w zamówieniu (`tpay_title` porównuje `payments-notify`).
create function public.attach_tpay_transaction(p_order_id uuid, p_transaction_id text, p_title text)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.orders set tpay_transaction_id = p_transaction_id, tpay_title = p_title
    where id = p_order_id and status = 'pending' and tpay_transaction_id is null;
$$;
revoke execute on function public.attach_tpay_transaction(uuid, text, text) from public, anon, authenticated;
grant execute on function public.attach_tpay_transaction(uuid, text, text) to service_role;

-- §7: Tpay niedostępny → zamówienie nie powstaje (usunięcie `pending` bez transakcji, zwalnia też miejsce).
create function public.discard_tpay_order(p_order_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from public.orders
    where id = p_order_id and payment_method = 'tpay' and status = 'pending' and tpay_transaction_id is null;
$$;
revoke execute on function public.discard_tpay_order(uuid) from public, anon, authenticated;
grant execute on function public.discard_tpay_order(uuid) to service_role;
