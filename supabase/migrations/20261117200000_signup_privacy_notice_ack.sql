-- SPEC-002 AC-1, AC-4, §9: rejestracja e-mailem wymaga potwierdzenia klauzuli informacyjnej w formularzu.
-- Formularz przekazuje `privacy_notice_ack: true` w metadanych konta (signUp → raw_user_meta_data);
-- wyzwalacz zapisuje czas potwierdzenia w profilu. Konta Google nie mają tej flagi — potwierdzają klauzulę
-- przy pierwszym logowaniu na /konto/ (AC-3, uprawnienie kolumnowe `privacy_notice_ack_at`).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, privacy_notice_ack_at)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'privacy_notice_ack' = 'true' then now() end
  );
  return new;
end;
$$;
