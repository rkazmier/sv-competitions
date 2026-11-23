-- SPEC-005 §5 (AC-10, AC-15, AC-16, AC-21, AC-22): książka rejestru pobytu — schemat, funkcje, RLS, podpisy.
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'jan.kowalski@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'niekompletny@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set full_name = 'Jan Kowalski', permit_number = 'AB 123', permit_authority = 'KWP Katowice',
  qr_token = 'qr-jan' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set qr_token = 'qr-niekompletny' where id = '00000000-0000-0000-0000-0000000000c2';

insert into public.range_officers (id, full_name) values
  ('00000000-0000-0000-0000-0000000000d1', 'Piotr Prowadzący'),
  ('00000000-0000-0000-0000-0000000000d2', 'Ukryty Prowadzący');
update public.range_officers set is_active = false where id = '00000000-0000-0000-0000-0000000000d2';

-- Produkty i uprawnienia; wejście jednorazowe pasujące do dzisiejszego dnia tygodnia.
-- SPEC-012 AC-53, AC-54: karnet czasowy sprzedawany przed 7-A — wiersz z pominięciem wyzwalacza, sprzedaż bez końca.
alter table public.products disable trigger products_before_write;
create or replace function public.days_pass_sales_end() returns date language sql stable set search_path = ''
as $$ select date '9999-12-31' $$;
insert into public.products (id, kind, name, price, entries, days, day_type) values
  ('00000000-0000-0000-0000-00000000f001', 'entries', 'Karnet 10 wejść', 120000, 10, null, null),
  ('00000000-0000-0000-0000-00000000f002', 'days', 'Karnet 3 dni', 30000, null, 3, null),
  ('00000000-0000-0000-0000-00000000f003', 'single_entry', 'Wejście jednorazowe', 5000, null, null,
   case when extract(isodow from public.range_today()) in (6, 7) then 'weekend' else 'weekday' end);
alter table public.products enable trigger products_before_write;
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-00000000f0e0', 'Zawody SV');
-- Bez blokady karnetów (SPEC-012 AC-40) — tu testujemy kolejność uprawnień; blokada: 037_pass_blocking_test.sql.
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, external_url, blocks_passes) values
  ('00000000-0000-0000-0000-00000000f0e1', 'Dzisiejsze zawody', '00000000-0000-0000-0000-00000000f0e0',
   public.range_today(), public.range_today(), 'published', 'https://example.test', false);

create temp table t (name text primary key, id uuid);
grant all on t to public;
create function pg_temp.buy(p_name text, p_user uuid, p_product uuid) returns void language sql as $$
  with o as (
    insert into public.orders (user_id, product_id, item_name, amount, payment_method)
      select p_user, id, name, price, 'tpay' from public.products where id = p_product returning id
  )
  insert into t select p_name, public.fulfil_order(o.id) from o;
$$;
select pg_temp.buy('entries_late', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001');
select pg_temp.buy('entries', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f001');
select pg_temp.buy('days_new', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f002');
select pg_temp.buy('days_active', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f002');
select pg_temp.buy('single', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f003');
select pg_temp.buy('other', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000f001');
insert into public.orders (id, user_id, calendar_event_id, item_name, amount, payment_method) values
  ('00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-00000000f0e1', 'Wejściówka: Dzisiejsze zawody', 5000, 'tpay');
insert into t values ('ticket', public.fulfil_order('00000000-0000-0000-0000-00000000f0d1'));
update public.user_passes set expires_on = expires_on + 30 where id = (select id from t where name = 'entries_late');
update public.user_passes set first_used_on = public.range_today() - 1 where id = (select id from t where name = 'days_active');

-- Plik podpisu w buckecie (jak po wysłaniu z urządzenia); zwraca ścieżkę dla wpisu p_id.
-- Bez `returning`: obsługa nie ma prawa odczytu podpisów (jak upload przez Storage API).
create function pg_temp.sig(p_id uuid) returns text language plpgsql as $$
declare
  path text := to_char(now(), 'YYYY/MM/') || p_id || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('signatures', path);
  return path;
end;
$$;
create function pg_temp.pass(p_name text) returns uuid language sql as $$ select id from t where name = p_name; $$;
create function pg_temp.entry(p_id uuid, p_pass text, p_profile uuid default '00000000-0000-0000-0000-0000000000c1')
returns uuid language sql as $$
  select id from public.create_range_log_entry(p_id, pg_temp.sig(p_id), '00000000-0000-0000-0000-0000000000d1',
    p_profile, pg_temp.pass(p_pass));
$$;
grant execute on all functions in schema pg_temp to public;

-- ===== Obsługa: znalezienie osoby (AC-5, AC-6) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select row(full_name, is_range_ready, missing_fields, last_entry_today)::text from public.staff_find_by_qr('qr-jan')),
  row('Jan Kowalski', true, '{}'::text[], null::timestamptz)::text,
  'AC-5: staff_find_by_qr zwraca osobę gotową do wpisu'
);
select is(
  (select missing_fields from public.staff_find_by_qr('qr-niekompletny')),
  array['full_name', 'permit_or_address'], 'AC-5: staff_find_by_qr zwraca listę braków'
);
select is((select count(*)::int from public.staff_find_by_qr('nieznany')), 0, 'AC-5: nieznany kod → brak wyników');
select is((select count(*)::int from public.staff_search_people('ja')), 0, 'AC-6: wyszukiwanie od 3 znaków');
select is(
  (select row(id, email_hint)::text from public.staff_search_people('kowal')),
  row('00000000-0000-0000-0000-0000000000c1'::uuid, 'ja…@example.test')::text,
  'AC-6: wyszukiwanie po imieniu i nazwisku, e-mail tylko częściowo'
);
select is((select count(*)::int from public.staff_search_people('example')), 4, 'AC-6: wyszukiwanie po e-mailu');

-- ===== AC-10: kolejność uprawnień =====

select is(
  (select array_agg(priority::text || ':' || kind order by ord)
   from public.passes_for_range_entry('00000000-0000-0000-0000-0000000000c1') with ordinality as x(priority, id, kind, item_name, entries_left, days_total, first_used_on, valid_until, expires_on, ord)),
  array['0:event_ticket', '1:days', '2:days', '3:entries', '3:entries', '4:single_entry'],
  'AC-10: wejściówka, aktywny czasowy, nieaktywowany czasowy, ilościowy, jednorazowe'
);
select is(
  (select array_agg(id order by ord) from public.passes_for_range_entry('00000000-0000-0000-0000-0000000000c1')
     with ordinality as x(priority, id, kind, item_name, entries_left, days_total, first_used_on, valid_until, expires_on, ord)
   where kind = 'entries'),
  array[pg_temp.pass('entries'), pg_temp.pass('entries_late')],
  'AC-10: w grupie wg najwcześniejszego expires_on'
);
reset role;

-- ===== AC-15: zapis wpisu i zużycie =====

set local role authenticated;
select lives_ok(
  $$select pg_temp.entry('10000000-0000-0000-0000-000000000001', 'entries')$$, 'AC-15: obsługa tworzy wpis z karnetem ilościowym'
);
reset role;
select is(
  (select row(full_name, permit_number, permit_authority, address, range_officer_name, range_officer_id, profile_id,
              is_companion, created_by, entered_at = now())::text
   from public.range_log where id = '10000000-0000-0000-0000-000000000001'),
  row('Jan Kowalski', 'AB 123', 'KWP Katowice', null::text, 'Piotr Prowadzący', '00000000-0000-0000-0000-0000000000d1'::uuid,
      '00000000-0000-0000-0000-0000000000c1'::uuid, false, '00000000-0000-0000-0000-0000000000b1'::uuid, true)::text,
  'AC-15: wpis z kopią danych osoby i prowadzącego, czas z bazy'
);
select is(
  (select row(u.effect, u.used_on, p.entries_left)::text from public.pass_usages u join public.user_passes p on p.id = u.user_pass_id
   where u.range_log_entry_id = '10000000-0000-0000-0000-000000000001'),
  row('decremented', public.range_today(), 9)::text, 'AC-15: karnet ilościowy — licznik −1, zużycie zapisane'
);

set local role authenticated;
select pg_temp.entry('10000000-0000-0000-0000-000000000002', 'days_new');
select pg_temp.entry('10000000-0000-0000-0000-000000000003', 'days_new');
select pg_temp.entry('10000000-0000-0000-0000-000000000004', 'single');
select pg_temp.entry('10000000-0000-0000-0000-000000000005', 'ticket');
reset role;
select is(
  (select array_agg(effect order by range_log_entry_id) from public.pass_usages where range_log_entry_id in (
     '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005')),
  array['activated', 'covered', 'consumed', 'covered'], 'AC-15: aktywacja / w ważności / jednorazowe / wejściówka'
);
select is(
  (select row(first_used_on, valid_until)::text from public.user_passes where id = pg_temp.pass('days_new')),
  row(public.range_today(), public.range_today() + 2)::text, 'AC-15: aktywacja karnetu czasowego: first_used_on dziś, valid_until +2'
);
select is((select status from public.user_passes where id = pg_temp.pass('single')), 'used_up', 'AC-15: wejście jednorazowe → used_up');
select ok(public.pass_has_usage(pg_temp.pass('ticket')), 'SPEC-003 AC-25: pass_has_usage widzi pass_usages');

-- Kopia: zmiana profilu i prowadzącego nie zmienia wpisu (AC-2).
update public.profiles set full_name = 'Jan Nowak' where id = '00000000-0000-0000-0000-0000000000c1';
update public.range_officers set full_name = 'Piotr Inny' where id = '00000000-0000-0000-0000-0000000000d1';
select is(
  (select full_name || ' / ' || range_officer_name from public.range_log where id = '10000000-0000-0000-0000-000000000001'),
  'Jan Kowalski / Piotr Prowadzący', 'AC-2, AC-15: wpis zachowuje kopię danych'
);

set local role authenticated;
select is(
  (select id from public.create_range_log_entry('10000000-0000-0000-0000-000000000001',
     to_char(now(), 'YYYY/MM/') || '10000000-0000-0000-0000-000000000001.png', '00000000-0000-0000-0000-0000000000d1',
     '00000000-0000-0000-0000-0000000000c1', pg_temp.pass('entries'))),
  '10000000-0000-0000-0000-000000000001'::uuid, 'AC-16: ponowienie z tym samym id zwraca istniejący wpis'
);
reset role;
select is((select entries_left from public.user_passes where id = pg_temp.pass('entries')), 9, 'AC-16: ponowienie nie zużywa drugi raz');

-- Osoba towarzysząca (AC-20) i osoba bez konta (AC-18, AC-19).
set local role authenticated;
select lives_ok($$
  select public.create_range_log_entry('10000000-0000-0000-0000-000000000006', pg_temp.sig('10000000-0000-0000-0000-000000000006'),
    '00000000-0000-0000-0000-0000000000d1', p_is_companion => true, p_full_name => ' Anna Gość ', p_address => 'ul. Polna 1, Gliwice')
$$, 'AC-20: wpis osoby towarzyszącej bez uprawnienia');
insert into t values ('guest_order', public.create_on_site_order(null, '00000000-0000-0000-0000-00000000f003', 'cash'));
insert into t select 'guest', p.id from public.user_passes p where p.order_id = pg_temp.pass('guest_order');
select lives_ok($$
  select public.create_range_log_entry('10000000-0000-0000-0000-000000000007', pg_temp.sig('10000000-0000-0000-0000-000000000007'),
    '00000000-0000-0000-0000-0000000000d1', p_user_pass_id => pg_temp.pass('guest'),
    p_full_name => 'Adam Gość', p_permit_number => 'X1', p_permit_authority => 'KWP Kraków')
$$, 'AC-19: osoba bez konta zużywa uprawnienie sprzedane na miejscu');
reset role;
select is(
  (select row(full_name, address, profile_id, is_companion)::text from public.range_log where id = '10000000-0000-0000-0000-000000000006'),
  row('Anna Gość', 'ul. Polna 1, Gliwice', null::uuid, true)::text, 'AC-20: dane osoby bez konta po trim, bez konta'
);
select is((select count(*)::int from public.pass_usages where range_log_entry_id = '10000000-0000-0000-0000-000000000006'), 0,
  'AC-20: osoba towarzysząca nie zużywa uprawnienia');

-- ===== AC-16: błędy — wpis i zużycie nie powstają =====

create temp table counts as select (select count(*) from public.range_log) as entries, (select count(*) from public.pass_usages) as usages;
grant select on counts to public;
set local role authenticated;
select throws_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000001', 'single')$$,
  'P0001', 'pass_not_valid', 'AC-16: wykorzystane wejście jednorazowe → pass_not_valid');
select throws_ok($$
  select public.create_range_log_entry('20000000-0000-0000-0000-000000000002', pg_temp.sig('20000000-0000-0000-0000-000000000002'),
    '00000000-0000-0000-0000-0000000000d1', p_user_pass_id => pg_temp.pass('guest'), p_full_name => 'Ktoś Inny', p_address => 'ul. Długa 2')
$$, 'P0001', 'pass_not_valid', 'AC-19: uprawnienie osoby bez konta nie zużywa się drugi raz');
select throws_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000003', 'other')$$,
  'P0001', 'pass_not_valid', 'AC-16: uprawnienie innej osoby → pass_not_valid');
select throws_ok($$
  select public.create_range_log_entry('20000000-0000-0000-0000-000000000004',
    to_char(now(), 'YYYY/MM/') || '20000000-0000-0000-0000-000000000004.png', '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000c1', pg_temp.pass('entries'))
$$, 'P0001', 'signature_missing', 'AC-15: brak pliku podpisu → signature_missing');
select throws_ok($$
  select public.create_range_log_entry('20000000-0000-0000-0000-000000000005', pg_temp.sig('20000000-0000-0000-0000-000000000005'),
    '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', pg_temp.pass('entries'))
$$, 'P0001', 'range_officer_inactive', '§7: ukryty prowadzący → range_officer_inactive');
select throws_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000006', 'other', '00000000-0000-0000-0000-0000000000c2')$$,
  'P0001', 'person_data_incomplete', 'AC-7: osoba bez kompletu danych → person_data_incomplete');
select throws_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000007', null)$$,
  '22023', 'pass_required', 'AC-15: wpis korzystającego wymaga uprawnienia');
reset role;
select is(
  (select row((select count(*) from public.range_log), (select count(*) from public.pass_usages))::text),
  (select row(entries, usages)::text from counts), 'AC-16: po błędach brak nowych wpisów i zużyć'
);

-- Współbieżność (§7): blokada wiersza uprawnienia do końca transakcji; ostatnie wejście zużywa tylko jeden wpis.
select ok(
  pg_get_functiondef('public.create_range_log_entry(uuid, text, uuid, uuid, uuid, boolean, text, text, text, text)'::regprocedure)
    ~ 'from public\.user_passes p where p\.id = p_user_pass_id for update',
  '§7: create_range_log_entry blokuje wiersz uprawnienia (for update) przed sprawdzeniem ważności'
);
update public.user_passes set entries_left = 1 where id = pg_temp.pass('entries_late');
set local role authenticated;
select lives_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000008', 'entries_late')$$, '§7: pierwszy wpis zużywa ostatnie wejście');
select throws_ok($$select pg_temp.entry('20000000-0000-0000-0000-000000000009', 'entries_late')$$,
  'P0001', 'pass_not_valid', '§7, AC-16: drugi wpis na to samo ostatnie wejście → pass_not_valid');
reset role;
select is((select status from public.user_passes where id = pg_temp.pass('entries_late')), 'used_up', '§7: karnet ilościowy 0 → used_up');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$
  select public.create_range_log_entry('20000000-0000-0000-0000-00000000000a', '2026/11/20000000-0000-0000-0000-00000000000a.png',
    '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', pg_temp.pass('entries'))
$$,
  '42501', 'forbidden', '§5: użytkownik nie tworzy wpisów');
select throws_ok($$select * from public.staff_find_by_qr('qr-jan')$$, '42501', 'forbidden', '§5: staff_find_by_qr tylko obsługa');
select throws_ok($$select * from public.staff_search_people('kowal')$$, '42501', 'forbidden', '§5: staff_search_people tylko obsługa');

-- ===== Użytkownik: tylko przez my_range_entries (§5, AC-24) =====

select is((select count(*)::int from public.range_log), 0, '§5: użytkownik nie czyta range_log bezpośrednio');
select is(
  (select array_agg(pass_name order by pass_name) from public.my_range_entries()),
  array['Karnet 10 wejść', 'Karnet 10 wejść', 'Karnet 3 dni', 'Karnet 3 dni', 'Wejście jednorazowe', 'Wejściówka: Dzisiejsze zawody'],
  '§5: my_range_entries — własne wpisy z nazwą uprawnienia'
);
select is((select count(*)::int from public.pass_usages), 6, '§5: pass_usages — własne zużycia');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('signatures', '2026/11/30000000-0000-0000-0000-000000000001.png')$$,
  '42501', null, '§5: użytkownik nie wysyła podpisów');
reset role;

-- ===== AC-21: brak update/delete dla wszystkich ról =====

insert into public.range_log (id, entered_at, full_name, address, range_officer_name, signature_path)
  values ('30000000-0000-0000-0000-000000000001', now() - interval '2 days', 'Stary Wpis', 'ul. Stara 1', 'Piotr Prowadzący', 'old.png');

create function pg_temp.immutable_for(p_role text, p_sub text) returns setof text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"' || p_sub || '","role":"authenticated"}', true);
  execute 'set local role ' || p_role;
  return next throws_ok($q$update public.range_log set full_name = 'X'$q$, '42501', null, 'AC-21: ' || p_role || ' ' || p_sub || ' — brak update wpisu');
  return next throws_ok($q$delete from public.range_log$q$, '42501', null, 'AC-21: ' || p_role || ' ' || p_sub || ' — brak delete wpisu');
  return next throws_ok($q$update public.range_log_annotations set body = 'XXXXX'$q$, '42501', null, 'AC-21: ' || p_role || ' ' || p_sub || ' — brak update adnotacji');
  return next throws_ok($q$delete from public.range_log_annotations$q$, '42501', null, 'AC-21: ' || p_role || ' ' || p_sub || ' — brak delete adnotacji');
  return next throws_ok($q$delete from public.pass_usages$q$, '42501', null, 'AC-21: ' || p_role || ' ' || p_sub || ' — brak delete zużycia');
  reset role;
end;
$$;
select pg_temp.immutable_for('anon', '');
select pg_temp.immutable_for('authenticated', '00000000-0000-0000-0000-0000000000c1');
select pg_temp.immutable_for('authenticated', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.immutable_for('authenticated', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.immutable_for('service_role', '');
select throws_ok($$update public.range_log set full_name = 'X' where id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', 'range_log_immutable', 'AC-21: także właściciel tabeli nie zmienia wpisu (wyzwalacz)');
select throws_ok($$delete from public.range_log where id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', 'range_log_immutable', 'AC-21: delete tylko przez zadanie retencji');
select lives_ok($$delete from public.range_officers where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '§5: usunięcie prowadzącego → range_officer_id null (on delete set null dozwolone)');
select is((select range_officer_name from public.range_log where id = '10000000-0000-0000-0000-000000000001'), 'Piotr Prowadzący',
  '§5: kopia nazwiska prowadzącego zostaje');

-- ===== AC-21, AC-22: adnotacje =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$insert into public.range_log_annotations (entry_id, body) values ('10000000-0000-0000-0000-000000000001', 'Literówka w nazwisku')$$,
  'AC-21: obsługa dodaje adnotację do dzisiejszego wpisu');
select throws_ok($$insert into public.range_log_annotations (entry_id, body) values ('10000000-0000-0000-0000-000000000001', ' abc ')$$,
  '23514', null, 'AC-21: adnotacja 5–500 znaków');
select throws_ok($$insert into public.range_log_annotations (entry_id, body, created_by) values ('10000000-0000-0000-0000-000000000001', 'Podszywam się', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'AC-21: autor adnotacji = zalogowany');
select throws_ok($$insert into public.range_log_annotations (entry_id, body) values ('30000000-0000-0000-0000-000000000001', 'Poprawka wczoraj')$$,
  '42501', null, 'AC-22: obsługa nie dodaje adnotacji do wpisu z innego dnia');
select is((select count(*)::int from public.range_log where id = '30000000-0000-0000-0000-000000000001'), 0, '§5: obsługa nie widzi wpisów z innych dni');
select is((select created_by from public.range_log_annotations), '00000000-0000-0000-0000-0000000000b1'::uuid, 'AC-21: adnotacja z autorem');
select is((select count(*)::int from storage.objects where bucket_id = 'signatures'), 0, '§5: obsługa nie czyta podpisów');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('signatures', '2026/11/30000000-0000-0000-0000-000000000002.png')$$,
  '§5: obsługa wysyła podpis <RRRR>/<MM>/<uuid>.png');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('signatures', 'inne/podpis.png')$$,
  '42501', null, '§5: podpis tylko pod ścieżką <RRRR>/<MM>/<uuid>.png');
select throws_ok($$insert into public.range_officers (full_name) values ('Nowy Prowadzący')$$, '42501', null, 'AC-1: obsługa nie dodaje prowadzących');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$insert into public.range_log_annotations (entry_id, body) values ('30000000-0000-0000-0000-000000000001', 'Poprawka admina')$$,
  'AC-22: admin dodaje adnotację do dowolnego wpisu');
select is((select count(*)::int from public.range_log), 9, '§5: admin widzi całą książkę');
select ok((select count(*) from storage.objects where bucket_id = 'signatures') > 0, '§5: admin czyta podpisy (podpisane linki)');
select lives_ok($$insert into public.range_officers (full_name) values ('Nowy Prowadzący')$$, 'AC-1: admin dodaje prowadzącego');
reset role;

select ok(not (select public from storage.buckets where id = 'signatures'), '§5: bucket signatures prywatny');
select is((select row(file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'signatures'),
  row(204800::bigint, array['image/png'])::text, '§5: podpisy PNG, maks. 200 KB');

select * from finish();
rollback;
