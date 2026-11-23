-- SPEC-012 US-6 (AC-30…AC-34): zamknięcie strzelnicy dłuższe niż 7 kolejnych dni → przedłużenie `expires_on`
-- uprawnień aktywnych w tym okresie o liczbę dni zamknięcia (§ 4 ust. 10 regulaminu sprzedaży).
-- Zamknięcie admin wpisuje po jego zakończeniu; bez edycji, usuwania i cofania (§2, §10 założenie 4).
-- `valid_until` aktywowanego karnetu czasowego się nie zmienia (7-A).

-- ===== Tabele (§5) =====

create table public.range_closures (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  reason text not null check (char_length(reason) between 3 and 200 and reason = trim(reason)),
  days integer not null,
  passes_count integer not null default 0 check (passes_count >= 0),
  -- Tylko `add_range_closure` (zawsze z kontem admina); `set null` — wpis przetrwa usunięcie konta admina.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint range_closures_days check (days = ends_on - starts_on + 1),
  constraint range_closures_min_days check (days >= 8),
  constraint range_closures_no_overlap exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);

comment on table public.range_closures is
  'SPEC-012 US-6: zamknięcia strzelnicy > 7 dni; zapis wyłącznie przez add_range_closure, bez edycji i usuwania';
comment on column public.range_closures.reason is 'Przyczyna, 3–200 znaków, tylko dla admina (może zawierać dane osobowe — §9)';
comment on column public.range_closures.passes_count is 'Liczba przedłużonych uprawnień';

create table public.range_closure_passes (
  closure_id uuid not null references public.range_closures (id) on delete restrict,
  user_pass_id uuid not null references public.user_passes (id) on delete cascade,
  expires_on_before date not null,
  primary key (closure_id, user_pass_id)
);
create index range_closure_passes_pass_idx on public.range_closure_passes (user_pass_id);

comment on table public.range_closure_passes is 'SPEC-012 AC-32: ślad przedłużenia (expires_on przed zamknięciem)';

-- §5 RLS: `range_closures` — odczyt admin, zapis tylko funkcją; `range_closure_passes` — bez dostępu klientów.
alter table public.range_closures enable row level security;
alter table public.range_closure_passes enable row level security;
revoke all on public.range_closures, public.range_closure_passes from anon, authenticated;
grant select on public.range_closures to authenticated;
create policy range_closures_admin_select on public.range_closures for select to authenticated using (public.is_admin());

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('profile_update', 'role_change', 'account_delete', 'order_refund', 'pass_usage_revert',
                    'range_log_export', 'invoice_issued', 'invoice_unmarked', 'range_officer_review',
                    'pass_grant', 'pass_grant_cancel', 'email_resend', 'event_cancel', 'range_closure'));

-- ===== Funkcje (AC-30…AC-33) =====

-- AC-32: uprawnienia przedłużane zamknięciem [from, to] — aktywne, z kontem, bez wejściówek,
-- kupione nie później niż „Do” (dzień zakupu w Europe/Warsaw), `expires_on ≥ Od`.
create function public.range_closure_eligible_passes(p_from date, p_to date)
returns setof public.user_passes
language sql stable security definer set search_path = ''
as $$
  select p.* from public.user_passes p
   where p.status = 'active'
     and p.user_id is not null
     and p.kind <> 'event_ticket'
     and (p.created_at at time zone 'Europe/Warsaw')::date <= p_to
     and p.expires_on >= p_from;
$$;
revoke execute on function public.range_closure_eligible_passes(date, date) from public, anon, authenticated;

-- AC-30, AC-31: walidacja okresu (admin). Kody: `invalid_closure_range` (brak dat, Od > Do),
-- `closure_not_ended` (Do po dziś), `closure_too_short` (< 8 dni), `closure_overlap`.
create function public.range_closure_check(p_from date, p_to date)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid_closure_range' using errcode = '22023';
  end if;
  if p_to > public.range_today() then
    raise exception 'closure_not_ended' using errcode = 'P0001';
  end if;
  if p_to - p_from + 1 < 8 then
    raise exception 'closure_too_short' using errcode = 'P0001',
      hint = 'Przedłużenie przysługuje przy zamknięciu dłuższym niż 7 kolejnych dni.';
  end if;
  if exists (select 1 from public.range_closures c
              where daterange(c.starts_on, c.ends_on, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'closure_overlap' using errcode = 'P0001', hint = 'Ten okres nakłada się na zapisane zamknięcie.';
  end if;
  return p_to - p_from + 1;
end;
$$;
revoke execute on function public.range_closure_check(date, date) from public, anon, authenticated;

-- AC-30: podgląd przed zapisem — liczba dni i liczba uprawnień do przedłużenia.
create function public.range_closure_preview(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  n integer := public.range_closure_check(p_from, p_to);
begin
  return jsonb_build_object('days', n,
    'passes_count', (select count(*) from public.range_closure_eligible_passes(p_from, p_to)));
end;
$$;

-- AC-32: w jednej transakcji — zamknięcie, `expires_on += N`, ślad w `range_closure_passes`, jeden wpis `audit_log`.
create function public.add_range_closure(p_from date, p_to date, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_reason text := trim(p_reason);
  n integer;
  closure_id uuid;
  extended integer;
begin
  n := public.range_closure_check(p_from, p_to);
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'invalid_closure_reason' using errcode = '22023';
  end if;
  -- Równoległe zapisy: wyścig rozstrzyga `range_closures_no_overlap` (23P01 → `closure_overlap`).
  begin
    insert into public.range_closures (starts_on, ends_on, reason, days, created_by)
      values (p_from, p_to, v_reason, n, auth.uid())
      returning id into closure_id;
  exception when exclusion_violation then
    raise exception 'closure_overlap' using errcode = 'P0001', hint = 'Ten okres nakłada się na zapisane zamknięcie.';
  end;

  with eligible as (
    select id, expires_on from public.user_passes
     where id in (select e.id from public.range_closure_eligible_passes(p_from, p_to) e)
     for update
  ), trail as (
    insert into public.range_closure_passes (closure_id, user_pass_id, expires_on_before)
      select closure_id, id, expires_on from eligible
      returning user_pass_id
  )
  update public.user_passes p set expires_on = p.expires_on + n
    from trail where p.id = trail.user_pass_id;
  get diagnostics extended = row_count;

  update public.range_closures set passes_count = extended where id = closure_id;
  insert into public.audit_log (actor_id, target_user_id, action, changes)
    values (auth.uid(), null, 'range_closure',
            jsonb_build_object('closure_id', closure_id, 'starts_on', p_from, 'ends_on', p_to, 'days', n,
                               'passes_count', extended));
  return jsonb_build_object('id', closure_id, 'days', n, 'passes_count', extended);
end;
$$;

-- AC-33: przedłużenia własnych uprawnień (dane `/konto/`).
create function public.my_pass_extensions()
returns table (user_pass_id uuid, days integer, starts_on date, ends_on date)
language sql stable security definer set search_path = ''
as $$
  select cp.user_pass_id, c.days, c.starts_on, c.ends_on
    from public.range_closure_passes cp
    join public.range_closures c on c.id = cp.closure_id
    join public.user_passes p on p.id = cp.user_pass_id
   where p.user_id = auth.uid()
   order by c.starts_on;
$$;

revoke execute on function public.range_closure_preview(date, date), public.add_range_closure(date, date, text),
  public.my_pass_extensions() from public, anon;
grant execute on function public.range_closure_preview(date, date), public.add_range_closure(date, date, text),
  public.my_pass_extensions() to authenticated;
