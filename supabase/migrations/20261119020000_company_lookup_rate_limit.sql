-- SPEC-004 §8: limit 20 zapytań `company-lookup` na konto na godzinę.
-- Tabela przechowuje tylko konto i czas zapytania (bez NIP-u). Wiersze starsze niż godzina są usuwane przy każdym
-- wywołaniu `company_lookup_take_quota()`, więc tabela nie rośnie.

create table public.company_lookup_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index company_lookup_requests_user_idx on public.company_lookup_requests (user_id, requested_at);
create index company_lookup_requests_time_idx on public.company_lookup_requests (requested_at);

-- RLS bez polityk: dostęp wyłącznie przez funkcję `security definer` poniżej.
alter table public.company_lookup_requests enable row level security;
revoke all on public.company_lookup_requests from anon, authenticated;

-- Zużywa jedno zapytanie z limitu zalogowanego konta. Zwraca `true`, gdy zapytanie mieści się w limicie
-- (i je zapisuje), `false`, gdy limit 20/h jest wyczerpany. Bez zalogowania — `28000 not_authenticated`.
create function public.company_lookup_take_quota()
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Równoległe zapytania tego samego konta czekają na siebie, więc limit nie przecieka.
  perform pg_advisory_xact_lock(hashtextextended('company_lookup:' || v_user::text, 0));

  delete from public.company_lookup_requests where requested_at < now() - interval '1 hour';

  select count(*) into v_count from public.company_lookup_requests where user_id = v_user;
  if v_count >= 20 then
    return false;
  end if;

  insert into public.company_lookup_requests (user_id) values (v_user);
  return true;
end;
$$;

revoke execute on function public.company_lookup_take_quota() from public, anon;
grant execute on function public.company_lookup_take_quota() to authenticated;
