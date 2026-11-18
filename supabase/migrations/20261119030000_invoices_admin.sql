-- SPEC-004 US-3 (AC-10…AC-16): panel faktur `/panel/faktury/` i „Dodaj dane do faktury” w `/panel/zamowienia/`.
-- `admin_list_invoices` — zakładki „Do wystawienia” / „Wystawione” z filtrem dat zapłaty (Europe/Warsaw) i autorem
-- oznaczenia; `admin_list_orders` zwraca dodatkowo `invoice_requested` (AC-14). Zapis — funkcje z 20261119010000_invoices.sql.

-- AC-10: `todo` — opłacone z żądaniem faktury bez numeru, od najstarszej płatności (zwrócone znikają, AC-16).
-- AC-12, AC-16: `issued` — z numerem faktury (także zwrócone — UI pokazuje ostrzeżenie o korekcie), od najnowszego oznaczenia.
-- AC-15: `p_from` / `p_to` — zakres dat zapłaty (włącznie, Europe/Warsaw).
create function public.admin_list_invoices(p_tab text, p_from date default null, p_to date default null)
returns table (
  id uuid, paid_at timestamptz, item_name text, amount integer, payment_method text, on_site_method text, status text,
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
    select o.id, o.paid_at, o.item_name, o.amount, o.payment_method, o.on_site_method, o.status,
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

-- AC-14: lista zamówień z `invoice_requested` — „Dodaj dane do faktury” przy opłaconych bez faktury.
-- Zmiana typu wyniku wymaga `drop`; treść jak w 20261118200000_orders_admin_refund.sql.
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
  id uuid, created_at timestamptz, item_name text, amount integer, payment_method text, on_site_method text,
  status text, refund_note text, user_id uuid, person_name text, person_email text, seller_name text, pass_used boolean,
  invoice_requested boolean
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
           coalesce(public.pass_has_usage(p.id), false), o.invoice_requested
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
