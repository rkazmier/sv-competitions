-- SPEC-005 US-9 (AC-26, AC-29): przegląd książki przez admina — filtry, kolumny, adnotacje, `range_log_export`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test');
update public.profiles set role = 'admin', full_name = 'Anna Admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.range_officers (id, full_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Piotr Prowadzący'),
  ('00000000-0000-0000-0000-0000000000d2', 'Ewa Prowadząca');

-- Wpisy z różnych dni (stan „z przeszłości” wstawiony z pominięciem funkcji zapisu — tylko dla testu).
insert into public.range_log (id, entered_at, full_name, permit_number, permit_authority, address, range_officer_name,
                              range_officer_id, signature_path, is_companion) values
  ('50000000-0000-0000-0000-000000000001', '2026-03-10 22:30+00', 'Jan Kowalski', 'AB/123', 'KWP Katowice', null,
   'Piotr Prowadzący', '00000000-0000-0000-0000-0000000000d1', '2026/03/50000000-0000-0000-0000-000000000001.png', false),
  ('50000000-0000-0000-0000-000000000002', '2026-03-10 23:30+00', 'Ewa Nowak', null, null, 'ul. Polna 1, Gliwice',
   'Ewa Prowadząca', '00000000-0000-0000-0000-0000000000d2', '2026/03/50000000-0000-0000-0000-000000000002.png', true),
  ('50000000-0000-0000-0000-000000000003', '2026-03-12 10:00+00', 'Jan Kowalski', null, null, 'ul. Stalowa 2, Gliwice',
   'Ewa Prowadząca', '00000000-0000-0000-0000-0000000000d2', '2026/03/50000000-0000-0000-0000-000000000003.png', false);
insert into public.range_log_annotations (entry_id, body, created_by, created_at) values
  ('50000000-0000-0000-0000-000000000001', 'Druga adnotacja', '00000000-0000-0000-0000-0000000000a1', '2026-03-11 10:00+00'),
  ('50000000-0000-0000-0000-000000000001', 'Literówka w numerze', '00000000-0000-0000-0000-0000000000b1', '2026-03-10 10:00+00');

-- ===== Tylko admin =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_range_log('view')$$, '42501', 'forbidden', 'AC-26: obsługa nie przegląda książki');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_range_log('xlsx')$$, '22023', 'invalid_format', 'AC-29: tylko view, pdf, csv');

-- ===== Filtry (AC-26) =====
-- 2026-03-10 22:30 UTC = 10.03 23:30 w Warszawie; 2026-03-10 23:30 UTC = 11.03 00:30.
select results_eq(
  $$select id from public.admin_range_log('view', '2026-03-10', '2026-03-10')$$,
  $$values ('50000000-0000-0000-0000-000000000001'::uuid)$$,
  'AC-26: zakres dat liczony w Europe/Warsaw');
select results_eq(
  $$select id from public.admin_range_log('view', '2026-03-10', '2026-03-12')$$,
  $$values ('50000000-0000-0000-0000-000000000001'::uuid), ('50000000-0000-0000-0000-000000000002'), ('50000000-0000-0000-0000-000000000003')$$,
  'AC-26: od najstarszego wpisu, z osobami towarzyszącymi');
select results_eq(
  $$select id from public.admin_range_log('view', p_person => 'kowal')$$,
  $$values ('50000000-0000-0000-0000-000000000001'::uuid), ('50000000-0000-0000-0000-000000000003')$$,
  'AC-26: filtr imienia i nazwiska (fragment, bez wielkości liter)');
select is_empty($$select id from public.admin_range_log('view', p_person => '%')$$,
  'AC-26: znaki wzorca w filtrze traktowane dosłownie');
select results_eq(
  $$select id from public.admin_range_log('view', p_officer_id => '00000000-0000-0000-0000-0000000000d2')$$,
  $$values ('50000000-0000-0000-0000-000000000002'::uuid), ('50000000-0000-0000-0000-000000000003')$$,
  'AC-26: filtr prowadzącego');

-- ===== Kolumny i adnotacje =====
select results_eq(
  $$select full_name, permit_number, permit_authority, address, range_officer_name, signature_path
    from public.admin_range_log('csv', '2026-03-10', '2026-03-10')$$,
  $$values ('Jan Kowalski', 'AB/123', 'KWP Katowice', null::text, 'Piotr Prowadzący',
            '2026/03/50000000-0000-0000-0000-000000000001.png')$$,
  'AC-26: kolumny książki (kopie danych z wpisu)');
select is(
  (select annotations from public.admin_range_log('pdf', '2026-03-10', '2026-03-10')),
  '[{"body": "Literówka w numerze", "author": null, "created_at": "2026-03-10T10:00:00+00:00"},
    {"body": "Druga adnotacja", "author": "Anna Admin", "created_at": "2026-03-11T10:00:00+00:00"}]'::jsonb,
  'AC-26: adnotacje pod wpisem — autor, czas, treść, od najstarszej');
select is(
  (select array_agg(p.name::text order by p.ordinality)
     from pg_proc f, unnest(f.proargnames) with ordinality p(name, ordinality)
     where f.oid = 'public.admin_range_log(text, date, date, text, uuid)'::regprocedure and p.ordinality > 5),
  array['id', 'entered_at', 'full_name', 'permit_number', 'permit_authority', 'address', 'range_officer_name',
        'signature_path', 'annotations'],
  'AC-26: bez kolumn technicznych (profile_id, is_companion, created_by)');
reset role;

-- ===== audit_log (AC-29) =====
select is((select count(*)::integer from public.audit_log where action = 'range_log_export'), 7,
  'AC-29: każde wyświetlenie i eksport zapisuje range_log_export');
select is(
  (select changes from public.audit_log where action = 'range_log_export' order by id desc limit 1),
  '{"format": "pdf", "from": "2026-03-10", "to": "2026-03-10", "entries": 1}'::jsonb,
  'AC-29: zakres i format, bez danych osób');
select is(
  (select actor_id from public.audit_log where action = 'range_log_export' order by id desc limit 1),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'AC-29: zapisany admin');
select is(
  (select count(*)::integer from public.audit_log where action = 'range_log_export' and changes::text ilike '%kowal%'), 0,
  'AC-29: filtr nazwiska nie trafia do dziennika');

select * from finish();
rollback;
