-- SPEC-002 AC-1, AC-3, AC-4: potwierdzenie klauzuli przy rejestracji e-mailem (metadane konta → profil).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000044a1', 'email@example.test', '{"privacy_notice_ack": true}'),
  ('00000000-0000-0000-0000-0000000044b1', 'google@example.test', '{"full_name": "Jan Google"}'),
  ('00000000-0000-0000-0000-0000000044c1', 'fake@example.test', '{"privacy_notice_ack": "nie"}');

select ok(
  (select privacy_notice_ack_at between now() - interval '1 minute' and now()
   from public.profiles where id = '00000000-0000-0000-0000-0000000044a1'),
  'AC-1: rejestracja e-mailem z zaznaczoną klauzulą zapisuje privacy_notice_ack_at'
);
select is(
  (select privacy_notice_ack_at from public.profiles where id = '00000000-0000-0000-0000-0000000044b1'), null,
  'AC-3: konto Google bez potwierdzenia — klauzula przy pierwszym logowaniu'
);
select is(
  (select privacy_notice_ack_at from public.profiles where id = '00000000-0000-0000-0000-0000000044c1'), null,
  'AC-1: tylko wartość true oznacza potwierdzenie'
);
select is(
  (select row(role, full_name, qr_token ~ '^[A-Za-z0-9_-]{32}$')::text
   from public.profiles where id = '00000000-0000-0000-0000-0000000044a1'),
  '(user,,t)', 'AC-4: nowe konto e-mail — rola user, losowy qr_token, puste dane'
);

select * from finish();
rollback;
