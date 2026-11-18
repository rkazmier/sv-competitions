-- SPEC-003 US-6 (AC-24…AC-27): zamówienia w panelu admina, zwrot Tpay.
-- `cancel_order` i wpis `order_refund` w `audit_log` istnieją od #48; tu: lista z filtrami dla `/panel/zamowienia/`,
-- powiadomienie Tpay o zwrocie (`refund_pending` → `refunded`) i cofnięcie zlecenia, gdy Tpay odrzuci zwrot.

-- AC-24, AC-26: zamówienia z filtrami (wszystkie opcjonalne), od najnowszych. Tylko admin.
-- Daty — dni w Europe/Warsaw (włącznie). Osoba — fragment imienia i nazwiska lub e-maila (bez rozróżniania wielkości liter).
-- `pass_used` — uprawnienie ma zużycie (AC-26: bez „Anuluj i zwróć”). E-mail z `auth.users`, nie kopiowany (SPEC-002 §5).
create function public.admin_list_orders(
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_method text default null,
  p_product_id uuid default null,
  p_event_id uuid default null,
  p_person text default null
)
returns table (
  id uuid, created_at timestamptz, item_name text, amount integer, payment_method text, on_site_method text,
  status text, refund_note text, user_id uuid, person_name text, person_email text, seller_name text, pass_used boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  person text := lower(nullif(trim(p_person), ''));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, o.created_at, o.item_name, o.amount, o.payment_method, o.on_site_method, o.status, o.refund_note,
           o.user_id, pr.full_name, u.email::text, s.full_name,
           coalesce(public.pass_has_usage(p.id), false)
    from public.orders o
    left join public.profiles pr on pr.id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.profiles s on s.id = o.created_by
    left join public.user_passes p on p.order_id = o.id
    where (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Europe/Warsaw'))
      and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw'))
      and (p_status is null or o.status = p_status)
      and (p_method is null or o.payment_method = p_method)
      and (p_product_id is null or o.product_id = p_product_id)
      and (p_event_id is null or o.calendar_event_id = p_event_id)
      and (person is null or strpos(lower(coalesce(pr.full_name, '') || ' ' || coalesce(u.email, '')), person) > 0)
    order by o.created_at desc, o.id;
end;
$$;
revoke execute on function public.admin_list_orders(date, date, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.admin_list_orders(date, date, text, text, uuid, uuid, text) to authenticated;

-- AC-25: powiadomienie Tpay o zwrocie (`tr_status = CHARGEBACK`, `p_is_refund`). Poprzednia sygnatura zastąpiona;
-- wpłaty jak dotąd. Zwrot: `refund_pending` → `refunded`; `paid` (np. zwrot zlecony w panelu Tpay albo odpowiedź Tpay
-- nie dotarła i zlecenie cofnięto) → `refunded`, uprawnienie `cancelled`, wpis `order_refund` bez autora (AC-27).
-- Wyniki dodatkowo: `refunded`, `already_refunded`.
drop function public.process_tpay_notification(text, text, uuid, integer, integer, boolean);
create function public.process_tpay_notification(
  p_payload_hash text, p_transaction_title text, p_order_id uuid, p_amount integer, p_paid integer, p_is_payment boolean,
  p_is_refund boolean default false
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
  elsif p_is_refund then
    if p_amount is distinct from o.amount then
      outcome := 'amount_mismatch';
    elsif o.status = 'refunded' then
      outcome := 'already_refunded';
    elsif o.status in ('paid', 'refund_pending') then
      update public.user_passes set status = 'cancelled' where order_id = o.id;
      update public.orders set status = 'refunded', refunded_at = now() where id = o.id;
      if o.status = 'paid' then
        insert into public.audit_log (actor_id, target_user_id, action, changes)
          values (null, o.user_id, 'order_refund',
                  jsonb_build_object('order_id', o.id, 'amount', o.amount, 'status', jsonb_build_array('paid', 'refunded')));
      end if;
      outcome := 'refunded';
    else
      outcome := 'ignored_status';
    end if;
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
revoke execute on function public.process_tpay_notification(text, text, uuid, integer, integer, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.process_tpay_notification(text, text, uuid, integer, integer, boolean, boolean)
  to service_role;

-- AC-25: Tpay odrzucił zlecenie zwrotu → zamówienie wraca do `paid`, uprawnienie do `active` (nie było zużycia —
-- sprawdził `cancel_order`). Wpis `order_refund` ze stanem `refund_pending` → `paid` (AC-27). Wywołuje `payments-refund`.
-- Zwraca `true`, gdy cofnięto.
create function public.revert_order_refund(p_order_id uuid, p_actor_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  update public.orders set status = 'paid', refund_note = null
    where id = p_order_id and payment_method = 'tpay' and status = 'refund_pending'
    returning * into o;
  if not found then
    return false;
  end if;
  update public.user_passes set status = 'active' where order_id = o.id and status = 'cancelled';
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (p_actor_id, o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'amount', o.amount, 'status', jsonb_build_array('refund_pending', 'paid'),
                               'reason', 'tpay_refund_failed'));
  return true;
end;
$$;
revoke execute on function public.revert_order_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revert_order_refund(uuid, uuid) to service_role;
