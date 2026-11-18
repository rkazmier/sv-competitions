-- SPEC-006 §5 (AC-1…AC-6, AC-10, AC-14): krótki numer zamówienia `SV-RRRR-NNNNNN`.
-- Rok — data utworzenia w Europe/Warsaw; licznik — jedna ciągła sekwencja (bez zerowania co rok, luki dopuszczalne).
-- `orders.id` (UUID) zostaje kluczem głównym, w adresach i w `hiddenDescription` / `tr_crc` Tpay.

create sequence public.order_number_seq as bigint minvalue 1 no cycle;
revoke all on sequence public.order_number_seq from public, anon, authenticated, service_role;

-- AC-1, AC-2: `SV-` + rok + `-` + licznik uzupełniony zerami do 6 cyfr (dłuższy — bez obcinania).
create function public.format_order_number(p_created_at timestamptz, p_n bigint)
returns text
language sql immutable set search_path = ''
as $$
  select 'SV-' || to_char(p_created_at at time zone 'Europe/Warsaw', 'YYYY') || '-'
    || case when p_n < 1000000 then lpad(p_n::text, 6, '0') else p_n::text end;
$$;
revoke execute on function public.format_order_number(timestamptz, bigint) from public, anon, authenticated;

-- AC-6: numery dla istniejących zamówień w kolejności `created_at`, przy równym czasie `id`.
alter table public.orders add column order_number text;
update public.orders o set order_number = public.format_order_number(n.created_at, n.n)
  from (select id, created_at, row_number() over (order by created_at, id) as n from public.orders) n
  where n.id = o.id;
-- Sekwencja kontynuuje od następnego numeru; pusta tabela → pierwszy numer 1.
select setval('public.order_number_seq', greatest(count(*), 1), count(*) > 0) from public.orders;

alter table public.orders
  alter column order_number set not null,
  add constraint orders_order_number_key unique (order_number),
  add constraint orders_order_number_format check (order_number ~ '^SV-[0-9]{4}-[0-9]{6,}$');
comment on column public.orders.order_number is
  'Numer zamówienia SV-RRRR-NNNNNN (SPEC-006): nadaje wyzwalacz, niezmienny; to nie numer faktury';

-- AC-1, AC-5: każdy `insert` dostaje kolejny numer; wartość od klienta jest ignorowana.
create function public.orders_assign_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.order_number := public.format_order_number(coalesce(new.created_at, now()), nextval('public.order_number_seq'));
  return new;
end;
$$;
revoke execute on function public.orders_assign_number() from public, anon, authenticated;
create trigger orders_before_insert_number before insert on public.orders
  for each row execute function public.orders_assign_number();

-- AC-4: numeru nie zmienia nikt (także `service_role`).
create function public.orders_keep_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.order_number is distinct from old.order_number then
    raise exception 'order_number_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_keep_number() from public, anon, authenticated;
create trigger orders_before_update_number before update of order_number on public.orders
  for each row execute function public.orders_keep_number();

-- AC-10: tekst w formie numeru (`SV-2026-123`, `sv-2026-000123 `) → numer w postaci kanonicznej; inny tekst → null.
create function public.normalize_order_number(p_text text)
returns text
language sql immutable set search_path = ''
as $$
  select case when t ~ '^SV-[0-9]{4}-[0-9]+$' then
      left(t, 8) || case when length(n) < 6 then lpad(n, 6, '0') else n end
    end
  from (select upper(trim(p_text)) as t) s,
       lateral (select coalesce(nullif(ltrim(substr(s.t, 9), '0'), ''), '0') as n) d;
$$;
grant execute on function public.normalize_order_number(text) to authenticated;

-- AC-14: `create_tpay_order` zwraca `order_number` (dla opisu transakcji Tpay), także przy `duplicate`.
-- Treść jak w 20261118140000_payments_tpay.sql; typ wyniku (`jsonb`) bez zmian.
create or replace function public.create_tpay_order(p_user_id uuid, p_product_id uuid, p_event_id uuid, p_request_key uuid)
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
    return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'amount', o.amount,
                              'item_name', o.item_name, 'duplicate', true);
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
  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'amount', o.amount,
                            'item_name', o.item_name, 'duplicate', false);
end;
$$;
revoke execute on function public.create_tpay_order(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_tpay_order(uuid, uuid, uuid, uuid) to service_role;

-- SPEC-006 AC-15: dzisiejsza sprzedaż na miejscu z numerem. Treść jak w 20261118190000_on_site_sales.sql.
drop function public.staff_on_site_sales_today();
create function public.staff_on_site_sales_today()
returns table (
  id uuid, order_number text, created_at timestamptz, item_name text, amount integer, on_site_method text, status text,
  seller_name text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, o.created_at, o.item_name, o.amount, o.on_site_method, o.status, s.full_name
    from public.orders o
    left join public.profiles s on s.id = o.created_by
    where o.payment_method = 'on_site'
      and o.created_at >= (public.range_today()::timestamp at time zone 'Europe/Warsaw')
    order by o.created_at desc, o.id;
end;
$$;
revoke execute on function public.staff_on_site_sales_today() from public, anon;
grant execute on function public.staff_on_site_sales_today() to authenticated;

-- SPEC-006 AC-7, AC-8: panel faktur z numerem. Treść jak w 20261119030000_invoices_admin.sql.
drop function public.admin_list_invoices(text, date, date);
create function public.admin_list_invoices(p_tab text, p_from date default null, p_to date default null)
returns table (
  id uuid, order_number text, paid_at timestamptz, item_name text, amount integer, payment_method text,
  on_site_method text, status text,
  invoice_nip text, invoice_company_name text, invoice_company_address text, invoice_data_source text,
  invoice_number text, ksef_number text, invoice_issued_at timestamptz, issued_by_name text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tab is null or p_tab not in ('todo', 'issued') then
    raise exception 'invalid_tab' using errcode = '22023';
  end if;
  return query
    select o.id, o.order_number, o.paid_at, o.item_name, o.amount, o.payment_method, o.on_site_method, o.status,
           o.invoice_nip, o.invoice_company_name, o.invoice_company_address, o.invoice_data_source,
           o.invoice_number, o.ksef_number, o.invoice_issued_at, coalesce(nullif(pr.full_name, ''), u.email::text)
    from public.orders o
    left join public.profiles pr on pr.id = o.invoice_issued_by
    left join auth.users u on u.id = o.invoice_issued_by
    where o.invoice_requested
      and case when p_tab = 'todo' then o.invoice_number is null and o.status = 'paid'
               else o.invoice_number is not null end
      and (p_from is null or o.paid_at >= (p_from::timestamp at time zone 'Europe/Warsaw'))
      and (p_to is null or o.paid_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw'))
    order by case when p_tab = 'todo' then o.paid_at end asc,
             case when p_tab = 'issued' then o.invoice_issued_at end desc,
             o.id;
end;
$$;
revoke execute on function public.admin_list_invoices(text, date, date) from public, anon;
grant execute on function public.admin_list_invoices(text, date, date) to authenticated;

-- SPEC-006 AC-9, AC-10, AC-11: lista zamówień z numerem; `p_person` w formie numeru → tylko to zamówienie,
-- pozostałe filtry pominięte; inny tekst → wyszukiwanie po osobie jak dotąd. Treść jak w 20261119030000_invoices_admin.sql.
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
  seller_name text, pass_used boolean, invoice_requested boolean
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
           coalesce(public.pass_has_usage(p.id), false), o.invoice_requested
    from public.orders o
    left join public.profiles pr on pr.id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.profiles s on s.id = o.created_by
    left join public.user_passes p on p.order_id = o.id
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
