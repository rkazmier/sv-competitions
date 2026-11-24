-- SPEC-012 US-9 (AC-46…AC-50, AC-52, AC-55): „Odstąp od umowy” w `/konto/` — oświadczenie klienta, od razu wyłącza
-- uprawnienie; zwrot (kwota ustalona w chwili oświadczenia) zleca admin jednym kliknięciem w `/panel/zamowienia/`.

-- ===== withdrawal_requests (§5) =====

create table public.withdrawal_requests (
  order_id uuid primary key references public.orders (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  comment text check (char_length(comment) <= 500),
  status text not null default 'new' check (status in ('new', 'processed')),
  submitted_at timestamptz not null default now(),
  -- Ostatnie zlecenie zwrotu; zostaje po nieudanym zwrocie (`new` + `processed_at` — „Zwrot nieudany”, AC-52).
  processed_at timestamptz,
  processed_by uuid references public.profiles (id) on delete set null
);
create index withdrawal_requests_new_idx on public.withdrawal_requests (submitted_at) where status = 'new';

comment on table public.withdrawal_requests is
  'SPEC-012 US-9: oświadczenia o odstąpieniu od umowy złożone w /konto/ (comment — tylko admin i właściciel zamówienia)';

-- §5 RLS: brak bezpośredniego dostępu klientów; odczyt przez `my_withdrawals()` i `admin_list_orders`.
alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from anon, authenticated;

-- ===== submit_withdrawal (AC-46…AC-48, AC-50, AC-55) =====

-- Właściciel zamówienia. W jednej transakcji: wpis `withdrawal_requests`, uprawnienie → `cancelled` (także z zużyciami),
-- `withdrawal_on` = dziś, `refund_amount` wyliczone na dziś (AC-17), `email_outbox` `withdrawal_received` i `withdrawal_admin`;
-- wysyłka (`pg_net`) po zatwierdzeniu. Zwraca kwotę zwrotu w groszach.
create function public.submit_withdrawal(p_order_id uuid, p_comment text default null)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  p public.user_passes;
  u record;
  refund integer;
  note text := nullif(trim(p_comment), '');
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(note) > 500 then
    raise exception 'invalid_comment' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.withdrawal_requests where order_id = o.id) or o.withdrawal_on is not null then
    raise exception 'withdrawal_exists' using errcode = 'P0001';
  end if;
  if o.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  select * into p from public.user_passes where order_id = o.id for update;
  -- AC-55: karnet czasowy (i wejściówka, sprzedaż na miejscu, prezent) — bez odstąpienia z konta.
  if o.payment_method <> 'tpay' or p.kind is null or p.kind not in ('entries', 'single_entry') then
    raise exception 'withdrawal_not_available' using errcode = 'P0001';
  end if;
  if public.range_today() > public.withdrawal_last_day(o.paid_at) then
    raise exception 'withdrawal_window_closed' using errcode = 'P0001', hint = 'Termin na odstąpienie minął.';
  end if;
  select * into u from public.withdrawal_usage(p);
  refund := public.withdrawal_refund(o.amount, u.used, u.total);
  if refund = 0 then
    raise exception 'withdrawal_nothing_to_refund' using errcode = 'P0001',
      hint = 'Usługa wykonana w całości — prawo odstąpienia wygasło.';
  end if;
  insert into public.withdrawal_requests (order_id, user_id, comment) values (o.id, o.user_id, note);
  update public.user_passes set status = 'cancelled' where id = p.id;
  update public.orders set withdrawal_on = public.range_today(), refund_amount = refund where id = o.id;
  insert into public.email_outbox (kind, order_id) values ('withdrawal_received', o.id), ('withdrawal_admin', o.id)
    on conflict (kind, order_id) do nothing;
  perform public.invoke_mail_send();
  return refund;
end;
$$;
revoke execute on function public.submit_withdrawal(uuid, text) from public, anon;
grant execute on function public.submit_withdrawal(uuid, text) to authenticated;

-- ===== my_withdrawals (AC-46, AC-55) =====

-- Własne zamówienia z odstąpieniem: możliwym dziś (`submitted_at is null` — przycisk „Odstąp od umowy”, wyliczenie
-- zwrotu na dziś > 0, AC-16, AC-17) albo zgłoszonym z konta (`submitted_at`, kwota z oświadczenia). Bez komentarza klienta.
create function public.my_withdrawals()
returns table (
  order_id uuid, paid_on date, last_day date, amount integer, used integer, total integer, used_value integer,
  refund_amount integer, submitted_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select o.id, (o.paid_at at time zone 'Europe/Warsaw')::date, public.withdrawal_last_day(o.paid_at), o.amount,
         u.used, u.total, o.amount - q.refund, q.refund, r.submitted_at
    from public.orders o
    join public.user_passes p on p.order_id = o.id
    cross join lateral public.withdrawal_usage(p) u
    left join public.withdrawal_requests r on r.order_id = o.id
    cross join lateral (
      select case when r.order_id is not null then o.refund_amount
                  else public.withdrawal_refund(o.amount, u.used, u.total) end as refund
    ) q
   where o.user_id = auth.uid()
     and (r.order_id is not null
          or (o.payment_method = 'tpay' and o.status = 'paid' and o.withdrawal_on is null
              and p.kind in ('entries', 'single_entry')
              and public.range_today() <= public.withdrawal_last_day(o.paid_at)
              and q.refund > 0));
$$;
revoke execute on function public.my_withdrawals() from public, anon;
grant execute on function public.my_withdrawals() to authenticated;

-- ===== withdraw_order — „Zleć zwrot” dla zgłoszenia (AC-49) =====

-- Zmiana względem 20261125100000_order_withdrawal.sql: zgłoszenie z konta (`paid` z `withdrawal_on`) idzie gałęzią
-- ponowienia — ta sama kwota, bez wyliczenia i anulowania; zgłoszenie → `processed` (`processed_at`, `processed_by`).
create or replace function public.withdraw_order(p_order_id uuid, p_day date, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  q record;
  note text := nullif(trim(p_note), '');
  requested boolean;
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
    update public.withdrawal_requests set status = 'processed', processed_at = now(), processed_by = auth.uid()
      where order_id = o.id;
    requested := found;
    update public.orders set status = 'refund_pending', refund_requested_at = now() where id = o.id;
    insert into public.audit_log (actor_id, target_user_id, action, changes)
      values (auth.uid(), o.user_id, 'order_refund',
              jsonb_build_object('order_id', o.id, 'reason', 'withdrawal', 'retry', true, 'amount', o.amount,
                                 'refund_amount', o.refund_amount, 'withdrawal_on', o.withdrawal_on,
                                 'status', jsonb_build_array('paid', 'refund_pending'))
              || case when requested then jsonb_build_object('request', true) else '{}'::jsonb end);
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

-- ===== revert_order_refund (AC-52) =====

-- Zmiana względem 20261125100000_order_withdrawal.sql: zgłoszenie z konta wraca do `new` (`processed_at` zostaje).
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
  update public.withdrawal_requests set status = 'new' where order_id = o.id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (p_actor_id, o.user_id, 'order_refund',
            jsonb_build_object('order_id', o.id, 'amount', o.amount, 'status', jsonb_build_array('refund_pending', 'paid'),
                               'reason', 'tpay_refund_failed', 'refund_amount', o.refund_amount));
  return true;
end;
$$;
revoke execute on function public.revert_order_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revert_order_refund(uuid, uuid) to service_role;

-- ===== mail_outbox_claim — dane e-maili odstąpienia (AC-48) =====

-- Wynik + `withdrawal_on`, `withdrawal_submitted_at`, `withdrawal_comment`. `withdrawal_admin` idzie na `MAIL_FROM`,
-- więc nie jest pomijany po usunięciu konta (AC-12 dotyczy e-maili do klienta). Treść jak w 20261127100000_event_cancel.sql.
drop function public.mail_outbox_claim(integer);
create function public.mail_outbox_claim(p_limit integer default 20)
returns table (
  id uuid, kind text, attempts integer, order_id uuid, order_number text, item_name text, amount integer,
  paid_at timestamptz, terms_version date, early_performance_consent_at timestamptz, pass_kind text, expires_on date,
  event_starts_on date, event_ends_on date, email text,
  payment_method text, refund_amount integer, event_name text, cancel_reason text,
  withdrawal_on date, withdrawal_submitted_at timestamptz, withdrawal_comment text
)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.email_outbox e set status = 'skipped', next_attempt_at = null
    from public.orders o
   where o.id = e.order_id and e.status = 'pending' and o.user_id is null and e.kind <> 'withdrawal_admin';

  return query
    with due as (
      select e.id from public.email_outbox e
       where e.status = 'pending' and e.next_attempt_at <= now()
       order by e.next_attempt_at, e.created_at
       limit greatest(1, least(coalesce(p_limit, 20), 100))
       for update skip locked
    ), claimed as (
      update public.email_outbox e set next_attempt_at = now() + public.mail_claim_lease()
        from due where e.id = due.id
      returning e.id, e.kind, e.attempts, e.order_id, e.next_attempt_at
    )
    select c.id, c.kind, c.attempts, o.id, o.order_number, o.item_name, o.amount, o.paid_at, o.terms_version,
           o.early_performance_consent_at, p.kind, p.expires_on, ev.starts_on, coalesce(ev.ends_on, ev.starts_on),
           case when c.kind <> 'withdrawal_admin' then u.email::text end, o.payment_method, o.refund_amount,
           ev.name, ev.cancel_reason, o.withdrawal_on, r.submitted_at,
           case when c.kind = 'withdrawal_received' then r.comment end
      from claimed c
      join public.orders o on o.id = c.order_id
      left join auth.users u on u.id = o.user_id
      left join public.user_passes p on p.order_id = o.id
      left join public.calendar_events ev on ev.id = o.calendar_event_id
      left join public.withdrawal_requests r on r.order_id = o.id
     order by c.next_attempt_at, c.id;
end;
$$;
revoke execute on function public.mail_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.mail_outbox_claim(integer) to service_role;

-- ===== admin_list_orders — „Zgłoszone odstąpienia” (AC-49) =====

-- Wynik + `withdrawal_submitted_at`, `withdrawal_processed_at` (zgłoszenie `new`; `null` — brak lub zlecone).
-- `p_status = 'withdrawal_requested'` — zgłoszenia `new` niezależnie od dat i pozostałych filtrów (zgłoszenie
-- może dotyczyć zamówienia z poprzedniego miesiąca). Treść jak w 20261125100000_order_withdrawal.sql.
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
  refund_amount integer, withdrawal_on date, pass_kind text, refund_window_until date, withdrawal_refund integer,
  withdrawal_submitted_at timestamptz, withdrawal_processed_at timestamptz, withdrawal_comment text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  number text := public.normalize_order_number(p_person);
  person text := case when number is null then lower(nullif(trim(p_person), '')) end;
  requests boolean := p_status = 'withdrawal_requested';
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
           end,
           r.submitted_at, r.processed_at, r.comment
    from public.orders o
    left join public.profiles pr on pr.id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.profiles s on s.id = o.created_by
    left join public.user_passes p on p.order_id = o.id
    left join public.order_grants g on g.order_id = o.id
    left join public.email_outbox m on m.order_id = o.id and m.kind = 'order_paid'
    left join public.withdrawal_requests r on r.order_id = o.id and r.status = 'new'
    where case when number is not null then o.order_number = number
          when requests then r.order_id is not null
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
