-- SPEC-004 §5 (AC-5, AC-12, AC-13): dane do faktury w profilu (`billing_details`), kopia danych faktury w `orders`,
-- walidacja NIP (`normalize_nip`, `is_valid_nip`) i numeru KSeF, funkcje `set_order_invoice_details`,
-- `mark_invoice_issued`, `unmark_invoice`. Faktury wystawia admin ręcznie w e-mikrofirmie (ADR-0005).

-- ===== Walidacja =====

-- §7: spacje i myślniki usuwane, prefiks `PL` (bez rozróżniania wielkości liter) odcinany. Inny prefiks zostaje,
-- więc `is_valid_nip` go odrzuci (NIP zagraniczny poza zakresem).
create function public.normalize_nip(p_nip text)
returns text
language sql immutable set search_path = ''
as $$
  select case when s like 'PL%' then substr(s, 3) else s end
  from (select regexp_replace(upper(p_nip), '[[:space:]-]', '', 'g') as s) t;
$$;

-- 10 cyfr, suma kontrolna: wagi 6,5,7,2,3,4,5,6,7; suma mod 11 = ostatnia cyfra (reszta 10 — NIP nieprawidłowy).
-- Przyjmuje NIP po `normalize_nip`. Null → false.
create function public.is_valid_nip(p_nip text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_nip is null or p_nip !~ '^[0-9]{10}$' then false
    else (
      select sum(substr(p_nip, i::integer, 1)::integer * w) % 11
      from unnest(array[6, 5, 7, 2, 3, 4, 5, 6, 7]) with ordinality as t(w, i)
    ) = substr(p_nip, 10, 1)::integer
  end;
$$;

-- AC-12: numer KSeF — NIP sprzedawcy, data RRRRMMDD, część techniczna (12 znaków hex), suma kontrolna (2 znaki hex).
create function public.is_valid_ksef_number(p_ksef text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(length(p_ksef) <= 50 and p_ksef ~ '^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$', false);
$$;

-- ===== billing_details =====

create table public.billing_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  nip text not null check (public.is_valid_nip(nip)),
  company_name text not null check (length(company_name) between 2 and 250),
  company_address text not null check (length(company_address) between 5 and 300),
  data_source text not null check (data_source in ('vat_whitelist', 'regon', 'manual')),
  fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.billing_details is 'Dane do faktury konta (SPEC-004 §5): podpowiedź przy kolejnym zakupie; zamówienia mają własną kopię';

-- Normalizacja NIP i trim przed `check`; `updated_at` zawsze z bazy.
create function public.billing_details_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.nip := public.normalize_nip(new.nip);
  new.company_name := trim(new.company_name);
  new.company_address := trim(new.company_address);
  new.updated_at := now();
  return new;
end;
$$;
create trigger billing_details_before_write before insert or update on public.billing_details
  for each row execute function public.billing_details_before_write();

-- ===== orders: dane faktury =====

alter table public.orders
  add column invoice_requested boolean not null default false,
  add column invoice_nip text,
  add column invoice_company_name text,
  add column invoice_company_address text,
  add column invoice_data_source text check (invoice_data_source in ('vat_whitelist', 'regon', 'manual')),
  add column invoice_fetched_at timestamptz,
  add column invoice_number text check (length(invoice_number) between 1 and 50),
  add column ksef_number text check (ksef_number is null or public.is_valid_ksef_number(ksef_number)),
  add column invoice_issued_at timestamptz,
  add column invoice_issued_by uuid references public.profiles (id) on delete set null,
  add constraint orders_invoice_details check (
    case when invoice_requested then
      public.is_valid_nip(invoice_nip)
      and length(invoice_company_name) between 2 and 250
      and length(invoice_company_address) between 5 and 300
      and invoice_data_source is not null
    else
      num_nonnulls(invoice_nip, invoice_company_name, invoice_company_address, invoice_data_source, invoice_fetched_at) = 0
    end
  ),
  -- Stany (§5): brak → `requested` (bez numeru) → `issued` (numer niepusty). `invoice_issued_by` może zniknąć z kontem.
  add constraint orders_invoice_issued check (
    (invoice_number is null) = (invoice_issued_at is null)
    and (invoice_number is null or invoice_requested)
    and (ksef_number is null or invoice_number is not null)
  );

-- AC-10: lista „Do wystawienia” od najstarszej płatności.
create index orders_invoice_todo_idx on public.orders (paid_at) where invoice_requested and invoice_number is null;

comment on column public.orders.invoice_fetched_at is 'SPEC-004 AC-5: data pobrania danych z rejestru (null dla `manual`)';

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked'));

-- ===== Funkcje =====

-- AC-5, AC-9, AC-14: zapis kopii danych faktury przy zamówieniu, tylko przed oznaczeniem jako wystawionej.
-- Kto: klucz secret (`payments-create`, AC-5), admin (dowolne zamówienie, AC-14), obsługa — tylko zamówienie „na miejscu”,
-- które sama zarejestrowała (AC-9). `p_save_billing_details` nadpisuje `billing_details` właściciela zamówienia
-- (AC-5) — tylko klucz secret i admin (RLS §5: zapis cudzych danych — admin); admin w AC-14 przekazuje `false`.
-- Źródło `manual` → `fetched_at` null; z rejestru → podana data albo teraz.
create function public.set_order_invoice_details(
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

-- AC-12: admin oznacza fakturę jako wystawioną w e-mikrofirmie — numer faktury (1–50 znaków), opcjonalnie numer KSeF.
-- Tylko opłacone zamówienie z żądaniem faktury, jeszcze nieoznaczone. Wpis `invoice_issued` w `audit_log`.
create function public.mark_invoice_issued(p_order_id uuid, p_invoice_number text, p_ksef_number text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  num text := trim(p_invoice_number);
  ksef text := nullif(upper(trim(p_ksef_number)), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if not o.invoice_requested then
    raise exception 'invoice_not_requested' using errcode = 'P0001';
  end if;
  if o.invoice_number is not null then
    raise exception 'invoice_already_issued' using errcode = 'P0001';
  end if;
  if o.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  if num is null or length(num) not between 1 and 50 then
    raise exception 'invalid_invoice_number' using errcode = '22023';
  end if;
  if ksef is not null and not public.is_valid_ksef_number(ksef) then
    raise exception 'invalid_ksef_number' using errcode = '22023';
  end if;
  update public.orders
    set invoice_number = num, ksef_number = ksef, invoice_issued_at = now(), invoice_issued_by = auth.uid()
    where id = o.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'invoice_issued',
            jsonb_build_object('order_id', o.id, 'invoice_number', jsonb_build_array(null, num),
                               'ksef_number', jsonb_build_array(null, ksef)));
end;
$$;
revoke execute on function public.mark_invoice_issued(uuid, text, text) from public, anon;
grant execute on function public.mark_invoice_issued(uuid, text, text) to authenticated;

-- AC-13: admin cofa omyłkowe oznaczenie — pozycja wraca do „Do wystawienia”. Wpis `invoice_unmarked` w `audit_log`.
create function public.unmark_invoice(p_order_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.invoice_number is null then
    raise exception 'invoice_not_issued' using errcode = 'P0001';
  end if;
  update public.orders
    set invoice_number = null, ksef_number = null, invoice_issued_at = null, invoice_issued_by = null
    where id = o.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'invoice_unmarked',
            jsonb_build_object('order_id', o.id, 'invoice_number', jsonb_build_array(o.invoice_number, null),
                               'ksef_number', jsonb_build_array(o.ksef_number, null)));
end;
$$;
revoke execute on function public.unmark_invoice(uuid) from public, anon;
grant execute on function public.unmark_invoice(uuid) to authenticated;

-- ===== RLS (§5) =====

-- Własny wiersz: odczyt i zapis (AC-8); obsługa — odczyt (podpowiedź przy sprzedaży, AC-9); admin — zapis cudzych.
-- Kolumny faktury w `orders` — bez zmian w uprawnieniach: klient ma tylko `select`, zapis wyłącznie funkcjami powyżej.
alter table public.billing_details enable row level security;

create policy "billing_details: own or staff read" on public.billing_details for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "billing_details: own or admin insert" on public.billing_details for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "billing_details: own or admin update" on public.billing_details for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "billing_details: own or admin delete" on public.billing_details for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.billing_details from anon, authenticated;
grant select, insert, update, delete on public.billing_details to authenticated;
