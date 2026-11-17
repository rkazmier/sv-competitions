-- SPEC-002 §5: dane profilu, is_range_ready, qr_token, audit_log, RLS i funkcje
-- (AC-4, AC-8, AC-10, AC-15, AC-17, AC-18, AC-19, AC-22).
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'kowalski@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Jan Kowalski' where id = '00000000-0000-0000-0000-0000000000c2';

create function pg_temp.as_user(uid text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$f$;

-- ===== AC-4: nowe konto =====

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'user',
  'AC-4: nowe konto ma rolę user'
);
select ok(
  (select qr_token ~ '^[A-Za-z0-9_-]{32}$' from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'AC-4: nowe konto ma qr_token — 32 znaki base64url'
);
select is(
  (select count(distinct qr_token)::int from public.profiles), (select count(*)::int from public.profiles),
  'AC-4: qr_token jest losowy (różny dla każdego konta)'
);
select is(
  (select row(full_name, phone, permit_number, permit_authority, address, privacy_notice_ack_at, qr_token_rotated_at)::text
   from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  '(,,,,,,)', 'AC-4: nowe konto ma puste dane'
);
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), false,
  'AC-4: nowe konto nie jest gotowe do wpisu'
);
select col_is_unique('public', 'profiles', 'qr_token', 'qr_token jest unikalny');

-- ===== AC-8 i limity pól (check w bazie) =====

select throws_ok(
  $$update public.profiles set permit_number = 'ABC/123' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'AC-8: numer decyzji bez organu wydającego odrzucony'
);
select throws_ok(
  $$update public.profiles set permit_authority = 'KWP Katowice' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'AC-8: organ wydający bez numeru decyzji odrzucony'
);
select throws_ok(
  $$update public.profiles set permit_number = 'ABC/123', permit_authority = '  ' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'AC-8: organ ze spacji = pusty, więc para niekompletna'
);
select throws_ok(
  $$update public.profiles set full_name = 'J' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'imię i nazwisko krótsze niż 2 znaki odrzucone'
);
select throws_ok(
  $$update public.profiles set full_name = repeat('a', 151) where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'imię i nazwisko dłuższe niż 150 znaków odrzucone'
);
select throws_ok(
  $$update public.profiles set phone = '12-345-678' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'telefon spoza wzorca odrzucony'
);
select throws_ok(
  $$update public.profiles set address = 'ul.' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'adres krótszy niż 5 znaków odrzucony'
);
select throws_ok(
  $$update public.profiles set permit_number = repeat('1', 51), permit_authority = 'KWP' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'numer decyzji dłuższy niż 50 znaków odrzucony'
);

-- ===== AC-10: is_range_ready =====

update public.profiles set full_name = '  Anna Nowak  ', phone = '', address = ''
  where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select row(full_name, phone, address)::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  '("Anna Nowak",,)', 'pola po trim, puste ciągi zapisane jako null'
);
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), false,
  'AC-10: samo imię i nazwisko — niegotowy'
);
update public.profiles set address = 'ul. Stalowa 1, 40-001 Katowice' where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), true,
  'AC-10: imię i nazwisko + adres — gotowy'
);
update public.profiles set address = null, permit_number = 'ABC/123', permit_authority = 'KWP Katowice', phone = '+48 600 100 200'
  where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), true,
  'AC-10: imię i nazwisko + numer decyzji z organem — gotowy'
);
update public.profiles set full_name = null where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), false,
  'AC-10: bez imienia i nazwiska — niegotowy'
);
select throws_ok(
  $$update public.profiles set is_range_ready = true where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '428C9', null, 'AC-10: is_range_ready liczone w bazie, nie do zapisu'
);
update public.profiles set full_name = 'Anna Nowak' where id = '00000000-0000-0000-0000-0000000000c1';

-- ===== Użytkownik =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select lives_ok(
  $$update public.profiles set phone = '600100300', address = 'ul. Hutnicza 2, Katowice', privacy_notice_ack_at = now()
    where id = '00000000-0000-0000-0000-0000000000c1'$$,
  'AC-7: użytkownik zmienia własne dane'
);
select throws_ok(
  $$update public.profiles set qr_token = 'x' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'użytkownik nie ustawia qr_token bezpośrednio'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'AC-19: użytkownik nie zmienia roli w tabeli'
);
select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000c1', 'admin')$$,
  '42501', null, 'AC-19: użytkownik nie wywoła set_user_role'
);
select throws_ok(
  $$select * from public.admin_list_users()$$,
  '42501', null, 'admin_list_users: tylko admin (użytkownik odrzucony)'
);
update public.profiles set full_name = 'Ktoś Inny' where id = '00000000-0000-0000-0000-0000000000c2';
reset role;
select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 'Jan Kowalski',
  'użytkownik nie zmienia cudzego profilu'
);
select is(
  (select count(*)::int from public.audit_log), 0,
  'AC-22: zmiana własnych danych nie tworzy wpisu w audit_log'
);
select isnt(
  (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), null,
  'updated_at ustawiane przy zmianie'
);

-- ===== AC-15: nowy kod QR =====

select set_config('test.old_token', qr_token, true) from public.profiles where id = '00000000-0000-0000-0000-0000000000c1';
select set_config('test.other_token', qr_token, true) from public.profiles where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select isnt(public.rotate_qr_token(), current_setting('test.old_token'), 'AC-15: rotate_qr_token zwraca nowy kod');
reset role;
select is(
  (select count(*)::int from public.profiles where qr_token = current_setting('test.old_token')), 0,
  'AC-15: stary kod od razu nie znajduje nikogo'
);
select ok(
  (select qr_token ~ '^[A-Za-z0-9_-]{32}$' and qr_token_rotated_at is not null
   from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'AC-15: nowy kod 32 znaki base64url, zapisana data zmiany'
);
select is(
  (select qr_token from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  current_setting('test.other_token'),
  'AC-15: kod innego konta bez zmian'
);
set local role anon;
select throws_ok($$select public.rotate_qr_token()$$, '42501', null, 'AC-15: gość nie wywoła rotate_qr_token');
reset role;

-- ===== Obsługa strzelnicy =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  (select count(*)::int from public.profiles), 4,
  'obsługa widzi wszystkie profile'
);
select is(
  (select is_range_ready from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), true,
  'AC-10: obsługa widzi ten sam is_range_ready'
);
select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000b1', 'admin')$$,
  '42501', null, 'AC-19: obsługa nie wywoła set_user_role'
);
select throws_ok(
  $$select * from public.admin_list_users()$$,
  '42501', null, 'admin_list_users: obsługa odrzucona'
);
update public.profiles set full_name = 'Zmiana obsługi' where id = '00000000-0000-0000-0000-0000000000c2';
reset role;
select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 'Jan Kowalski',
  'obsługa nie edytuje profilu bezpośrednio w tabeli (SPEC-005 przez funkcję)'
);

-- ===== Admin =====

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.profiles set full_name = 'Jan Nowy-Kowalski', phone = '600 000 001'
  where id = '00000000-0000-0000-0000-0000000000c2';
select results_eq(
  $$select actor_id, target_user_id, action, changes from public.audit_log where action = 'profile_update'$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid,
            'profile_update'::text,
            '{"full_name": ["Jan Kowalski", "Jan Nowy-Kowalski"], "phone": [null, "600 000 001"]}'::jsonb)$$,
  'AC-20/AC-22: zmiana danych przez admina zapisana w audit_log (kto, kogo, stare i nowe wartości)'
);
select throws_ok(
  $$insert into public.audit_log (action) values ('profile_update')$$,
  '42501', null, 'audit_log: brak insert dla klientów (także admina)'
);
select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null, 'audit_log: brak delete dla klientów'
);

select lives_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000b1', 'admin')$$,
  'AC-17: admin nadaje rolę'
);
select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'admin',
  'AC-17: rola zmienia się od razu'
);
select results_eq(
  $$select actor_id, target_user_id, changes from public.audit_log where action = 'role_change'$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid,
            '{"role": ["staff", "admin"]}'::jsonb)$$,
  'AC-17: wpis role_change (kto, kogo, stara i nowa rola)'
);
select is(
  (select count(*)::int from public.audit_log where action = 'profile_update'), 1,
  'AC-17: zmiana roli nie tworzy dodatkowego wpisu profile_update'
);
select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000c1', 'organizer')$$,
  '22023', null, 'set_user_role: nieznana rola odrzucona'
);
select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000ff', 'staff')$$,
  'P0002', null, 'set_user_role: nieistniejące konto'
);

-- Druga osoba z rolą admin odbiera ją pierwszej — dozwolone, bo zostaje admin (§7).
select lives_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000b1', 'staff')$$,
  'admin odbiera rolę innemu adminowi, gdy zostaje co najmniej jeden'
);
select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-0000000000a1', 'staff')$$,
  'P0001', 'last_admin', 'AC-18: jedyny admin nie odbierze sobie roli'
);
select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'admin',
  'AC-18: rola jedynego admina bez zmian'
);

select results_eq(
  $$select email, full_name, total_count from public.admin_list_users('kowal')$$,
  $$values ('kowalski@example.test'::text, 'Jan Nowy-Kowalski'::text, 1::bigint)$$,
  'admin_list_users: wyszukiwanie po nazwisku/e-mailu zwraca e-mail z auth.users'
);
select is(
  (select count(*)::int from public.admin_list_users('k')), 4,
  'admin_list_users: fraza krótsza niż 2 znaki nie filtruje'
);
select is(
  (select count(*)::int from public.admin_list_users(null, 2)), 0,
  'admin_list_users: 50 na stronę, druga strona pusta'
);
select cmp_ok(
  (select count(*)::int from public.audit_log), '>', 0,
  'audit_log: admin widzi dziennik'
);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.audit_log), 0, 'audit_log: obsługa nie widzi dziennika');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select is((select count(*)::int from public.audit_log), 0, 'audit_log: użytkownik nie widzi dziennika (nawet o sobie)');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.audit_log$$, '42501', null, 'audit_log: gość bez dostępu');
reset role;

select * from finish();
rollback;
