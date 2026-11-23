-- SPEC-012 US-4 (AC-15…AC-22, AC-52, AC-55): odstąpienie od umowy w panelu i zwrot proporcjonalny przez Tpay.
-- Okno odstąpienia: dzień opłacenia (Europe/Warsaw) + 14 dni włącznie; tylko zamówienia `tpay` na karnet ilościowy
-- lub wejście jednorazowe (karnet czasowy i wejściówka — bez odstąpienia, AC-22, AC-55).

-- ===== Kolumny =====

alter table public.orders
  add column refund_amount integer,
  add column withdrawal_on date,
  add column refund_requested_at timestamptz,
  add constraint orders_refund_amount check (refund_amount between 1 and amount);

comment on column public.orders.refund_amount is 'Kwota zwrotu w groszach (pełny = amount); starsze refunded — null = pełny (SPEC-012)';
comment on column public.orders.withdrawal_on is 'Dzień odstąpienia od umowy (SPEC-012 AC-16)';
comment on column public.orders.refund_requested_at is 'Kiedy zlecono zwrot w Tpay; null przy refund_pending = jeszcze nie wysłany';

-- ===== Funkcje pomocnicze =====

-- Ostatni dzień okna odstąpienia / zwrotu bez ostrzeżenia: dzień opłacenia w Europe/Warsaw + 14 (także przy zmianie czasu).
create function public.withdrawal_last_day(p_paid_at timestamptz)
returns date
language sql stable set search_path = ''
as $$
  select (p_paid_at at time zone 'Europe/Warsaw')::date + 14;
$$;

-- AC-17: wykorzystane i całość — ilościowy: `entries_total − entries_left` z `entries_total`; wejście jednorazowe:
-- 1 z 1, gdy `used_up`, inaczej 0 z 1. Inne rodzaje — `null` (bez odstąpienia).
create function public.withdrawal_usage(p public.user_passes, out used integer, out total integer)
language sql immutable set search_path = ''
as $$
  select case p.kind when 'entries' then p.entries_total - p.entries_left
                     when 'single_entry' then (p.status = 'used_up')::integer end,
         case p.kind when 'entries' then p.entries_total when 'single_entry' then 1 end;
$$;

-- AC-17 (4-A): zwrot = cena − floor(cena × wykorzystane / całość) — wartość wykorzystania w dół do grosza.
create function public.withdrawal_refund(p_amount integer, p_used integer, p_total integer)
returns integer
language sql immutable set search_path = ''
as $$
  select p_amount - (p_amount::bigint * p_used / p_total)::integer;
$$;

revoke execute on function public.withdrawal_last_day(timestamptz) from public, anon, authenticated;
revoke execute on function public.withdrawal_usage(public.user_passes) from public, anon, authenticated;
revoke execute on function public.withdrawal_refund(integer, integer, integer) from public, anon, authenticated;

-- ===== withdrawal_quote (AC-16…AC-18) =====

-- Wyliczenie zwrotu na dzień odstąpienia `p_day` (od dnia opłacenia do dziś, nie później niż koniec okna). Tylko admin.
-- Zwrot 0 zł (usługa wykonana w całości) zwracany normalnie — panel pokazuje AC-18, `withdraw_order` odrzuca.
create function public.withdrawal_quote(p_order_id uuid, p_day date)
returns table (amount integer, used integer, total integer, used_value integer, refund_amount integer, paid_on date, last_day date)
language plpgsql stable security definer set search_path = ''
as $$
declare
  o public.orders;
  p public.user_passes;
  u record;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  select * into p from public.user_passes where order_id = o.id;
  if o.payment_method <> 'tpay' or o.withdrawal_on is not null or p.kind is null
     or p.kind not in ('entries', 'single_entry') then
    raise exception 'withdrawal_not_available' using errcode = 'P0001';
  end if;
  paid_on := (o.paid_at at time zone 'Europe/Warsaw')::date;
  last_day := public.withdrawal_last_day(o.paid_at);
  if public.range_today() > last_day then
    raise exception 'withdrawal_window_closed' using errcode = 'P0001', hint = 'Termin na odstąpienie minął.';
  end if;
  if p_day is null or p_day < paid_on or p_day > public.range_today() then
    raise exception 'withdrawal_invalid_day' using errcode = 'P0001';
  end if;
  select * into u from public.withdrawal_usage(p);
  amount := o.amount;
  used := u.used;
  total := u.total;
  refund_amount := public.withdrawal_refund(o.amount, u.used, u.total);
  used_value := o.amount - refund_amount;
  return next;
end;
$$;
revoke execute on function public.withdrawal_quote(uuid, date) from public, anon;
grant execute on function public.withdrawal_quote(uuid, date) to authenticated;

-- ===== withdraw_order (AC-19, AC-52) =====

-- W jednej transakcji: blokada zamówienia i uprawnienia, ponowne wyliczenie, uprawnienie → `cancelled` (także z zużyciami),
-- zamówienie → `refund_pending` z `refund_amount`, `withdrawal_on`, `audit_log` `order_refund` (`reason: withdrawal`).
-- Ponowienie po nieudanym zwrocie (`paid` z `withdrawal_on`, AC-52): ta sama kwota, bez wyliczenia i anulowania.
-- Wywołuje `payments-refund` z JWT admina. Zwraca `refund_pending`.
create function public.withdraw_order(p_order_id uuid, p_day date, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  q record;
  note text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(note) > 300 then
    raise exception 'invalid_note' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.user_passes where order_id = o.id for update;
  if o.status = 'paid' and o.payment_method = 'tpay' and o.withdrawal_on is not null then
    update public.orders set status = 'refund_pending', refund_requested_at = now() where id = o.id;
    insert into public.audit_log (actor_id, target_user_id, action, changes)
      values (auth.uid(), o.user_id, 'order_refund',
              jsonb_build_object('order_id', o.id, 'reason', 'withdrawal', 'retry', true, 'amount', o.amount,
                                 'refund_amount', o.refund_amount, 'withdrawal_on', o.withdrawal_on,
                                 'status', jsonb_build_array('paid', 'refund_pending')));
    return 'refund_pending';
  end if;
  select * into q from public.withdrawal_quote(o.id, p_day);
  if q.refund_amount = 0 then
    raise exception 'withdrawal_nothing_to_refund' using errcode = 'P0001',
      hint = 'Usługa wykonana w całości — prawo odstąpienia wygasło.';
  end if;
  update public.user_passes set status = 'cancelled' where order_id = o.id;
  update public.orders
    set status = 'refund_pending', refund_amount = q.refund_amount, withdrawal_on = p_day,
        refund_requested_at = now(), refund_note = note
    where id = o.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'reason', 'withdrawal', 'amount', o.amount,
                               'refund_amount', q.refund_amount, 'withdrawal_on', p_day, 'used', q.used, 'total', q.total,
                               'status', jsonb_build_array('paid', 'refund_pending')));
  return 'refund_pending';
end;
$$;
revoke execute on function public.withdraw_order(uuid, date, text) from public, anon;
grant execute on function public.withdraw_order(uuid, date, text) to authenticated;

-- ===== cancel_order (AC-21, AC-22, AC-55) =====

-- Zmiany względem 20261121100000_pass_grant.sql: `refund_amount = amount`, `refund_requested_at` (Tpay) i wymagana notatka
-- (3–300 znaków, `refund_note_required`) po upływie 14 dni od opłacenia dla karnetów i wejść (nie dla wejściówek).
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
  if o.product_id is not null and public.range_today() > public.withdrawal_last_day(o.paid_at)
     and coalesce(length(note), 0) not between 3 and 300 then
    raise exception 'refund_note_required' using errcode = 'P0001',
      hint = 'Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).';
  end if;
  select p.id into pass_id from public.user_passes p where p.order_id = o.id for update;
  if pass_id is not null and public.pass_has_usage(pass_id) then
    raise exception 'pass_used' using errcode = 'P0001', hint = 'Karnet był używany — zwrot poza systemem.';
  end if;
  update public.user_passes set status = 'cancelled' where id = pass_id;
  if o.payment_method = 'on_site' then
    update public.orders
      set status = 'refunded', refunded_at = now(), refund_amount = o.amount,
          refund_note = coalesce(note, 'Zwrot gotówki / na terminal')
      where id = o.id returning * into o;
  else
    update public.orders
      set status = 'refund_pending', refund_amount = o.amount, refund_requested_at = now(), refund_note = note
      where id = o.id returning * into o;
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'amount', o.amount, 'refund_amount', o.amount,
                               'status', jsonb_build_array('paid', o.status)));
  return o.status;
end;
$$;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- ===== revert_order_refund (AC-52) =====

-- Tpay odrzucił zwrot → `paid`. Po odstąpieniu (`withdrawal_on`) uprawnienie zostaje `cancelled`, a `refund_amount`,
-- `withdrawal_on` i notatka zostają (ponowienie wysyła tę samą kwotę). „Anuluj i zwróć” — jak dotąd: `active`.
create or replace function public.revert_order_refund(p_order_id uuid, p_actor_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  update public.orders
    set status = 'paid', refund_requested_at = null,
        refund_note = case when withdrawal_on is null then null else refund_note end,
        refund_amount = case when withdrawal_on is null then null else refund_amount end
    where id = p_order_id and payment_method = 'tpay' and status = 'refund_pending'
    returning * into o;
  if not found then
    return false;
  end if;
  if o.withdrawal_on is null then
    update public.user_passes set status = 'active' where order_id = o.id and status = 'cancelled';
  end if;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (p_actor_id, o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'amount', o.amount, 'status', jsonb_build_array('refund_pending', 'paid'),
                               'reason', 'tpay_refund_failed', 'refund_amount', o.refund_amount));
  return true;
end;
$$;
revoke execute on function public.revert_order_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revert_order_refund(uuid, uuid) to service_role;

-- ===== process_tpay_notification (§7: zwrot częściowy) =====

-- Zmiana względem 20261118200000_orders_admin_refund.sql: powiadomienie o zwrocie porównuje kwotę z
-- `coalesce(refund_amount, amount)` — w `tr_amount` albo `tr_paid` (Tpay podaje kwotę zwrotu częściowego w jednym z pól;
-- powiadomienie jest podpisane JWS, porównanie to kontrola spójności). `refunded` zapisuje `refund_amount`.
create or replace function public.process_tpay_notification(
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
  expected integer;
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
    expected := coalesce(o.refund_amount, o.amount);
    if p_amount is distinct from expected and p_paid is distinct from expected then
      outcome := 'amount_mismatch';
    elsif o.status = 'refunded' then
      outcome := 'already_refunded';
    elsif o.status in ('paid', 'refund_pending') then
      update public.user_passes set status = 'cancelled' where order_id = o.id;
      update public.orders set status = 'refunded', refunded_at = now(), refund_amount = expected where id = o.id;
      if o.status = 'paid' then
        insert into public.audit_log (actor_id, target_user_id, action, changes)
          values (null, o.user_id, 'order_refund',
                  jsonb_build_object('order_id', o.id, 'amount', o.amount, 'refund_amount', expected,
                                     'status', jsonb_build_array('paid', 'refunded')));
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

-- ===== admin_list_orders (AC-15, AC-18, AC-20, AC-21) =====

-- Wynik + `refund_amount`, `withdrawal_on`, `pass_kind`, `refund_window_until` (koniec okna 14 dni — zamówienia na produkt),
-- `withdrawal_refund` (zwrot na dziś, gdy odstąpienie możliwe; 0 — AC-18). Treść jak w 20261124100000_email_outbox.sql.
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
  grant_cancel_note text, terms_version date, early_performance_consent_at timestamptz,
  email_status text, email_sent_at timestamptz,
  refund_amount integer, withdrawal_on date, pass_kind text, refund_window_until date, withdrawal_refund integer
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
           o.terms_version, o.early_performance_consent_at, m.status, m.sent_at,
           o.refund_amount, o.withdrawal_on, p.kind,
           case when o.product_id is not null and o.paid_at is not null then public.withdrawal_last_day(o.paid_at) end,
           case when o.payment_method = 'tpay' and o.status = 'paid' and o.withdrawal_on is null
                     and p.kind in ('entries', 'single_entry')
                     and public.range_today() <= public.withdrawal_last_day(o.paid_at)
                then public.withdrawal_refund(o.amount, (public.withdrawal_usage(p)).used, (public.withdrawal_usage(p)).total)
           end
    from public.orders o
    left join public.profiles pr on pr.id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.profiles s on s.id = o.created_by
    left join public.user_passes p on p.order_id = o.id
    left join public.order_grants g on g.order_id = o.id
    left join public.email_outbox m on m.order_id = o.id and m.kind = 'order_paid'
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
