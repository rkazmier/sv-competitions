-- SPEC-012 US-5 (AC-23…AC-29, AC-51): odwołanie wydarzenia — oznaczenie „Odwołane” z publicznym powodem, anulowanie
-- wejściówek, zwroty (Tpay — Edge Function `event-cancel` partiami, na miejscu — lista do zwrotu), e-mail `event_cancelled`
-- do kupujących z kontem, blokada edycji odwołanego wydarzenia. Odwołane wydarzenie nie blokuje karnetów (AC-41).

-- ===== Kolumny (§5) =====

alter table public.calendar_events
  add column cancelled_at timestamptz,
  add column cancel_reason text check (char_length(trim(cancel_reason)) between 3 and 200),
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  add constraint calendar_events_cancel_reason check ((cancelled_at is null) = (cancel_reason is null));

comment on column public.calendar_events.cancelled_at is 'SPEC-012 US-5: odwołanie wydarzenia (nieodwracalne)';
comment on column public.calendar_events.cancel_reason is 'SPEC-012 AC-23: powód odwołania, publiczny (3–200 znaków)';
comment on column public.calendar_events.cancelled_by is 'SPEC-012 §5: kto odwołał — niepubliczne (jak created_by)';

-- §5 RLS: `cancelled_by` bez odczytu publicznego (uprawnienia kolumnowe jak `created_by`).
grant select (cancelled_at, cancel_reason) on public.calendar_events to anon, authenticated;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked', 'range_officer_review',
                    'pass_grant', 'pass_grant_cancel', 'email_resend', 'event_cancel'));

-- ===== Blokada edycji odwołanego (AC-29) =====

-- `cancelled_at` / `cancelled_by` ustawia wyłącznie `cancel_calendar_event` (flaga transakcji `app.event_cancel`).
-- Odwołanego wydarzenia nie da się usunąć; zmienić można tylko opis i powód odwołania.
create function public.calendar_events_cancel_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.cancelled_at is not null then
      raise exception 'event_cancelled' using errcode = 'P0001', hint = 'Wydarzenie zostało odwołane.';
    end if;
    return old;
  end if;
  if (new.cancelled_at, new.cancelled_by) is distinct from (old.cancelled_at, old.cancelled_by)
     and coalesce(current_setting('app.event_cancel', true), '') <> 'on' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if old.cancelled_at is not null
     and to_jsonb(new) - array['description', 'cancel_reason', 'updated_at']
         is distinct from to_jsonb(old) - array['description', 'cancel_reason', 'updated_at'] then
    raise exception 'event_cancelled' using errcode = 'P0001', hint = 'Wydarzenie zostało odwołane.';
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_events_cancel_guard() from public, anon, authenticated;
create trigger calendar_events_cancel_guard before update or delete on public.calendar_events
  for each row execute function public.calendar_events_cancel_guard();

-- ===== Sprzedaż i ważność (AC-25, AC-28, AC-51) =====

-- AC-25: `create_tpay_order`, `create_on_site_order` i `grant_pass` tworzą zamówienie przez `insert` — wejściówka na
-- odwołane wydarzenie jest odrzucana (`event_cancelled`). Wpłata za istniejące zamówienie (AC-28) to `update` — przechodzi.
create function public.orders_reject_cancelled_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.calendar_event_id is not null and exists (
       select 1 from public.calendar_events e where e.id = new.calendar_event_id and e.cancelled_at is not null) then
    raise exception 'event_cancelled' using errcode = 'P0001', hint = 'Wydarzenie zostało odwołane.';
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_reject_cancelled_event() from public, anon, authenticated;
create trigger orders_before_insert_cancelled_event before insert on public.orders
  for each row execute function public.orders_reject_cancelled_event();

-- AC-28, AC-51: wejściówka odwołanego wydarzenia jest zawsze `cancelled` — także nowa (wpłata po odwołaniu,
-- `fulfil_order`) i po nieudanym zwrocie (`revert_order_refund` nie przywraca `active`).
create function public.user_passes_cancelled_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'event_ticket' and new.status <> 'cancelled' and exists (
       select 1 from public.calendar_events e where e.id = new.calendar_event_id and e.cancelled_at is not null) then
    new.status := 'cancelled';
  end if;
  return new;
end;
$$;
revoke execute on function public.user_passes_cancelled_event() from public, anon, authenticated;
create trigger user_passes_cancelled_event before insert or update on public.user_passes
  for each row execute function public.user_passes_cancelled_event();

-- Jak w 20261126100000_pass_blocking.sql + odwołane wydarzenie nie blokuje karnetów (AC-25, założenie 2).
create or replace function public.range_blocked_on(p_date date)
returns table (kind text, id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select 'competition', c.id, c.name from public.competitions c
    where c.status = 'published' and c.blocks_passes
      and p_date between c.starts_on and coalesce(c.ends_on, c.starts_on)
  union all
  select 'event', e.id, e.name from public.calendar_events e
    where e.status = 'published' and e.blocks_passes and e.cancelled_at is null
      and p_date between e.starts_on and coalesce(e.ends_on, e.starts_on)
  order by 3, 2;
$$;

-- Jak w 20261126100000_pass_blocking.sql + wejściówka odwołanego wydarzenia nieważna niezależnie od stanu (AC-25, AC-51).
create or replace function public.pass_valid_on(p public.user_passes, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p.status = 'active'
    and (p.kind = 'event_ticket' or not exists (select 1 from public.range_blocked_on(p_date)))
    and case p.kind
      when 'days' then
        case when p.first_used_on is null then p_date <= p.expires_on
             else p_date between p.first_used_on and p.valid_until end
      when 'single_entry' then
        p_date <= p.expires_on and (extract(isodow from p_date) in (6, 7)) = (p.day_type = 'weekend')
      when 'event_ticket' then
        p_date <= p.expires_on and coalesce((select p_date between e.starts_on and p.valid_until and e.cancelled_at is null
                                              from public.calendar_events e where e.id = p.calendar_event_id), false)
      else p_date <= p.expires_on
    end;
$$;

-- ===== cancel_calendar_event (AC-23, AC-24, AC-29) =====

-- Tylko admin. Opublikowane, nieodwołane wydarzenie, którego ostatni dzień nie minął (Europe/Warsaw); powód 3–200 znaków.
-- W jednej transakcji: oznaczenie; zamówienia `cancelled` / `refund_pending` / `refunded` — bez zmian; `pending` → `cancelled`;
-- `paid` Tpay → `refund_pending` (pełna kwota, `refund_requested_at = null` — zwrot zleca `event-cancel`); `paid` na miejscu →
-- `refunded` z adnotacją; `paid` prezent → `cancelled`; wszystkie wejściówki → `cancelled`; `email_outbox` `event_cancelled`
-- dla opłaconych zamówień z kontem (niezapłacone `pending` nie dostają e-maila o zwrocie); `audit_log` `event_cancel`
-- i `order_refund` dla każdego zwrotu. Wysyłka e-maili (`pg_net`) po zatwierdzeniu. Zwraca liczby i sumę zwrotów.
create function public.cancel_calendar_event(p_event_id uuid, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  ev public.calendar_events;
  v_reason text := trim(p_reason);
  o public.orders;
  online integer := 0;
  on_site integer := 0;
  gifts integer := 0;
  unpaid integer := 0;
  emails integer := 0;
  refund_total integer := 0;
  summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'invalid_cancel_reason' using errcode = '22023';
  end if;
  select * into ev from public.calendar_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null then
    raise exception 'event_already_cancelled' using errcode = 'P0001';
  end if;
  if ev.status <> 'published' then
    raise exception 'event_not_published' using errcode = 'P0001';
  end if;
  if public.range_today() > coalesce(ev.ends_on, ev.starts_on) then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;

  perform set_config('app.event_cancel', 'on', true);
  update public.calendar_events
     set cancelled_at = now(), cancel_reason = v_reason, cancelled_by = auth.uid()
   where id = ev.id;
  perform set_config('app.event_cancel', '', true);

  for o in select * from public.orders where calendar_event_id = ev.id and status in ('pending', 'paid')
           order by created_at for update loop
    if o.status = 'pending' then
      update public.orders set status = 'cancelled' where id = o.id;
      unpaid := unpaid + 1;
      continue;
    end if;
    if o.payment_method = 'tpay' then
      update public.orders
         set status = 'refund_pending', refund_amount = o.amount, refund_requested_at = null, refund_note = null
       where id = o.id;
      online := online + 1;
    elsif o.payment_method = 'on_site' then
      update public.orders
         set status = 'refunded', refunded_at = now(), refund_amount = o.amount,
             refund_note = 'Zwrot gotówki / na terminal — odwołanie wydarzenia'
       where id = o.id;
      on_site := on_site + 1;
    else
      update public.orders set status = 'cancelled' where id = o.id;
      gifts := gifts + 1;
    end if;
    if o.payment_method in ('tpay', 'on_site') then
      refund_total := refund_total + o.amount;
      insert into public.audit_log (actor_id, target_user_id, action, changes)
        values (auth.uid(), o.user_id, 'order_refund',
                jsonb_build_object('order_id', o.id, 'reason', 'event_cancel', 'amount', o.amount,
                                   'refund_amount', o.amount,
                                   'status', jsonb_build_array('paid',
                                     case o.payment_method when 'tpay' then 'refund_pending' else 'refunded' end)));
    end if;
    if o.user_id is not null then
      insert into public.email_outbox (kind, order_id) values ('event_cancelled', o.id)
        on conflict (kind, order_id) do nothing;
      emails := emails + 1;
    end if;
  end loop;
  update public.user_passes set status = 'cancelled' where calendar_event_id = ev.id and status <> 'cancelled';

  summary := jsonb_build_object('event_id', ev.id, 'online', online, 'on_site', on_site, 'gifts', gifts,
                                'unpaid', unpaid, 'emails', emails, 'refund_total', refund_total);
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), null, 'event_cancel', summary || jsonb_build_object('name', ev.name, 'reason', v_reason));
  if emails > 0 then
    perform public.invoke_mail_send();
  end if;
  return summary;
end;
$$;
revoke execute on function public.cancel_calendar_event(uuid, text) from public, anon;
grant execute on function public.cancel_calendar_event(uuid, text) to authenticated;

-- ===== Zwroty Tpay po odwołaniu (Edge Function `event-cancel`, klucz secret; §7) =====

-- Jedno zamówienie odwołanego wydarzenia czekające na zlecenie zwrotu (`refund_pending`, `refund_requested_at is null`)
-- → `refund_requested_at = now()` przed wywołaniem Tpay. Po jednym: przerwana funkcja zostawia najwyżej jedno zamówienie
-- w stanie „zlecone” bez odpowiedzi Tpay (bez ryzyka podwójnego zwrotu). `skip locked` — równoległe wywołania.
create function public.event_refund_claim()
returns table (id uuid, tpay_transaction_id text, amount integer)
language sql volatile security definer set search_path = ''
as $$
  with next as (
    select o.id from public.orders o
      join public.calendar_events e on e.id = o.calendar_event_id and e.cancelled_at is not null
     where o.status = 'refund_pending' and o.payment_method = 'tpay' and o.refund_requested_at is null
     order by o.created_at, o.id
     limit 1
     for update of o skip locked
  )
  update public.orders o set refund_requested_at = now()
    from next where o.id = next.id
  returning o.id, o.tpay_transaction_id, o.amount;
$$;
revoke execute on function public.event_refund_claim() from public, anon, authenticated;
grant execute on function public.event_refund_claim() to service_role;

-- `pg_net` → `event-cancel` (dokończenie zwrotów) z sekretem `mail_invoke_secret` z Vault; tylko gdy są niewysłane zwroty.
create function public.invoke_event_refunds()
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  if not exists (select 1 from public.orders o
                   join public.calendar_events e on e.id = o.calendar_event_id and e.cancelled_at is not null
                  where o.status = 'refund_pending' and o.payment_method = 'tpay' and o.refund_requested_at is null) then
    return null;
  end if;
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'mail_invoke_secret';
  if base_url is null or secret is null then
    raise notice 'event-cancel: brak sekretów project_url / mail_invoke_secret w Vault';
    return null;
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/event-cancel',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.invoke_event_refunds() from public, anon, authenticated;

-- §7: to samo zadanie co ponowienia e-maili (co 10 min) dokańcza zwroty po odwołaniu (ta sama nazwa — aktualizacja).
select cron.schedule('mail-send-retry', '*/10 * * * *',
                     'select public.invoke_mail_send(); select public.invoke_event_refunds();');

-- ===== cancel_order — „Ponów zwrot” (AC-26, AC-51) =====

-- Zmiana względem 20261125100000_order_withdrawal.sql: wejściówka odwołanego wydarzenia — zwrot pełnej kwoty bez
-- sprawdzania zużycia (SPEC-003 AC-26 nie obowiązuje), uprawnienie zostaje `cancelled`, `audit_log` z `reason: event_cancel`.
create or replace function public.cancel_order(p_order_id uuid, p_refund_note text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  o public.orders;
  pass_id uuid;
  note text := nullif(trim(p_refund_note), '');
  event_cancelled boolean;
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
  event_cancelled := exists (select 1 from public.calendar_events e
                              where e.id = o.calendar_event_id and e.cancelled_at is not null);
  if o.product_id is not null and public.range_today() > public.withdrawal_last_day(o.paid_at)
     and coalesce(length(note), 0) not between 3 and 300 then
    raise exception 'refund_note_required' using errcode = 'P0001',
      hint = 'Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).';
  end if;
  select p.id into pass_id from public.user_passes p where p.order_id = o.id for update;
  if pass_id is not null and not event_cancelled and public.pass_has_usage(pass_id) then
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
                               'status', jsonb_build_array('paid', o.status))
            || case when event_cancelled then jsonb_build_object('reason', 'event_cancel', 'retry', true)
                    else '{}'::jsonb end);
  return o.status;
end;
$$;

-- ===== admin_event_refunds (AC-26, AC-28, AC-51) =====

-- Lista „Zwroty po odwołaniu” — tylko admin, tylko odwołane wydarzenie: zamówienia Tpay i na miejscu objęte odwołaniem
-- (`paid` — zwrot nieudany albo wpłata po odwołaniu, `refund_pending`, `refunded` od chwili odwołania).
create function public.admin_event_refunds(p_event_id uuid)
returns table (
  order_id uuid, order_number text, person_name text, has_account boolean, payment_method text,
  amount integer, refund_amount integer, status text, refund_requested_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, coalesce(nullif(trim(pr.full_name), ''), u.email::text), o.user_id is not null,
           o.payment_method, o.amount, o.refund_amount, o.status, o.refund_requested_at
      from public.orders o
      join public.calendar_events e on e.id = o.calendar_event_id and e.cancelled_at is not null
      left join public.profiles pr on pr.id = o.user_id
      left join auth.users u on u.id = o.user_id
     where e.id = p_event_id and o.payment_method in ('tpay', 'on_site')
       and (o.status in ('paid', 'refund_pending') or (o.status = 'refunded' and o.refunded_at >= e.cancelled_at))
     order by o.created_at, o.id;
end;
$$;
revoke execute on function public.admin_event_refunds(uuid) from public, anon;
grant execute on function public.admin_event_refunds(uuid) to authenticated;

-- ===== order_paid po odwołaniu (AC-28) =====

-- Wpłata za wejściówkę odwołanego wydarzenia nie dostaje potwierdzenia zakupu — wejściówka jest od razu `cancelled`,
-- a zwrot zleca admin (AC-26). Treść jak w 20261124100000_email_outbox.sql + warunek odwołania.
create or replace function public.orders_after_paid_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status in ('pending', 'cancelled')
     and new.payment_method = 'tpay' and new.terms_version is not null
     and not exists (select 1 from public.calendar_events e
                      where e.id = new.calendar_event_id and e.cancelled_at is not null) then
    insert into public.email_outbox (kind, order_id) values ('order_paid', new.id)
      on conflict (kind, order_id) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_after_paid_email() from public, anon, authenticated;

-- ===== mail_outbox_claim — dane e-maila `event_cancelled` (AC-27) =====

-- Wynik + `payment_method`, `refund_amount`, `event_name`, `cancel_reason`. Treść jak w 20261124100000_email_outbox.sql.
drop function public.mail_outbox_claim(integer);
create function public.mail_outbox_claim(p_limit integer default 20)
returns table (
  id uuid, kind text, attempts integer, order_id uuid, order_number text, item_name text, amount integer,
  paid_at timestamptz, terms_version date, early_performance_consent_at timestamptz, pass_kind text, expires_on date,
  event_starts_on date, event_ends_on date, email text,
  payment_method text, refund_amount integer, event_name text, cancel_reason text
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
           u.email::text, o.payment_method, o.refund_amount, ev.name, ev.cancel_reason
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
