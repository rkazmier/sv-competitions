-- SPEC-004 §8: limit 20 zapytań `company-lookup` na konto na godzinę (`company_lookup_take_quota`).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000023c1', 'lookup1@example.test'),
  ('00000000-0000-0000-0000-0000000023c2', 'lookup2@example.test');

-- Stare zapytanie (sprzed ponad godziny) konta c1 — nie wlicza się do limitu i jest sprzątane.
insert into public.company_lookup_requests (user_id, requested_at) values
  ('00000000-0000-0000-0000-0000000023c1', now() - interval '61 minutes');

select is(
  (select relrowsecurity from pg_class where oid = 'public.company_lookup_requests'::regclass), true,
  '§8: RLS włączone na company_lookup_requests'
);

-- Anonim nie może wywołać funkcji.
set local role anon;
select throws_ok('select public.company_lookup_take_quota()', '42501', null, '§8: anon nie ma dostępu do limitu');
reset role;

-- Zalogowany bez `sub` — odmowa.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok('select public.company_lookup_take_quota()', '28000', 'not_authenticated', '§8: bez konta — not_authenticated');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023c1","role":"authenticated"}', true);
select is(
  (select count(*) from generate_series(1, 20) where public.company_lookup_take_quota())::integer, 20,
  '§8: 20 zapytań w godzinie mieści się w limicie'
);
select is(public.company_lookup_take_quota(), false, '§8: 21. zapytanie w godzinie — limit wyczerpany');
select throws_ok('select * from public.company_lookup_requests', '42501', null, '§8: tabela niedostępna bezpośrednio');

-- Inne konto ma własny limit.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023c2","role":"authenticated"}', true);
select is(public.company_lookup_take_quota(), true, '§8: limit liczony osobno dla każdego konta');
reset role;

select is(
  (select count(*) from public.company_lookup_requests where requested_at < now() - interval '1 hour')::integer, 0,
  '§8: zapytania starsze niż godzina są usuwane'
);

-- Po godzinie limit się odnawia.
update public.company_lookup_requests set requested_at = now() - interval '61 minutes'
  where user_id = '00000000-0000-0000-0000-0000000023c1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.company_lookup_take_quota(), true, '§8: po godzinie limit się odnawia');
reset role;

select * from finish();
rollback;
