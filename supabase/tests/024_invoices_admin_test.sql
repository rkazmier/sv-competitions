-- SPEC-004 US-3 (AC-10, AC-12, AC-13, AC-14, AC-15, AC-16): `admin_list_invoices` (zakładki, kolejność, zakres dat,
-- autor oznaczenia, zwroty) i `invoice_requested` w `admin_list_orders`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000024a1', 'panel-faktur-admin@example.test'),
  ('00000000-0000-0000-0000-0000000024b1', 'panel-faktur-obsluga@example.test'),
  ('00000000-0000-0000-0000-0000000024c1', 'panel-faktur-klient@example.test');
update public.profiles set role = 'admin', full_name = 'Adam Faktura' where id = '00000000-0000-0000-0000-0000000024a1';
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000024b1';

insert into public.products (id, kind, name, price, entries) values
  ('00000000-0000-0000-0000-0000000024f1', 'entries', 'Karnet PF', 12000, 10);

-- g1: zapłacone 10.11, faktura; g2: zapłacone 12.11, faktura; g3: zapłacone 14.11, faktura, zwrócone (AC-16);
-- g4: zapłacone, bez faktury (AC-14).
insert into public.orders (id, user_id, product_id, item_name, amount, payment_method, on_site_method, created_by) values
  ('00000000-0000-0000-0000-0000000024e1', '00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024f1',
   'Karnet PF', 12000, 'on_site', 'cash', '00000000-0000-0000-0000-0000000024b1'),
  ('00000000-0000-0000-0000-0000000024e2', '00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024f1',
   'Karnet PF', 12000, 'on_site', 'terminal', '00000000-0000-0000-0000-0000000024b1'),
  ('00000000-0000-0000-0000-0000000024e3', '00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024f1',
   'Karnet PF', 12000, 'on_site', 'cash', '00000000-0000-0000-0000-0000000024b1'),
  ('00000000-0000-0000-0000-0000000024e4', '00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024f1',
   'Karnet PF', 12000, 'on_site', 'cash', '00000000-0000-0000-0000-0000000024b1');
create temp table fulfilled as select public.fulfil_order(id) from public.orders where id::text like '%0024e%';
update public.orders set paid_at = case id
    when '00000000-0000-0000-0000-0000000024e1' then '2026-11-10 23:30+00'::timestamptz -- 11.11 w Warszawie
    when '00000000-0000-0000-0000-0000000024e2' then '2026-11-12 10:00+00'::timestamptz
    else '2026-11-14 10:00+00'::timestamptz end
  where id::text like '%0024e%';
select public.set_order_invoice_details(id, '5260250274', 'Firma PF', 'ul. Prosta 1, Warszawa', 'manual')
  from public.orders where id in ('00000000-0000-0000-0000-0000000024e1', '00000000-0000-0000-0000-0000000024e2',
                                  '00000000-0000-0000-0000-0000000024e3');
update public.orders set status = 'refunded', refunded_at = now() where id = '00000000-0000-0000-0000-0000000024e3';

create temp view todo as select * from public.admin_list_invoices('todo') where item_name = 'Karnet PF';
create temp view issued as select * from public.admin_list_invoices('issued') where item_name = 'Karnet PF';
grant select on todo, issued to authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_list_invoices('todo')$$, '42501', null, 'AC-10: obsługa nie widzi listy faktur');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_list_invoices('all')$$, '22023', 'invalid_tab', 'AC-10: nieznana zakładka');
select is((select array_agg(id::text) from todo),
  array['00000000-0000-0000-0000-0000000024e1', '00000000-0000-0000-0000-0000000024e2'],
  'AC-10, AC-16: „Do wystawienia” — opłacone z fakturą, od najstarszej płatności; zwrócone i bez faktury pominięte');
select is((select invoice_data_source from todo limit 1), 'manual', 'AC-10: źródło danych do oznaczenia „Dane niezweryfikowane”');
select is(
  (select array_agg(id::text) from public.admin_list_invoices('todo', '2026-11-11', '2026-11-11') where item_name = 'Karnet PF'),
  array['00000000-0000-0000-0000-0000000024e1'], 'AC-15: zakres dat zapłaty w strefie Europe/Warsaw');
select lives_ok($$select public.mark_invoice_issued('00000000-0000-0000-0000-0000000024e2', 'FV 1/11/2026')$$,
  'AC-12: admin oznacza fakturę jako wystawioną');
select is((select row(invoice_number, issued_by_name, invoice_issued_at is not null)::text from issued),
  row('FV 1/11/2026', 'Adam Faktura', true)::text, 'AC-12: „Wystawione” — numer, kto i kiedy oznaczył');
select is((select count(*)::integer from todo), 1, 'AC-12: oznaczona pozycja znika z „Do wystawienia”');
select lives_ok($$select public.unmark_invoice('00000000-0000-0000-0000-0000000024e2')$$, 'AC-13: cofnięcie oznaczenia');
select is((select count(*)::integer from todo), 2, 'AC-13: pozycja wraca do „Do wystawienia”');
select is(
  (select array_agg(invoice_requested order by id) from public.admin_list_orders() where item_name = 'Karnet PF'),
  array[true, true, true, false], 'AC-14: lista zamówień pokazuje, które mają żądanie faktury');
reset role;

-- AC-16: zwrot po wystawieniu — pozycja zostaje w „Wystawione” ze statusem zwrotu.
update public.orders set invoice_number = 'FV 2/11/2026', invoice_issued_at = now()
  where id = '00000000-0000-0000-0000-0000000024e3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024a1","role":"authenticated"}', true);
set local role authenticated;
select is((select status from issued), 'refunded', 'AC-16: zwrócona wystawiona faktura widoczna w „Wystawione”');
reset role;

set local role anon;
select throws_ok($$select * from public.admin_list_invoices('todo')$$, '42501', null, 'AC-10: anonimowy bez dostępu');
reset role;

select * from finish();
rollback;
