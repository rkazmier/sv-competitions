-- SPEC-012 US-3 (AC-9…AC-14), ADR-0009: e-maile aplikacji — kolejka `email_outbox`, wysyłka przez Edge Function `mail-send`
-- (SMTP), ponowienia `pg_cron` co 10 min, „Wyślij ponownie” w panelu i stan e-maila w `admin_list_orders`.
-- Kolejka nie przechowuje adresu ani treści (§9): adres z `auth.users` i treść z szablonu w chwili wysyłki.

-- ===== email_outbox (§5) =====

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('order_paid', 'event_cancelled', 'withdrawal_received', 'withdrawal_admin')),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 200),
  unique (kind, order_id)
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status = 'pending';

comment on table public.email_outbox is
  'SPEC-012 §5, ADR-0009: kolejka e-maili aplikacji — bez adresu i treści; wysyła Edge Function mail-send';

-- §5 RLS: brak bezpośredniego dostępu klientów; odczyt stanu przez `admin_list_orders`.
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ===== Wpis order_paid (AC-9, AC-13) =====

-- Zamówienie Tpay z wersją regulaminu przechodzi `pending`/`cancelled` → `paid` (`fulfil_order` w `process_tpay_notification`)
-- → wpis `order_paid` w tej samej transakcji. Unikalne `(kind, order_id)` — powtórzone powiadomienie nie tworzy drugiego.
-- Na miejscu i prezent (AC-13) oraz zamówienia bez `terms_version` (§7 — brak PDF) — bez wpisu.
-- `refund_pending` → `paid` (`revert_order_refund`) nie jest realizacją zamówienia — bez wpisu.
create function public.orders_after_paid_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status in ('pending', 'cancelled')
     and new.payment_method = 'tpay' and new.terms_version is not null then
    insert into public.email_outbox (kind, order_id) values ('order_paid', new.id)
      on conflict (kind, order_id) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_after_paid_email() from public, anon, authenticated;

create trigger orders_after_paid_email
  after update of status on public.orders
  for each row execute function public.orders_after_paid_email();

-- ===== Wysyłka (Edge Function `mail-send`, klucz secret) =====

-- Czas zarezerwowania wpisu na jedną wysyłkę: przerwana funkcja nie blokuje wpisu dłużej (bez zwiększania licznika).
create function public.mail_claim_lease()
returns interval
language sql immutable set search_path = ''
as $$ select interval '15 minutes' $$;

-- Wpisy do wysłania (najstarsze pierwsze) z danymi do szablonu i adresem z `auth.users` w chwili wysyłki (AC-10).
-- AC-12: wpis zamówienia bez konta (`user_id = null`) → `skipped`, nie jest zwracany.
-- `for update skip locked` + przesunięcie `next_attempt_at` — równoległe wywołania nie wyślą tego samego wpisu.
create function public.mail_outbox_claim(p_limit integer default 20)
returns table (
  id uuid, kind text, attempts integer, order_id uuid, order_number text, item_name text, amount integer,
  paid_at timestamptz, terms_version date, early_performance_consent_at timestamptz, pass_kind text, expires_on date,
  event_starts_on date, event_ends_on date, email text
)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.email_outbox e set status = 'skipped', next_attempt_at = null
    from public.orders o
   where o.id = e.order_id and e.status = 'pending' and o.user_id is null;

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
           u.email::text
      from claimed c
      join public.orders o on o.id = c.order_id
      left join auth.users u on u.id = o.user_id
      left join public.user_passes p on p.order_id = o.id
      left join public.calendar_events ev on ev.id = o.calendar_event_id
     order by c.next_attempt_at, c.id;
end;
$$;
revoke execute on function public.mail_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.mail_outbox_claim(integer) to service_role;

-- AC-11: odstęp po kolejnych nieudanych próbach: 10 min, 30 min, 1 h, 3 h; po 5. próbie — `failed`.
create function public.mail_retry_delay(p_attempts integer)
returns interval
language sql immutable set search_path = ''
as $$
  select case p_attempts when 1 then interval '10 minutes' when 2 then interval '30 minutes'
                         when 3 then interval '1 hour' when 4 then interval '3 hours' end;
$$;

create function public.mail_max_attempts()
returns integer
language sql immutable set search_path = ''
as $$ select 5 $$;

-- Wynik wysyłki wpisu: `p_error = null` → `sent`; inaczej licznik +1, kolejna próba albo `failed` (AC-11).
-- `p_error` to kod błędu (bez adresu i treści), przycinany do 200 znaków. Zwraca nowy stan.
create function public.mail_outbox_result(p_id uuid, p_error text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  e public.email_outbox;
begin
  select * into e from public.email_outbox where id = p_id for update;
  if not found then
    raise exception 'email_not_found' using errcode = 'P0002';
  end if;
  if e.status <> 'pending' then
    return e.status;
  end if;
  if p_error is null then
    update public.email_outbox
       set status = 'sent', sent_at = now(), attempts = e.attempts + 1, next_attempt_at = null, last_error = null
     where id = p_id;
    return 'sent';
  end if;
  if e.attempts + 1 >= public.mail_max_attempts() then
    update public.email_outbox
       set status = 'failed', attempts = e.attempts + 1, next_attempt_at = null, last_error = left(p_error, 200)
     where id = p_id;
    return 'failed';
  end if;
  update public.email_outbox
     set attempts = e.attempts + 1, next_attempt_at = now() + public.mail_retry_delay(e.attempts + 1),
         last_error = left(p_error, 200)
   where id = p_id;
  return 'pending';
end;
$$;
revoke execute on function public.mail_outbox_result(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_outbox_result(uuid, text) to service_role;

-- ===== Wywołanie `mail-send` (pg_net, ADR-0006) =====

-- URL projektu i sekret z Vault (`project_url`, `mail_invoke_secret` — ten sam co `MAIL_INVOKE_SECRET` funkcji).
-- Bez sekretów (lokalnie, CI) — tylko komunikat, bez błędu. Żądanie `pg_net` wychodzi po zatwierdzeniu transakcji.
create function public.invoke_mail_send()
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'mail_invoke_secret';
  if base_url is null or secret is null then
    raise notice 'mail-send: brak sekretów project_url / mail_invoke_secret w Vault';
    return null;
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/mail-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.invoke_mail_send() from public, anon, authenticated;

-- AC-11: ponowienia co 10 min (UTC).
select cron.schedule('mail-send-retry', '*/10 * * * *', 'select public.invoke_mail_send()');

-- ===== „Wyślij ponownie” (AC-11) =====

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked', 'range_officer_review',
                    'pass_grant', 'pass_grant_cancel', 'email_resend'));

-- Tylko admin. Wpis `failed` → `pending`, licznik od zera, `audit_log` `email_resend`, wysyłka od razu (`pg_net`).
create function public.admin_resend_email(p_order_id uuid, p_kind text default 'order_paid')
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  e public.email_outbox;
  o public.orders;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into e from public.email_outbox where order_id = p_order_id and kind = p_kind for update;
  if not found then
    raise exception 'email_not_found' using errcode = 'P0002';
  end if;
  if e.status <> 'failed' then
    raise exception 'email_not_failed' using errcode = '22023';
  end if;
  update public.email_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
   where id = e.id;
  select * into o from public.orders where id = p_order_id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), o.user_id, 'email_resend',
            jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'kind', e.kind));
  perform public.invoke_mail_send();
end;
$$;
revoke execute on function public.admin_resend_email(uuid, text) from public, anon;
grant execute on function public.admin_resend_email(uuid, text) to authenticated;

-- ===== admin_list_orders (AC-11, AC-14) =====

-- Wynik + `email_status`, `email_sent_at` (wpis `order_paid`; `null` — brak e-maila). Treść jak w 20261123100000_sales_terms_consent.sql.
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
  email_status text, email_sent_at timestamptz
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
           o.terms_version, o.early_performance_consent_at, m.status, m.sent_at
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
