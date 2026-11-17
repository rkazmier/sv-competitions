-- SPEC-003 §5 (AC-9, AC-11): zamówienia, uprawnienia (`user_passes`), powiadomienia Tpay (idempotencja),
-- reguły ważności `passes_valid_on`, realizacja `fulfil_order`, sprzedaż na miejscu `create_on_site_order`,
-- anulowanie ze zwrotem `cancel_order`, zadanie `pg_cron` anulujące nieopłacone zamówienia po 24 h (ADR-0006).
-- Wejściówki (`calendar_event_id`) mają tu tylko model; tryb i cena wydarzenia — zadanie #51.

-- Okres ważności uprawnienia od dnia zakupu (§5). Zmiana przez PR i migrację.
create function public.pass_validity()
returns interval
language sql immutable set search_path = ''
as $$
  select interval '1 year';
$$;

-- `expires_on` dla zakupu danego dnia. 29.02 + 1 rok = 28.02 (arytmetyka PostgreSQL, §7).
create function public.pass_expires_on(purchase_day date)
returns date
language sql immutable set search_path = ''
as $$
  select (purchase_day + public.pass_validity())::date;
$$;

-- ===== Tabele =====

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  product_id uuid references public.products (id) on delete restrict,
  calendar_event_id uuid references public.calendar_events (id) on delete restrict,
  item_name text not null check (length(item_name) between 1 and 200),
  amount integer not null check (amount between 1 and 1000000),
  currency text not null default 'PLN' check (currency = 'PLN'),
  payment_method text not null check (payment_method in ('tpay', 'on_site')),
  on_site_method text check (on_site_method in ('cash', 'terminal')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded')),
  tpay_transaction_id text unique,
  tpay_title text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  refund_note text check (length(refund_note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint orders_one_item check (num_nonnulls(product_id, calendar_event_id) = 1),
  constraint orders_on_site_method check ((on_site_method is not null) = (payment_method = 'on_site'))
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_created_at_idx on public.orders (created_at);
create index orders_product_idx on public.orders (product_id);
create index orders_calendar_event_idx on public.orders (calendar_event_id);
create index orders_pending_idx on public.orders (created_at) where status = 'pending';

comment on table public.orders is 'Zamówienia Oferty (SPEC-003 §5): jeden produkt albo wejściówka; kwoty w groszach; kopie nazwy i ceny';

create table public.payment_notifications (
  id bigint generated always as identity primary key,
  tpay_transaction_id text not null,
  payload_hash text not null unique,
  received_at timestamptz not null default now(),
  result text not null check (length(result) between 1 and 100)
);
create index payment_notifications_transaction_idx on public.payment_notifications (tpay_transaction_id);

comment on table public.payment_notifications is 'Idempotencja payments-notify (ADR-0002); bez danych kart i danych osobowych płatnika';

create table public.user_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  kind text not null check (kind in ('entries', 'days', 'single_entry', 'event_ticket')),
  entries_total integer check (entries_total between 1 and 100),
  entries_left integer check (entries_left between 0 and entries_total),
  days_total integer check (days_total between 1 and 366),
  day_type text check (day_type in ('weekend', 'weekday')),
  calendar_event_id uuid references public.calendar_events (id) on delete restrict,
  first_used_on date,
  valid_until date,
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'used_up', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint user_passes_kind_details check (
    (entries_total is not null) = (kind = 'entries')
    and (entries_left is not null) = (kind = 'entries')
    and (days_total is not null) = (kind = 'days')
    and (day_type is not null) = (kind = 'single_entry')
    and (calendar_event_id is not null) = (kind = 'event_ticket')
  ),
  -- §7: `expires_on` ogranicza tylko aktywację karnetu czasowego.
  constraint user_passes_activation check (kind <> 'days' or first_used_on is null or first_used_on <= expires_on)
);
create index user_passes_user_idx on public.user_passes (user_id, status);

comment on table public.user_passes is 'Uprawnienia (SPEC-003 §5): 1 zamówienie = 1 uprawnienie; wygaśnięcie liczone z dat, nie stanem';
comment on column public.user_passes.valid_until is 'Czasowy: first_used_on + days_total − 1 (wyzwalacz); wejściówka: ostatni dzień wydarzenia';

-- Karnet czasowy: `valid_until` z daty aktywacji; karnet ilościowy bez wejść → `used_up` (§5 stany uprawnienia).
create function public.user_passes_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.kind = 'days' then
    new.valid_until := new.first_used_on + new.days_total - 1;
  end if;
  if new.kind = 'entries' and new.entries_left = 0 and new.status = 'active' then
    new.status := 'used_up';
  end if;
  return new;
end;
$$;
create trigger user_passes_before_write before insert or update on public.user_passes
  for each row execute function public.user_passes_before_write();

-- AC-3: od teraz zwykłe zapytanie do `orders` (wcześniej `false`, gdy tabeli nie było).
create or replace function public.product_order_exists(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.orders where product_id = p_product_id);
$$;

-- Czy uprawnienie było używane (AC-25, AC-26). Tabela `pass_usages` powstaje w SPEC-005 —
-- do tego czasu tylko stan uprawnienia. Funkcja wewnętrzna, bez dostępu dla klientów.
create function public.pass_has_usage(p_pass_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  found boolean;
begin
  select p.status <> 'active' or p.first_used_on is not null or p.entries_left < p.entries_total
    into found from public.user_passes p where p.id = p_pass_id;
  if coalesce(found, false) or to_regclass('public.pass_usages') is null then
    return coalesce(found, false);
  end if;
  execute 'select exists (select 1 from public.pass_usages where pass_id = $1)' into found using p_pass_id;
  return found;
end;
$$;
revoke execute on function public.pass_has_usage(uuid) from public, anon, authenticated;

-- ===== Realizacja zamówienia (AC-9) =====

-- `pending`/`cancelled` → `paid` i nowe uprawnienie w jednej transakcji (§5: wpłata za anulowane też realizuje).
-- Idempotentna: dla zrealizowanego zamówienia zwraca istniejące uprawnienie. Wywołuje `payments-notify`
-- (klucz secret) i `create_on_site_order`. Bez konta (AC-22): uprawnienie wygasa w dniu zakupu.
create function public.fulfil_order(p_order_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  prod public.products;
  ev public.calendar_events;
  expires date;
  pass_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.status not in ('pending', 'cancelled') then
    select p.id into pass_id from public.user_passes p where p.order_id = o.id;
    return pass_id;
  end if;
  update public.orders set status = 'paid', paid_at = now() where id = o.id returning * into o;
  expires := (o.paid_at at time zone 'Europe/Warsaw')::date;
  if o.user_id is not null then
    expires := public.pass_expires_on(expires);
  end if;
  if o.product_id is not null then
    select * into prod from public.products where id = o.product_id;
    insert into public.user_passes (user_id, order_id, kind, entries_total, entries_left, days_total, day_type, expires_on)
      values (o.user_id, o.id, prod.kind, prod.entries, prod.entries, prod.days, prod.day_type, expires)
      returning id into pass_id;
  else
    select * into ev from public.calendar_events where id = o.calendar_event_id;
    insert into public.user_passes (user_id, order_id, kind, calendar_event_id, valid_until, expires_on)
      values (o.user_id, o.id, 'event_ticket', ev.id, coalesce(ev.ends_on, ev.starts_on), expires)
      returning id into pass_id;
  end if;
  return pass_id;
end;
$$;
revoke execute on function public.fulfil_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfil_order(uuid) to service_role;

-- ===== Ważność (§5) =====

-- Uprawnienia osoby ważne dnia D (Europe/Warsaw), używa SPEC-005. Invoker: RLS — własne albo obsługa.
-- Czasowy aktywowany: first_used_on ≤ D ≤ valid_until, także po expires_on (§7); nieaktywowany: D ≤ expires_on.
-- Jednorazowe: sob.–niedz. = weekend, pn–pt = weekday (także w święta). Wejściówka: D w dniach wydarzenia.
create function public.passes_valid_on(p_user_id uuid, p_date date)
returns setof public.user_passes
language sql stable security invoker set search_path = ''
as $$
  select p.*
  from public.user_passes p
  left join public.calendar_events e on e.id = p.calendar_event_id
  where p.user_id = p_user_id
    and p.status = 'active'
    and case p.kind
      when 'days' then
        case when p.first_used_on is null then p_date <= p.expires_on
             else p_date between p.first_used_on and p.valid_until end
      when 'single_entry' then
        p_date <= p.expires_on and (extract(isodow from p_date) in (6, 7)) = (p.day_type = 'weekend')
      when 'event_ticket' then
        p_date <= p.expires_on and p_date between e.starts_on and p.valid_until
      else p_date <= p.expires_on
    end
  order by p.expires_on, p.created_at;
$$;
revoke execute on function public.passes_valid_on(uuid, date) from public, anon;
grant execute on function public.passes_valid_on(uuid, date) to authenticated, service_role;

-- ===== Sprzedaż na miejscu (AC-21, AC-22) =====

-- Tylko obsługa. Zamówienie `on_site` opłacone od razu, `created_by` = sprzedający; zwraca id zamówienia.
-- Osoba bez konta (`p_user_id` null): tylko wejście jednorazowe pasujące do dzisiejszego dnia.
-- Wejściówki na miejscu — po dodaniu ceny wydarzenia (#51).
create function public.create_on_site_order(p_user_id uuid, p_product_id uuid, p_on_site_method text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  prod public.products;
  today date := (now() at time zone 'Europe/Warsaw')::date;
  new_id uuid;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on_site_method is null or p_on_site_method not in ('cash', 'terminal') then
    raise exception 'invalid_on_site_method' using errcode = '22023';
  end if;
  select * into prod from public.products where id = p_product_id;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if p_user_id is null then
    if prod.kind <> 'single_entry'
       or (extract(isodow from today) in (6, 7)) <> (prod.day_type = 'weekend') then
      raise exception 'guest_product_not_allowed' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.orders (user_id, product_id, item_name, amount, payment_method, on_site_method, created_by)
    values (p_user_id, prod.id, prod.name, prod.price, 'on_site', p_on_site_method, auth.uid())
    returning id into new_id;
  perform public.fulfil_order(new_id);
  return new_id;
end;
$$;
revoke execute on function public.create_on_site_order(uuid, uuid, text) from public, anon;
grant execute on function public.create_on_site_order(uuid, uuid, text) to authenticated;

-- ===== Anulowanie i zwrot (AC-25…AC-27) =====

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund'));

-- Tylko admin, tylko `paid` bez zużycia uprawnienia. Uprawnienie → `cancelled`;
-- Tpay → `refund_pending` (zwrot zleca `payments-refund`, #53), na miejscu → od razu `refunded`.
-- Zwraca nowy stan zamówienia; wpis `order_refund` w `audit_log`.
create function public.cancel_order(p_order_id uuid, p_refund_note text default null)
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

-- ===== Zadanie cykliczne (AC-11, ADR-0006) =====

-- `pending` starsze niż 24 h → `cancelled`. Idempotentne; zwraca liczbę anulowanych.
create function public.cancel_unpaid_orders()
returns integer
language sql volatile security definer set search_path = ''
as $$
  with cancelled as (
    update public.orders set status = 'cancelled', cancelled_at = now()
      where status = 'pending' and created_at < now() - interval '24 hours'
      returning 1
  )
  select count(*)::integer from cancelled;
$$;
revoke execute on function public.cancel_unpaid_orders() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cancel-unpaid-orders', '5 * * * *', 'select public.cancel_unpaid_orders()');

-- ===== RLS (§5) =====

alter table public.orders enable row level security;
alter table public.user_passes enable row level security;
alter table public.payment_notifications enable row level security;

create policy "orders: own or staff read" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "user_passes: own or staff read" on public.user_passes for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

-- Zapis wyłącznie funkcjami security definer powyżej i Edge Functions kluczem secret.
revoke all on public.orders, public.user_passes, public.payment_notifications from anon, authenticated;
grant select on public.orders, public.user_passes to authenticated;
