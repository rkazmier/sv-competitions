-- SPEC-012 US-6 (AC-30…AC-34): zamknięcie strzelnicy i przedłużenie ważności uprawnień.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000039a1', 'closure-admin@example.test'),
  ('00000000-0000-0000-0000-0000000039c1', 'closure-client@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000039a1';

-- Karnet czasowy sprzedany przed 7-A — wiersz z pominięciem wyzwalacza (jak w 037_pass_blocking_test.sql).
alter table public.products disable trigger products_before_write;
insert into public.products (id, kind, name, price, entries, days, day_type) values
  ('00000000-0000-0000-0000-0000000039f1', 'entries', 'Karnet 10 wejść Z', 120000, 10, null, null),
  ('00000000-0000-0000-0000-0000000039f2', 'days', 'Karnet 3 dni Z', 30000, null, 3, null);
alter table public.products enable trigger products_before_write;
insert into public.event_categories (id, name) values ('00000000-0000-0000-0000-0000000039e0', 'Zamknięcia');
insert into public.calendar_events (id, name, category_id, starts_on, ends_on, status, access_mode, ticket_price) values
  ('00000000-0000-0000-0000-0000000039e1', 'Piknik Z', '00000000-0000-0000-0000-0000000039e0', public.range_today() + 5,
   null, 'published', 'paid', 4000);

create temp table t (name text primary key, id uuid);
grant all on t to public;
create function pg_temp.buy(p_name text, p_user uuid, p_product uuid, p_event uuid) returns void language sql as $$
  with o as (
    insert into public.orders (user_id, product_id, calendar_event_id, item_name, amount, payment_method, on_site_method)
      values (p_user, p_product, p_event, 'Pozycja ' || p_name, 4000, case when p_user is null then 'on_site' else 'tpay' end,
              case when p_user is null then 'cash' end)
      returning id
  )
  insert into t select p_name, public.fulfil_order(o.id) from o;
$$;
-- Zamknięcie testowe: od dziś−20 do dziś−11 (10 dni).
select pg_temp.buy('extended', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('days', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f2', null);
select pg_temp.buy('during', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('expired', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('after', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('used_up', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('cancelled', '00000000-0000-0000-0000-0000000039c1', '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('no_account', null, '00000000-0000-0000-0000-0000000039f1', null);
select pg_temp.buy('ticket', '00000000-0000-0000-0000-0000000039c1', null, '00000000-0000-0000-0000-0000000039e1');
update public.user_passes set created_at = now() - interval '100 days'
  where id in (select id from t where name not in ('after', 'during'));
update public.user_passes set created_at = now() - interval '15 days' where id = (select id from t where name = 'during');
-- Karnet czasowy aktywowany przed zamknięciem: `valid_until` = dziś−28; `expires_on` w przyszłości.
update public.user_passes set first_used_on = public.range_today() - 30 where id = (select id from t where name = 'days');
-- Wygasł dzień przed „Od”.
update public.user_passes set expires_on = public.range_today() - 21 where id = (select id from t where name = 'expired');
update public.user_passes set entries_left = 0 where id = (select id from t where name = 'used_up');
update public.user_passes set status = 'cancelled' where id = (select id from t where name = 'cancelled');
create temp table before as select id, expires_on, valid_until from public.user_passes where id in (select id from t);
grant all on before to public;

-- ===== AC-30, AC-31: tylko admin, walidacja okresu =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000039c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.range_closure_preview(public.range_today() - 20, public.range_today() - 11)$$,
  '42501', null, 'AC-30: klient nie widzi podglądu zamknięcia');
select throws_ok($$select public.add_range_closure(public.range_today() - 20, public.range_today() - 11, 'Remont')$$,
  '42501', null, 'AC-30: klient nie dodaje zamknięcia');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000039a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.range_closure_preview(public.range_today() - 5, public.range_today() + 5)$$,
  'P0001', 'closure_not_ended', 'AC-30: dzień „Do” nie później niż dziś');
select throws_ok($$select public.range_closure_preview(public.range_today() - 11, public.range_today() - 20)$$,
  '22023', 'invalid_closure_range', 'AC-30: „Od” nie później niż „Do”');
select throws_ok($$select public.range_closure_preview(public.range_today() - 20, public.range_today() - 14)$$,
  'P0001', 'closure_too_short', 'AC-31: 7 dni — za krótko (closure_too_short)');
select lives_ok($$select public.range_closure_preview(public.range_today() - 7, public.range_today())$$,
  'AC-31: 8 dni kończące się dziś — przyjęte');
select is(public.range_closure_preview(public.range_today() - 20, public.range_today() - 11),
  '{"days": 10, "passes_count": 3}'::jsonb, 'AC-30: podgląd — 10 dni, 3 uprawnienia');
select throws_ok($$select public.add_range_closure(public.range_today() - 20, public.range_today() - 11, ' ab ')$$,
  '22023', 'invalid_closure_reason', 'AC-30: przyczyna co najmniej 3 znaki');
select throws_ok($$select public.add_range_closure(public.range_today() - 20, public.range_today() - 11, repeat('x', 201))$$,
  '22023', 'invalid_closure_reason', 'AC-30: przyczyna najwyżej 200 znaków');

-- ===== AC-32: zapis i przedłużenie =====

select is(public.add_range_closure(public.range_today() - 20, public.range_today() - 11, ' Remont kulochwytu ') - 'id',
  '{"days": 10, "passes_count": 3}'::jsonb, 'AC-32: zapisano — 10 dni, 3 uprawnienia');
reset role;

select is((select p.expires_on - b.expires_on from public.user_passes p join before b using (id)
            where p.id = (select id from t where name = 'extended')), 10, 'AC-32: karnet ilościowy — expires_on += 10');
select is((select p.expires_on - b.expires_on from public.user_passes p join before b using (id)
            where p.id = (select id from t where name = 'during')), 10, 'AC-32: kupiony w trakcie zamknięcia — pełne N dni (§7)');
select is((select row(p.expires_on - b.expires_on, p.valid_until = b.valid_until)::text from public.user_passes p
            join before b using (id) where p.id = (select id from t where name = 'days')),
  row(10, true)::text, 'AC-32: karnet czasowy — expires_on += 10, valid_until bez zmian (7-A)');
select is((select count(*)::int from public.user_passes p join before b using (id) where p.expires_on <> b.expires_on
            and p.id in (select id from t where name in ('expired', 'after', 'used_up', 'cancelled', 'no_account', 'ticket'))),
  0, 'AC-32: bez zmian — wygasłe przed „Od”, kupione po „Do”, used_up, cancelled, bez konta, wejściówka');
select is((select array_agg(cp.expires_on_before = b.expires_on order by cp.user_pass_id) from public.range_closure_passes cp
            join before b on b.id = cp.user_pass_id),
  array[true, true, true], 'AC-32: ślad w range_closure_passes z expires_on przed przedłużeniem');
select is((select row(action, actor_id, changes - 'closure_id')::text from public.audit_log where action = 'range_closure'),
  row('range_closure', '00000000-0000-0000-0000-0000000039a1'::uuid,
      jsonb_build_object('starts_on', public.range_today() - 20, 'ends_on', public.range_today() - 11, 'days', 10,
                         'passes_count', 3))::text,
  'AC-32: jeden wpis audit_log range_closure (okres, N, liczba uprawnień)');
select is((select row(reason, days, passes_count, created_by)::text from public.range_closures),
  row('Remont kulochwytu', 10, 3, '00000000-0000-0000-0000-0000000039a1'::uuid)::text,
  'AC-34: zamknięcie zapisane z przyczyną, dniami, liczbą uprawnień i autorem');

-- ===== AC-31: nakładanie =====

set local role authenticated;
select throws_ok($$select public.range_closure_preview(public.range_today() - 30, public.range_today() - 20)$$,
  'P0001', 'closure_overlap', 'AC-31: podgląd — okres nakłada się na zapisane zamknięcie');
select throws_ok($$select public.add_range_closure(public.range_today() - 12, public.range_today() - 1, 'Powódź')$$,
  'P0001', 'closure_overlap', 'AC-31: zapis — okres nakłada się na zapisane zamknięcie');
select lives_ok($$select public.range_closure_preview(public.range_today() - 10, public.range_today() - 1)$$,
  'AC-31: okres zaczynający się dzień po „Do” się nie nakłada');

-- ===== AC-34: lista tylko do odczytu, RLS =====

select is((select count(*)::int from public.range_closures), 1, 'AC-34: admin widzi zamknięcia');
select throws_ok($$update public.range_closures set reason = 'Zmiana'$$, '42501', null, 'AC-34: bez edycji');
select throws_ok($$delete from public.range_closures$$, '42501', null, 'AC-34: bez usuwania');
select throws_ok($$insert into public.range_closures (starts_on, ends_on, reason, days)
  values (public.range_today() - 60, public.range_today() - 50, 'Bez funkcji', 11)$$,
  '42501', null, 'AC-32: zapis wyłącznie przez add_range_closure');
reset role;

-- ===== AC-33: przedłużenia w danych /konto/ =====

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000039c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.range_closures), 0, 'AC-34: klient nie widzi zamknięć (przyczyna tylko dla admina)');
select is((select array_agg(row(days, starts_on, ends_on)::text) from public.my_pass_extensions()),
  array_fill(row(10, public.range_today() - 20, public.range_today() - 11)::text, array[3]),
  'AC-33: klient widzi przedłużenia swoich uprawnień (dni i okres zamknięcia)');
reset role;

select * from finish();
rollback;
