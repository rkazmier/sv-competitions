-- SPEC-012 US-1, US-2, US-10 (AC-1…AC-8, AC-53, AC-54): wersja regulaminu sprzedaży i zgoda na korzystanie
-- przed upływem 14 dni przy zamówieniu Tpay; wycofanie karnetów czasowych z Oferty (decyzja 7-A).

-- ===== sales_terms_versions (AC-1, AC-4) =====

create table public.sales_terms_versions (
  effective_from date primary key
);

comment on table public.sales_terms_versions is
  'Wersje regulaminu sprzedaży (SPEC-012 §5): wersja = data obowiązywania; plik '
  'web/public/regulamin-sprzedazy/regulamin-sprzedazy-<RRRR-MM-DD>.pdf; wiersze dodaje migracja (razem z PDF)';

alter table public.sales_terms_versions enable row level security;
create policy "sales_terms_versions: public read" on public.sales_terms_versions for select to anon, authenticated
  using (true);
-- Zapis tylko migracją.
revoke insert, update, delete, truncate on public.sales_terms_versions from anon, authenticated;

-- Pierwsza wersja (#154): treść i PDF `regulamin-sprzedazy-2027-01-01.pdf` (PR #168).
insert into public.sales_terms_versions (effective_from) values ('2027-01-01');

-- Bieżąca wersja dnia (Europe/Warsaw): najnowsza `effective_from ≤ dziś`; `null` — brak obowiązującej wersji (§7).
create function public.current_sales_terms_version()
returns date
language sql stable set search_path = ''
as $$
  select max(effective_from) from public.sales_terms_versions where effective_from <= public.range_today();
$$;
grant execute on function public.current_sales_terms_version() to anon, authenticated;

-- ===== orders (AC-3, AC-8) =====

alter table public.orders
  add column terms_version date references public.sales_terms_versions (effective_from),
  add column early_performance_consent_at timestamptz;

comment on column public.orders.terms_version is
  'SPEC-012 AC-3: wersja regulaminu zaakceptowana przy zamówieniu Tpay; null — na miejscu, prezent, przed 1.01.2027';
comment on column public.orders.early_performance_consent_at is
  'SPEC-012 AC-8: zgoda na korzystanie przed upływem 14 dni (czas serwera); null — wejściówka, na miejscu, prezent';

-- ===== Karnety czasowe wycofane (AC-53, AC-54) =====

-- Pierwszy dzień bez sprzedaży karnetów czasowych (Europe/Warsaw). Ta sama stała: `DAYS_PASS_SALES_END` w web/src/lib/products.ts.
create function public.days_pass_sales_end()
returns date
language sql stable set search_path = ''
as $$
  select date '2027-01-01';
$$;
grant execute on function public.days_pass_sales_end() to anon, authenticated;

-- AC-53: nowy produkt `days` (także zmiana rodzaju na `days`) odrzucony — z panelu i z API z JWT (admin).
-- Wyjątek: klucz secret (`service_role` — tylko serwer i dane testowe E2E dla karnetów sprzedanych przed 7-A).
-- Treść jak w 20261118100000_products.sql + kontrola rodzaju.
create or replace function public.products_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.description := nullif(trim(new.description), '');
  if tg_op = 'INSERT' then
    new.is_active := false;
    new.created_at := now();
  else
    new.created_at := old.created_at;
    if (new.kind, new.entries, new.days, new.day_type) is distinct from (old.kind, old.entries, old.days, old.day_type)
       and public.product_order_exists(old.id) then
      raise exception 'product_has_orders' using errcode = '23514';
    end if;
  end if;
  if new.kind = 'days' and (tg_op = 'INSERT' or old.kind <> 'days')
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'product_kind_discontinued' using errcode = '23514',
      hint = 'Karnety czasowe zostały wycofane z Oferty.';
  end if;
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.position := coalesce((select max(p.position) from public.products p where p.kind = new.kind), 0) + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- AC-54: od `days_pass_sales_end()` nowe zamówienie na karnet czasowy jest odrzucane — dotyczy `create_tpay_order`,
-- `create_on_site_order` i `grant_pass` (wszystkie tworzą zamówienie przez `insert`). Zamówienie `pending`
-- utworzone wcześniej i opłacone później realizuje się normalnie (wyzwalacz tylko przy `insert`).
create function public.orders_reject_discontinued()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.product_id is not null and public.range_today() >= public.days_pass_sales_end()
     and exists (select 1 from public.products p where p.id = new.product_id and p.kind = 'days') then
    raise exception 'product_discontinued' using errcode = 'P0001', hint = 'Ten produkt nie jest już w ofercie.';
  end if;
  return new;
end;
$$;
create trigger orders_before_insert_discontinued before insert on public.orders
  for each row execute function public.orders_reject_discontinued();

-- ===== create_tpay_order (AC-3, AC-7, AC-8) =====

-- Nowa sygnatura: `p_terms_version` — wersja pokazana w przeglądarce, musi równać się `current_sales_terms_version()`
-- (także `null`, gdy żadna wersja jeszcze nie obowiązuje) — inaczej `terms_changed`; `p_consent` — zgoda z AC-6,
-- wymagana dla produktu (karnet, wejście jednorazowe), dla wejściówki pomijana — inaczej `consent_required`.
-- Kontrole po sprawdzeniu dostępności (te same błędy co dotąd). Reszta treści jak w 20261119040000_order_number.sql.
drop function public.create_tpay_order(uuid, uuid, uuid, uuid);
create function public.create_tpay_order(
  p_user_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_request_key uuid,
  p_terms_version date default null,
  p_consent boolean default false
)
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
    if not coalesce(p_consent, false) then
      raise exception 'consent_required' using errcode = '22023';
    end if;
    if p_terms_version is distinct from public.current_sales_terms_version() then
      raise exception 'terms_changed' using errcode = 'P0001';
    end if;
    insert into public.orders (user_id, product_id, item_name, amount, payment_method, request_key,
                               terms_version, early_performance_consent_at)
      values (p_user_id, prod.id, prod.name, prod.price, 'tpay', p_request_key, p_terms_version, now())
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
    if p_terms_version is distinct from public.current_sales_terms_version() then
      raise exception 'terms_changed' using errcode = 'P0001';
    end if;
    insert into public.orders (user_id, calendar_event_id, item_name, amount, payment_method, request_key, terms_version)
      values (p_user_id, ev.id, 'Wejściówka: ' || ev.name, ev.ticket_price, 'tpay', p_request_key, p_terms_version)
      returning * into o;
  end if;
  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'amount', o.amount,
                            'item_name', o.item_name, 'duplicate', false);
end;
$$;
revoke execute on function public.create_tpay_order(uuid, uuid, uuid, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.create_tpay_order(uuid, uuid, uuid, uuid, date, boolean) to service_role;

-- ===== admin_list_orders (AC-5) =====

-- Wynik + `terms_version`, `early_performance_consent_at`. Treść jak w 20261121100000_pass_grant.sql.
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
  grant_cancel_note text, terms_version date, early_performance_consent_at timestamptz
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
           coalesce(public.pass_has_usage(p.id), false), o.invoice_requested, g.reason, g.cancel_note,
           o.terms_version, o.early_performance_consent_at
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
