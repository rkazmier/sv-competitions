-- SPEC-007 §5 (#113): uprawnienia prowadzącego z konta — schemat, funkcje użytkownika, zatwierdzanie, RLS, książka.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'anna@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'bez-nazwiska@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Anna Nowak' where id = '00000000-0000-0000-0000-0000000000c1';
insert into public.range_officers (id, full_name) values ('00000000-0000-0000-0000-0000000000d1', 'Piotr Admina');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.officer() returns public.range_officers language sql as $$
  select * from public.range_officers where profile_id = '00000000-0000-0000-0000-0000000000c1';
$$;
-- Wpis osoby towarzyszącej (bez uprawnienia) z podpisem w buckecie, prowadzący p_officer.
create function pg_temp.entry(p_id uuid, p_officer uuid) returns uuid language plpgsql as $$
declare
  path text := to_char(now(), 'YYYY/MM/') || p_id || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('signatures', path);
  return (select e.id from public.create_range_log_entry(p_id, path, p_officer, p_is_companion => true,
    p_full_name => 'Gość Testowy', p_address => 'ul. Polna 1, Gliwice') e);
end;
$$;
grant execute on all functions in schema pg_temp to public;

select is((select row(status, hide_from_others, profile_id)::text from public.range_officers
           where id = '00000000-0000-0000-0000-0000000000d1'),
  row('approved', false, null::uuid)::text, '§5: prowadzący admina — approved, widoczny, bez konta');
select throws_ok($$insert into public.range_officers (full_name, hide_from_others) values ('X Y', true)$$,
  '23514', null, '§5: „Ukryj mnie dla innych” tylko dla zgłoszeń z kont');
select throws_ok($$insert into public.range_officers (full_name, profile_id) values ('Anna Nowak', '00000000-0000-0000-0000-0000000000c1')$$,
  '23514', null, '§5: zgłoszenie z konta wymaga nr legitymacji');

-- ===== Użytkownik: zgłoszenie (AC-3, AC-4, AC-6) =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.save_my_range_officer('1', 'PZSS')$$, 'P0001', 'full_name_required',
  'AC-3: profil bez imienia i nazwiska → full_name_required');
select is((select count(*)::int from public.my_range_officer()), 0, 'AC-1: brak zgłoszenia → my_range_officer pusty');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.save_my_range_officer('12', 'OTHER')$$, '23514', null,
  'AC-2: „Inne” bez nazwy instytucji odrzucone (range_officers_institution_other)');
select throws_ok($$select public.save_my_range_officer(null, 'PZSS')$$, '23514', null,
  'AC-2: brak nr legitymacji odrzucony');
select is((select row(status, license_number, institution, hide_from_others, is_active)::text
           from public.save_my_range_officer(' 123/2024 ', 'PZSS')),
  row('pending', '123/2024', 'PZSS', true, true)::text,
  'AC-4: zgłoszenie pending, ukryte domyślnie, nr legitymacji po trim');
select is((select count(*)::int from public.range_officers), 0, 'RLS: użytkownik nie czyta range_officers bezpośrednio');
select throws_ok($$update public.range_officers set status = 'approved'$$, '42501', null,
  'RLS: użytkownik nie zmienia statusu bezpośrednio');
select lives_ok($$select public.save_my_range_officer('123/2024', 'LOK', null, false)$$,
  'AC-6: ponowny zapis edytuje istniejące zgłoszenie');
reset role;
select is((select count(*)::int from public.range_officers where profile_id = '00000000-0000-0000-0000-0000000000c1'), 1,
  'AC-6: jedno zgłoszenie na konto');
select throws_ok($$insert into public.range_officers (full_name, profile_id, license_number, institution)
  values ('Anna Nowak', '00000000-0000-0000-0000-0000000000c1', '1', 'PZSS')$$, '23505', null,
  'AC-6: profile_id unikalny');
select ok((pg_temp.officer()).submitted_at is not null and (pg_temp.officer()).full_name = 'Anna Nowak',
  'AC-4: submitted_at i imię i nazwisko z profilu');

-- ===== Książka: tylko „na liście” (AC-5) =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(format($$select pg_temp.entry(gen_random_uuid(), %L)$$, (pg_temp.officer()).id),
  'P0001', 'range_officer_inactive', 'AC-5: zgłoszenie pending odrzucone we wpisie');

-- ===== Zatwierdzanie (AC-8, AC-9) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok(format($$select public.review_range_officer(%L, 'approved')$$, (pg_temp.officer()).id),
  '42501', 'forbidden', 'AC-8: użytkownik nie zatwierdza');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(format($$select public.review_range_officer(%L, 'ok')$$, (pg_temp.officer()).id),
  '22023', 'invalid_decision', 'AC-8: decyzja tylko approved / rejected');
select throws_ok($$select public.review_range_officer('00000000-0000-0000-0000-0000000000d1', 'approved')$$,
  'P0001', 'not_pending', 'AC-8: prowadzący admina nie jest zgłoszeniem');
select lives_ok(format($$select public.review_range_officer(%L, 'rejected')$$, (pg_temp.officer()).id),
  'AC-9: Obsługa odrzuca zgłoszenie');
select throws_ok(format($$select pg_temp.entry(gen_random_uuid(), %L)$$, (pg_temp.officer()).id),
  'P0001', 'range_officer_inactive', 'AC-5: zgłoszenie rejected odrzucone we wpisie');
select throws_ok(format($$select public.review_range_officer(%L, 'approved')$$, (pg_temp.officer()).id),
  'P0001', 'not_pending', 'AC-8: tylko zgłoszenie pending');
reset role;
select is((select changes->>'decision' from public.audit_log where action = 'range_officer_review'
           and target_user_id = '00000000-0000-0000-0000-0000000000c1'), 'rejected',
  'AC-9: audit_log range_officer_review z decyzją');

-- ===== Edycja (AC-11, AC-12) =====

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select status from public.my_range_officer()), 'rejected', 'AC-9: użytkownik widzi odrzucenie');
select is((select status from public.save_my_range_officer('123/2024', 'OTHER', 'Klub ABC', false)), 'pending',
  'AC-11: zmiana instytucji → pending');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$select public.review_range_officer(%L, 'approved')$$, (pg_temp.officer()).id),
  'AC-8: admin zatwierdza zgłoszenie');
reset role;
select is((select row(status, reviewed_by)::text from public.range_officers where id = (pg_temp.officer()).id),
  row('approved', '00000000-0000-0000-0000-0000000000a1'::uuid)::text, 'AC-8: approved z reviewed_by');
select ok((pg_temp.officer()).reviewed_at is not null, 'AC-8: reviewed_at zapisane');
select is((select count(*)::int from public.audit_log where action = 'range_officer_review'), 2,
  'AC-8: każda decyzja w audit_log');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select status from public.save_my_range_officer('123/2024', 'OTHER', 'Klub ABC', true)), 'approved',
  'AC-11: zapis bez zmiany nr legitymacji / instytucji nie zmienia statusu');
select lives_ok($$select public.set_my_range_officer_hidden(false)$$, 'AC-12: przełączenie „Ukryj mnie dla innych”');
select is((select row(status, hide_from_others)::text from public.my_range_officer()), row('approved', false)::text,
  'AC-12: zmiana od razu, bez zmiany statusu');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok(format($$select pg_temp.entry('20000000-0000-0000-0000-000000000001', %L)$$, (pg_temp.officer()).id),
  'AC-5: zatwierdzone, aktywne zgłoszenie przyjęte we wpisie');

-- ===== Admin: tylko „Ukryj” / „Przywróć” zgłoszeń z kont (AC-10) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok(format($$update public.range_officers set license_number = '9' where id = %L$$, (pg_temp.officer()).id),
  '42501', 'forbidden', 'AC-10: admin nie edytuje danych zgłoszenia z konta');
select throws_ok($$insert into public.range_officers (full_name, profile_id) values ('X Y', '00000000-0000-0000-0000-0000000000c2')$$,
  '42501', null, 'AC-10: admin nie tworzy zgłoszeń z kont');
select lives_ok(format($$update public.range_officers set is_active = false where id = %L$$, (pg_temp.officer()).id),
  'AC-10: admin ukrywa zgłoszenie z konta');
select lives_ok(format($$update public.range_officers set is_active = true where id = %L$$, (pg_temp.officer()).id),
  'AC-10: admin przywraca zgłoszenie z konta');
select lives_ok($$update public.range_officers set full_name = 'Piotr Admina-Nowy' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  'SPEC-005 AC-1: admin edytuje prowadzącego bez konta');

-- ===== Usunięcie i ponowne dodanie (AC-13) =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.remove_my_range_officer()$$, 'AC-13: użytkownik usuwa zgłoszenie');
select is((select is_active from public.my_range_officer()), false, 'AC-13: zgłoszenie znika z list (is_active = false)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(format($$select pg_temp.entry(gen_random_uuid(), %L)$$, (pg_temp.officer()).id),
  'P0001', 'range_officer_inactive', 'AC-13: usunięte zgłoszenie odrzucone we wpisie');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select row(status, is_active)::text from public.save_my_range_officer('123/2024', 'OTHER', 'Klub ABC')),
  row('pending', true)::text, 'AC-13: ponowne dodanie → pending, aktywne');

-- ===== Imię i nazwisko z profilu (AC-14) =====

update public.profiles set full_name = 'Anna Kowalska' where id = '00000000-0000-0000-0000-0000000000c1';
reset role;
select is((select row(full_name, status)::text from public.range_officers where id = (pg_temp.officer()).id),
  row('Anna Kowalska', 'pending')::text, 'AC-14: nazwisko zgłoszenia zmienia się z profilem, bez zmiany statusu');
select is((select range_officer_name from public.range_log where id = '20000000-0000-0000-0000-000000000001'),
  'Anna Nowak', 'AC-14: dawne wpisy książki bez zmian');

-- ===== Uprawnienia funkcji i usunięcie konta (§7) =====

select ok(not has_function_privilege('anon', 'public.save_my_range_officer(text, text, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.review_range_officer(uuid, text)', 'execute'),
  '§5: funkcje niedostępne dla anon');

delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.range_officers where full_name = 'Anna Kowalska'), 0,
  '§7: usunięcie konta usuwa zgłoszenie (kaskada)');
select is((select row(range_officer_id, range_officer_name)::text from public.range_log
           where id = '20000000-0000-0000-0000-000000000001'),
  row(null::uuid, 'Anna Nowak')::text, '§7: wpis książki zostaje z kopią nazwiska');

select * from finish();
rollback;
