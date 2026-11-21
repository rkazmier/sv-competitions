-- SPEC-010 §5 (AC-7, AC-9…AC-11, AC-17, AC-19…AC-21): przyznanie karnetu (prezent) przez admina.
-- Zamówienie `gift` z kwotą 0, od razu opłacone; powód i notatka anulowania w `order_grants` (tylko admin);
-- `grant_pass`, `cancel_pass_grant`; `cancel_order` i `set_order_invoice_details` odrzucają prezent;
-- `admin_list_orders` zwraca powód i notatkę anulowania.

-- ===== orders: metoda `gift` =====

alter table public.orders
  drop constraint orders_payment_method_check,
  add constraint orders_payment_method_check check (payment_method in ('tpay', 'on_site', 'gift')),
  drop constraint orders_amount_check,
  add constraint orders_amount_check check (amount between 0 and 1000000),
  -- Kwota 0 tylko dla prezentu, prezent zawsze 0.
  add constraint orders_gift_amount check ((payment_method = 'gift') = (amount = 0)),
  -- AC-17: prezent bez faktury (nigdy na liście „Do wystawienia”).
  add constraint orders_gift_no_invoice check (payment_method <> 'gift' or not invoice_requested);

-- ===== order_grants =====

create table public.order_grants (
  order_id uuid primary key references public.orders (id) on delete restrict,
  reason text not null check (length(trim(reason)) between 3 and 300),
  cancel_note text check (length(cancel_note) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.order_grants is
  'Przyznanie karnetu (SPEC-010 §5): powód i notatka anulowania zamówienia `gift`; tylko admin (klient czyta cały wiersz `orders`)';

alter table public.order_grants enable row level security;
create policy "order_grants: admin read" on public.order_grants for select to authenticated
  using ((select public.is_admin()));
-- Zapis wyłącznie funkcjami `grant_pass`, `cancel_pass_grant`.
revoke all on public.order_grants from anon, authenticated;
grant select on public.order_grants to authenticated;

-- ===== audit_log =====

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked', 'range_officer_review',
                    'pass_grant', 'pass_grant_cancel'));

-- ===== grant_pass (AC-7, AC-9…AC-11) =====

-- Tylko admin. Dokładnie jedno z `p_product_id` (dowolny produkt, także ukryty) i `p_event_id` (jak w `create_on_site_order`:
-- opublikowane, płatne, do ostatniego dnia w Europe/Warsaw, limit z blokadą wiersza wydarzenia — prezent wlicza się do limitu).
-- `p_expires_on`: produkt — wymagane, dziś…dziś + 5 lat; wejściówka — null (ważność jak przy zakupie).
-- Ten sam `p_request_key` dla tej samej osoby → istniejące zamówienie z `duplicate = true` (AC-9).
-- Błędy: `forbidden`, `invalid_request`, `user_not_found`, `product_not_found`, `event_unavailable`, `sales_closed`, `sold_out`,
-- `invalid_grant_reason`, `invalid_expires_on`.
create function public.grant_pass(
  p_user_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_reason text,
  p_expires_on date,
  p_request_key uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  prod public.products;
  ev public.calendar_events;
  pass public.user_passes;
  pass_id uuid;
  today date := public.range_today();
  v_reason text := trim(p_reason);
  taken integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null or p_request_key is null or num_nonnulls(p_product_id, p_event_id) <> 1
     or (p_event_id is not null and p_expires_on is not null) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into o from public.orders where user_id = p_user_id and request_key = p_request_key;
  if found then
    if o.payment_method <> 'gift' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'duplicate', true);
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 300 then
    raise exception 'invalid_grant_reason' using errcode = '22023';
  end if;

  if p_product_id is not null then
    select * into prod from public.products where id = p_product_id;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if p_expires_on is null or p_expires_on < today or p_expires_on > (today + interval '5 years')::date then
      raise exception 'invalid_expires_on' using errcode = '22023';
    end if;
    insert into public.orders (user_id, product_id, item_name, amount, payment_method, request_key, created_by)
      values (p_user_id, prod.id, prod.name, 0, 'gift', p_request_key, auth.uid())
      returning * into o;
  else
    select * into ev from public.calendar_events
      where id = p_event_id and status = 'published' and access_mode = 'paid' for update;
    if not found then
      raise exception 'event_unavailable' using errcode = 'P0001';
    end if;
    if today > coalesce(ev.ends_on, ev.starts_on) then
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
    insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, request_key, created_by)
      values (p_user_id, ev.id, 'Wejściówka: ' || ev.name, 0, 'gift', p_request_key, auth.uid())
      returning * into o;
  end if;

  insert into public.order_grants (order_id, reason) values (o.id, v_reason);
  pass_id := public.fulfil_order(o.id);
  select * into pass from public.user_passes where id = pass_id;
  if p_product_id is not null then
    update public.user_passes set expires_on = p_expires_on where id = pass.id returning * into pass;
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), p_user_id, 'pass_grant',
            jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'item_name', o.item_name,
                               'expires_on', coalesce(pass.valid_until, pass.expires_on), 'reason', v_reason));
  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'duplicate', false);
end;
$$;
revoke execute on function public.grant_pass(uuid, uuid, uuid, text, date, uuid) from public, anon;
grant execute on function public.grant_pass(uuid, uuid, uuid, text, date, uuid) to authenticated;

-- ===== cancel_pass_grant (AC-19…AC-21) =====

-- Tylko admin, tylko `gift` w stanie `paid` (blokada wiersza). Zamówienie → `cancelled`, uprawnienie `active` → `cancelled`
-- także przy częściowym wykorzystaniu (`used_up` zostaje), zużycia i książka bez zmian; bez zwrotu pieniędzy.
-- Błędy: `forbidden`, `order_not_found`, `order_not_gift`, `order_not_paid`, `invalid_note`.
create function public.cancel_pass_grant(p_order_id uuid, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  pass public.user_passes;
  note text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(note) > 300 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.payment_method <> 'gift' then
    raise exception 'order_not_gift' using errcode = 'P0001';
  end if;
  if o.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001', hint = 'Przyznanie zostało już anulowane.';
  end if;
  select * into pass from public.user_passes where order_id = o.id for update;
  update public.user_passes set status = 'cancelled' where id = pass.id and status = 'active';
  update public.orders set status = 'cancelled', cancelled_at = now() where id = o.id;
  update public.order_grants set cancel_note = note where order_id = o.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'pass_grant_cancel',
            jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'item_name', o.item_name,
                               'expires_on', coalesce(pass.valid_until, pass.expires_on), 'note', note));
  return 'cancelled';
end;
$$;
revoke execute on function public.cancel_pass_grant(uuid, text) from public, anon;
grant execute on function public.cancel_pass_grant(uuid, text) to authenticated;

-- ===== cancel_order (AC-17) =====

-- Prezentu nie anuluje się ze zwrotem — `order_is_gift` (anulowanie przyznania: `cancel_pass_grant`).
-- Treść jak w 20261118120000_orders_passes.sql + kontrola metody.
create or replace function public.cancel_order(p_order_id uuid, p_refund_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  pass_id uuid;
  note text := nullif(trim(p_refund_note), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.payment_method = 'gift' then
    raise exception 'order_is_gift' using errcode = 'P0001';
  end if;
  if o.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  select p.id into pass_id from public.user_passes p where p.order_id = o.id for update;
  if pass_id is not null and public.pass_has_usage(pass_id) then
    raise exception 'pass_used' using errcode = 'P0001', hint = 'Karnet był używany — zwrot poza systemem.';
  end if;
  update public.user_passes set status = 'cancelled' where id = pass_id;
  if o.payment_method = 'on_site' then
    update public.orders
      set status = 'refunded', refunded_at = now(), refund_note = coalesce(note, 'Zwrot gotówki / na terminal')
      where id = o.id returning * into o;
  else
    update public.orders set status = 'refund_pending', refund_note = note where id = o.id returning * into o;
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'amount', o.amount, 'status', jsonb_build_array('paid', o.status)));
  return o.status;
end;
$$;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- ===== set_order_invoice_details (AC-17) =====

-- Prezent bez faktury — `invoice_not_available`. Treść jak w 20261119010000_invoices.sql + kontrola metody.
create or replace function public.set_order_invoice_details(
  p_order_id uuid,
  p_nip text,
  p_company_name text,
  p_company_address text,
  p_data_source text,
  p_fetched_at timestamptz default null,
  p_save_billing_details boolean default false
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  is_service boolean := auth.uid() is null;
  o public.orders;
  v_nip text := public.normalize_nip(p_nip);
  v_name text := trim(p_company_name);
  v_address text := trim(p_company_address);
  fetched timestamptz;
begin
  if not is_service and not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_save_billing_details and not is_service and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if not is_service and not public.is_admin()
     and (o.payment_method <> 'on_site' or o.created_by is distinct from caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if o.payment_method = 'gift' then
    raise exception 'invoice_not_available' using errcode = 'P0001';
  end if;
  if o.invoice_number is not null then
    raise exception 'invoice_already_issued' using errcode = 'P0001';
  end if;
  if o.status in ('refund_pending', 'refunded') then
    raise exception 'order_refunded' using errcode = 'P0001';
  end if;
  if not public.is_valid_nip(v_nip) then
    raise exception 'invalid_nip' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) not between 2 and 250 then
    raise exception 'invalid_company_name' using errcode = '22023';
  end if;
  if v_address is null or length(v_address) not between 5 and 300 then
    raise exception 'invalid_company_address' using errcode = '22023';
  end if;
  if p_data_source is null or p_data_source not in ('vat_whitelist', 'regon', 'manual') then
    raise exception 'invalid_data_source' using errcode = '22023';
  end if;
  fetched := case when p_data_source = 'manual' then null else coalesce(p_fetched_at, now()) end;

  update public.orders
    set invoice_requested = true, invoice_nip = v_nip, invoice_company_name = v_name,
        invoice_company_address = v_address, invoice_data_source = p_data_source, invoice_fetched_at = fetched
    where id = o.id;

  if p_save_billing_details and o.user_id is not null then
    insert into public.billing_details (user_id, nip, company_name, company_address, data_source, fetched_at)
      values (o.user_id, v_nip, v_name, v_address, p_data_source, fetched)
      on conflict (user_id) do update
        set nip = excluded.nip, company_name = excluded.company_name, company_address = excluded.company_address,
            data_source = excluded.data_source, fetched_at = excluded.fetched_at;
  end if;
end;
$$;
revoke execute on function public.set_order_invoice_details(uuid, text, text, text, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.set_order_invoice_details(uuid, text, text, text, text, timestamptz, boolean)
  to authenticated, service_role;

-- ===== admin_list_orders (AC-14, AC-17) =====

-- Filtr metody przyjmuje `gift`; wynik + `grant_reason`, `grant_cancel_note` (null dla innych metod).
-- Treść jak w 20261119040000_order_number.sql.
drop function public.admin_list_orders(date, date, text, text, uuid, uuid, text);
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
  id uuid, order_number text, created_at timestamptz, item_name text, amount integer, payment_method text,
  on_site_method text, status text, refund_note text, user_id uuid, person_name text, person_email text,
  seller_name text, pass_used boolean, invoice_requested boolean, grant_reason text,
  grant_cancel_note text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  number text := public.normalize_order_number(p_person);
  person text := case when number is null then lower(nullif(trim(p_person), '')) end;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, o.created_at, o.item_name, o.amount, o.payment_method, o.on_site_method, o.status,
           o.refund_note, o.user_id, pr.full_name, u.email::text, s.full_name,
           coalesce(public.pass_has_usage(p.id), false), o.invoice_requested, g.reason, g.cancel_note
    from public.orders o
    left join public.profiles pr on pr.id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.profiles s on s.id = o.created_by
    left join public.user_passes p on p.order_id = o.id
    left join public.order_grants g on g.order_id = o.id
    where case when number is not null then o.order_number = number
          else (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Europe/Warsaw'))
           and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw'))
           and (p_status is null or o.status = p_status)
           and (p_method is null or o.payment_method = p_method)
           and (p_product_id is null or o.product_id = p_product_id)
           and (p_event_id is null or o.calendar_event_id = p_event_id)
           and (person is null or strpos(lower(coalesce(pr.full_name, '') || ' ' || coalesce(u.email, '')), person) > 0)
          end
    order by o.created_at desc, o.id;
end;
$$;
revoke execute on function public.admin_list_orders(date, date, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.admin_list_orders(date, date, text, text, uuid, uuid, text) to authenticated;
