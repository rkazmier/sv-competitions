-- SPEC-003 US-1 (AC-1…AC-4), §5 RLS: produkty Oferty.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'user@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1';
delete from public.products;

-- ===== Admin: dodawanie (AC-1) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.products (id, kind, name, price, entries, description, is_active)
    values ('00000000-0000-0000-0000-00000000e001', 'entries', '  Karnet 10 wejść ', 120000, 10, '  ', true)$$,
  'AC-1: admin dodaje karnet ilościowy'
);
select is(
  (select row(name, description, is_active, position)::text from public.products where id = '00000000-0000-0000-0000-00000000e001'),
  row('Karnet 10 wejść', null::text, false, 1)::text,
  'AC-1: nowy produkt jest ukryty, nazwa po trim, pusty opis → null, pierwsza pozycja w grupie'
);
select lives_ok(
  $$insert into public.products (id, kind, name, price, entries)
    values ('00000000-0000-0000-0000-00000000e002', 'entries', 'Karnet 5 wejść', 65000, 5)$$,
  'AC-1: drugi karnet ilościowy'
);
select throws_ok(
  $$insert into public.products (kind, name, price, entries) values ('days', 'Karnet 30 dni', 30000, 30)$$,
  '23514', null, 'AC-1: rodzaju „Karnet czasowy” nie ma (usunięty z Oferty)'
);
insert into public.products (id, kind, name, price, day_type)
  values ('00000000-0000-0000-0000-00000000e003', 'single_entry', 'Wejście w tygodniu', 3000, 'weekday');
select lives_ok(
  $$insert into public.products (id, kind, name, price, day_type)
    values ('00000000-0000-0000-0000-00000000e004', 'single_entry', 'Wejście weekendowe', 5001, 'weekend')$$,
  'AC-1: admin dodaje wejście jednorazowe (cena do grosza)'
);
select is(
  (select array_agg(position order by id) from public.products where kind = 'entries'),
  array[1, 2], 'AC-4: nowy produkt trafia na koniec swojej grupy'
);
select is(
  (select position from public.products where id = '00000000-0000-0000-0000-00000000e003'),
  1, 'AC-4: kolejność liczona osobno w każdej grupie'
);

select throws_ok(
  $$insert into public.products (kind, name, price, entries) values ('entries', 'Za dużo', 1000, 101)$$,
  '23514', null, 'AC-1: liczba wejść 1–100'
);
select throws_ok(
  $$insert into public.products (kind, name, price) values ('entries', 'Bez wejść', 1000)$$,
  '23514', null, 'AC-1: karnet ilościowy wymaga liczby wejść'
);
select throws_ok(
  $$insert into public.products (kind, name, price, entries, day_type) values ('entries', 'Z dniem', 1000, 10, 'weekend')$$,
  '23514', null, 'AC-1: karnet ilościowy nie ma dnia'
);
select throws_ok(
  $$insert into public.products (kind, name, price) values ('single_entry', 'Bez dnia', 1000)$$,
  '23514', null, 'AC-1: wejście jednorazowe wymaga dnia'
);
select throws_ok(
  $$insert into public.products (kind, name, price, entries) values ('entries', '   ', 1000, 1)$$,
  '23514', null, 'AC-1: nazwa wymagana'
);
select throws_ok(
  $$insert into public.products (kind, name, price, entries) values ('entries', 'Darmowy', 0, 1)$$,
  '23514', null, 'AC-1: cena co najmniej 1 grosz'
);
select throws_ok(
  $$insert into public.products (kind, name, price, entries, description) values ('entries', 'Opis', 100, 1, repeat('x', 501))$$,
  '23514', null, 'AC-1: opis maks. 500 znaków'
);

-- ===== Pokaż / ukryj, bez usuwania (AC-2) =====

update public.products set is_active = true
  where id in ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000e003');
select is(
  (select count(*)::int from public.products where is_active), 2, 'AC-2: „Pokaż w ofercie” ustawia is_active'
);
select throws_ok(
  $$delete from public.products where id = '00000000-0000-0000-0000-00000000e002'$$,
  '42501', null, 'AC-2: produktów nie da się usunąć'
);

-- ===== Kolejność (AC-4) =====

select is(
  public.move_product('00000000-0000-0000-0000-00000000e002', 'up'), true, 'AC-4: strzałka w górę'
);
select is(
  (select array_agg(id order by position) from public.products where kind = 'entries'),
  array['00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e001']::uuid[],
  'AC-4: produkty zamieniły się miejscami'
);
select is(
  public.move_product('00000000-0000-0000-0000-00000000e002', 'up'), false, 'AC-4: pierwszy w grupie nie idzie wyżej'
);
select is(
  public.move_product('00000000-0000-0000-0000-00000000e004', 'down'), false,
  'AC-4: ostatni w grupie nie idzie niżej (inne grupy się nie liczą)'
);

-- ===== Blokada zmian przy zamówieniach (AC-3) =====

select is(
  public.product_has_orders('00000000-0000-0000-0000-00000000e001'), false, 'AC-3: produkt bez zamówień'
);
select lives_ok(
  $$update public.products set kind = 'single_entry', entries = null, day_type = 'weekday'
    where id = '00000000-0000-0000-0000-00000000e002'$$,
  'AC-3: bez zamówień rodzaj można zmienić'
);
select throws_ok(
  $$update public.products set kind = 'days', day_type = null where id = '00000000-0000-0000-0000-00000000e002'$$,
  '23514', null, 'AC-3: zmiana rodzaju na nieistniejący (karnet czasowy) odrzucona'
);
select lives_ok(
  $$update public.products set name = 'Wejście w tygodniu', price = 3100, day_type = 'weekend'
    where id = '00000000-0000-0000-0000-00000000e003'$$,
  'AC-3: bez zamówień można zmienić dzień wejścia jednorazowego'
);
reset role;

-- Zamówienia (tabela z #48) zastępujemy w tej transakcji: produkt e001 „ma zamówienie”.
create or replace function public.product_order_exists(p_product_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select p_product_id = '00000000-0000-0000-0000-00000000e001'::uuid $$;

set local role authenticated;
select is(
  public.product_has_orders('00000000-0000-0000-0000-00000000e001'), true, 'AC-3: panel wie, że produkt ma zamówienia'
);
select lives_ok(
  $$update public.products set name = 'Karnet 10 wejść (nowa cena)', price = 130000
    where id = '00000000-0000-0000-0000-00000000e001'$$,
  'AC-3: przy zamówieniach można zmienić nazwę i cenę'
);
select throws_ok(
  $$update public.products set entries = 12 where id = '00000000-0000-0000-0000-00000000e001'$$,
  '23514', 'product_has_orders', 'AC-3: przy zamówieniach nie można zmienić liczby wejść'
);
select throws_ok(
  $$update public.products set kind = 'single_entry', entries = null, day_type = 'weekend'
    where id = '00000000-0000-0000-0000-00000000e001'$$,
  '23514', 'product_has_orders', 'AC-3: przy zamówieniach nie można zmienić rodzaju'
);
reset role;

-- ===== RLS: obsługa, użytkownik, gość (SPEC-003 §5) =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.products), 4, 'obsługa widzi wszystkie produkty, także ukryte');
select throws_ok(
  $$insert into public.products (kind, name, price, entries) values ('entries', 'Obsługa', 100, 1)$$,
  '42501', null, 'obsługa nie dodaje produktów'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select name from public.products order by name$$,
  array['Karnet 10 wejść (nowa cena)', 'Wejście w tygodniu'],
  'użytkownik widzi tylko produkty w ofercie (AC-2)'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from public.products), 2, 'gość widzi tylko produkty w ofercie (AC-2)');
reset role;

select * from finish();
rollback;
