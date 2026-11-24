-- Usunięcie karnetów czasowych (`days`) z bazy (decyzja właściciela 2026-11-24, zmienia SPEC-012 7-A / US-10):
-- żaden karnet czasowy nie został sprzedany, więc typ znika całkowicie — z produktów, uprawnień, zużyć i funkcji.
-- Ruch prawdziwych pieniędzy na karnet czasowy (zamówienie Tpay / na miejscu, które było opłacone) przerywa migrację —
-- takie zamówienie trzeba najpierw rozliczyć ręcznie (zamówienia przechowujemy 5 lat, SPEC-003 §9).

-- ===== Dane =====

do $$
begin
  if exists (
    select 1 from public.orders o join public.products p on p.id = o.product_id
     where p.kind = 'days' and o.payment_method <> 'gift' and o.paid_at is not null
  ) then
    raise exception 'time_passes_sold'
      using hint = 'Istnieją opłacone zamówienia na karnety czasowe — rozlicz je ręcznie przed usunięciem typu days.';
  end if;
end;
$$;

-- Zamówienia nieopłacone / anulowane i prezenty (kwota 0) na karnety czasowe — razem z uprawnieniami.
-- `pass_usages`, `range_closure_passes` (kaskada z `user_passes`), `email_outbox`, `withdrawal_requests` (kaskada z `orders`);
-- wpisy książki rejestru pobytu zostają.
create temporary table time_pass_orders on commit drop as
  select o.id from public.orders o join public.products p on p.id = o.product_id where p.kind = 'days';
delete from public.order_grants where order_id in (select id from time_pass_orders);
delete from public.user_passes where kind = 'days' or order_id in (select id from time_pass_orders);
delete from public.orders where id in (select id from time_pass_orders);
delete from public.products where kind = 'days';

-- ===== Schemat =====

drop trigger orders_before_insert_discontinued on public.orders;
drop function public.orders_reject_discontinued();
drop function public.days_pass_sales_end();

alter table public.products drop constraint products_kind_details;
alter table public.products drop constraint products_kind_check;
alter table public.products drop column days;
alter table public.products add constraint products_kind_check check (kind in ('entries', 'single_entry'));
alter table public.products add constraint products_kind_details check (
  (entries is not null) = (kind = 'entries')
  and (day_type is not null) = (kind = 'single_entry')
);

alter table public.user_passes drop constraint user_passes_kind_details;
alter table public.user_passes drop constraint user_passes_activation;
alter table public.user_passes drop constraint user_passes_kind_check;
alter table public.user_passes drop column days_total;
alter table public.user_passes drop column first_used_on;
alter table public.user_passes add constraint user_passes_kind_check
  check (kind in ('entries', 'single_entry', 'event_ticket'));
alter table public.user_passes add constraint user_passes_kind_details check (
  (entries_total is not null) = (kind = 'entries')
  and (entries_left is not null) = (kind = 'entries')
  and (day_type is not null) = (kind = 'single_entry')
  and (calendar_event_id is not null) = (kind = 'event_ticket')
);
comment on column public.user_passes.valid_until is 'Wejściówka: ostatni dzień wydarzenia';

-- `activated` było tylko zużyciem aktywującym karnet czasowy.
alter table public.pass_usages drop constraint pass_usages_effect_check;
alter table public.pass_usages add constraint pass_usages_effect_check
  check (effect in ('covered', 'decremented', 'consumed'));

-- ===== Funkcje (treść jak w ostatniej wersji, bez gałęzi `days`) =====

-- 20261118100000_products.sql bez kontroli z 20261123100000_sales_terms_consent.sql (nowych rodzajów pilnuje `check`).
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
    if (new.kind, new.entries, new.day_type) is distinct from (old.kind, old.entries, old.day_type)
       and public.product_order_exists(old.id) then
      raise exception 'product_has_orders' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.position := coalesce((select max(p.position) from public.products p where p.kind = new.kind), 0) + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 20261118120000_orders_passes.sql: karnet ilościowy bez wejść → `used_up`.
create or replace function public.user_passes_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.kind = 'entries' and new.entries_left = 0 and new.status = 'active' then
    new.status := 'used_up';
  end if;
  return new;
end;
$$;

-- 20261118120000_orders_passes.sql bez `days_total`.
create or replace function public.fulfil_order(p_order_id uuid)
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
    insert into public.user_passes (user_id, order_id, kind, entries_total, entries_left, day_type, expires_on)
      values (o.user_id, o.id, prod.kind, prod.entries, prod.entries, prod.day_type, expires)
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

-- 20261118150000_range_log.sql bez `first_used_on`.
create or replace function public.pass_has_usage(p_pass_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.user_passes p where p.id = p_pass_id
        and (p.status <> 'active' or p.entries_left < p.entries_total))
    or exists (select 1 from public.pass_usages u where u.user_pass_id = p_pass_id and u.reverted_at is null);
$$;

-- 20261127100000_event_cancel.sql bez gałęzi `days`.
create or replace function public.pass_valid_on(p public.user_passes, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p.status = 'active'
    and (p.kind = 'event_ticket' or not exists (select 1 from public.range_blocked_on(p_date)))
    and case p.kind
      when 'single_entry' then
        p_date <= p.expires_on and (extract(isodow from p_date) in (6, 7)) = (p.day_type = 'weekend')
      when 'event_ticket' then
        p_date <= p.expires_on and coalesce((select p_date between e.starts_on and p.valid_until and e.cancelled_at is null
                                              from public.calendar_events e where e.id = p.calendar_event_id), false)
      else p_date <= p.expires_on
    end;
$$;

-- SPEC-005 AC-10: kolejność zużycia — (0) wejściówka, (1) karnet ilościowy, (2) wejście jednorazowe;
-- w grupie najkrótsza ważność. Zmiana typu wyniku (bez `days_total`, `first_used_on`) wymaga `drop`.
drop function public.passes_for_range_entry(uuid);
create function public.passes_for_range_entry(p_user_id uuid)
returns table (
  priority integer, id uuid, kind text, item_name text, entries_left integer, valid_until date, expires_on date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select case p.kind when 'event_ticket' then 0 when 'entries' then 1 else 2 end,
           p.id, p.kind, o.item_name, p.entries_left, p.valid_until, p.expires_on
    from public.passes_valid_on(p_user_id, public.range_today()) p
    join public.orders o on o.id = p.order_id
    order by 1, p.expires_on, p.created_at;
end;
$$;
revoke execute on function public.passes_for_range_entry(uuid) from public, anon;
grant execute on function public.passes_for_range_entry(uuid) to authenticated;

-- 20261120100000_duty_officer_range_log.sql bez efektu `activated`.
create or replace function public.create_range_log_entry(
  p_id uuid,
  p_signature_path text,
  p_range_officer_id uuid,
  p_profile_id uuid default null,
  p_user_pass_id uuid default null,
  p_is_companion boolean default false,
  p_full_name text default null,
  p_permit_number text default null,
  p_permit_authority text default null,
  p_address text default null
)
returns table (id uuid, entered_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  today date := public.range_today();
  existing public.range_log;
  officer public.range_officers;
  person public.profiles;
  pass public.user_passes;
  usage_effect text;
  entry public.range_log;
begin
  if not public.can_keep_range_log() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into existing from public.range_log r where r.id = p_id;
  if found then
    if existing.created_by is distinct from auth.uid() then
      raise exception 'entry_exists' using errcode = '23505';
    end if;
    return query select existing.id, existing.entered_at;
    return;
  end if;
  if p_id is null or p_signature_path is null
     or p_signature_path !~ ('^[0-9]{4}/[0-9]{2}/' || p_id::text || '\.png$') then
    raise exception 'invalid_signature_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'signatures' and o.name = p_signature_path) then
    raise exception 'signature_missing' using errcode = 'P0001';
  end if;
  select * into officer from public.range_officers r
    where r.id = p_range_officer_id and r.is_active and r.status = 'approved';
  if not found then
    raise exception 'range_officer_inactive' using errcode = 'P0001';
  end if;

  if p_profile_id is not null then
    select * into person from public.profiles p where p.id = p_profile_id;
    if not found then
      raise exception 'person_not_found' using errcode = 'P0002';
    end if;
  else
    person.full_name := nullif(trim(p_full_name), '');
    person.permit_number := nullif(trim(p_permit_number), '');
    person.permit_authority := nullif(trim(p_permit_authority), '');
    person.address := nullif(trim(p_address), '');
  end if;
  if person.full_name is null or (person.permit_number is null and person.address is null)
     or (person.permit_number is null) <> (person.permit_authority is null) then
    raise exception 'person_data_incomplete' using errcode = 'P0001';
  end if;

  if not coalesce(p_is_companion, false) then
    if p_user_pass_id is null then
      raise exception 'pass_required' using errcode = '22023';
    end if;
    select * into pass from public.user_passes p where p.id = p_user_pass_id for update;
    if not found or pass.user_id is distinct from p_profile_id or not public.pass_valid_on(pass, today)
       -- Uprawnienie bez właściciela (AC-19) zużywa się jednym wpisem.
       or (pass.user_id is null and public.pass_has_usage(pass.id)) then
      raise exception 'pass_not_valid' using errcode = 'P0001';
    end if;
    usage_effect := case pass.kind
      when 'event_ticket' then 'covered'
      when 'entries' then 'decremented'
      else 'consumed' end;
    update public.user_passes p set
        entries_left = case when usage_effect = 'decremented' then p.entries_left - 1 else p.entries_left end,
        status = case when usage_effect = 'consumed' then 'used_up' else p.status end
      where p.id = pass.id;
  elsif p_user_pass_id is not null then
    raise exception 'pass_not_allowed' using errcode = '22023';
  end if;

  insert into public.range_log (id, full_name, permit_number, permit_authority, address, range_officer_name,
                                range_officer_id, signature_path, profile_id, is_companion, created_by)
    values (p_id, person.full_name, person.permit_number, person.permit_authority, person.address, officer.full_name,
            officer.id, p_signature_path, p_profile_id, coalesce(p_is_companion, false), auth.uid())
    returning * into entry;
  if usage_effect is not null then
    insert into public.pass_usages (user_pass_id, range_log_entry_id, used_on, effect)
      values (pass.id, entry.id, today, usage_effect);
  end if;
  return query select entry.id, entry.entered_at;
end;
$$;

-- 20261118230000_range_log_revert_usage.sql bez cofania aktywacji karnetu czasowego.
create or replace function public.revert_pass_usage(p_usage_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  usage public.pass_usages;
  pass public.user_passes;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into usage from public.pass_usages u where u.id = p_usage_id;
  if not found then
    raise exception 'usage_not_found' using errcode = 'P0002';
  end if;
  select * into pass from public.user_passes p where p.id = usage.user_pass_id for update;
  -- Ponowna kontrola po blokadzie: dwa równoległe cofnięcia tego samego zużycia → drugie dostaje błąd.
  select * into usage from public.pass_usages u where u.id = p_usage_id for update;
  if usage.reverted_at is not null then
    raise exception 'usage_already_reverted' using errcode = 'P0001';
  end if;

  update public.pass_usages u set reverted_at = now(), reverted_by = auth.uid() where u.id = usage.id;

  if usage.effect = 'decremented' then
    update public.user_passes p set
        entries_left = least(p.entries_left + 1, p.entries_total),
        status = case when p.status = 'used_up' then 'active' else p.status end
      where p.id = pass.id;
  elsif usage.effect = 'consumed' then
    update public.user_passes p set status = case when p.status = 'used_up' then 'active' else p.status end
      where p.id = pass.id;
  end if;

  -- Po retencji wpisu (`range_log_entry_id = null`) nie ma do czego dopisać adnotacji.
  if usage.range_log_entry_id is not null then
    insert into public.range_log_annotations (entry_id, body, created_by)
      values (usage.range_log_entry_id, 'Cofnięto zużycie karnetu', auth.uid());
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), pass.user_id, 'pass_usage_revert',
            jsonb_build_object('pass_usage_id', usage.id, 'user_pass_id', pass.id, 'used_on', usage.used_on,
                               'effect', usage.effect, 'range_log_entry_id', usage.range_log_entry_id));
end;
$$;
