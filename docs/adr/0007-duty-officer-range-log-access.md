# ADR-0007: Dostęp dyżurnego Prowadzącego do książki wynika z dyżuru, nie z roli

- Data: 2026-11-20
- Status: proponowana (zatwierdzenie = merge SPEC-008, decyzje 1-A…5-A w #128)

## Kontekst
SPEC-008 daje dyżurnemu Prowadzącemu z konta (rola `user`) dostęp do książki rejestru pobytu, ale tylko w czasie dyżuru
i bez zmiany dyżurnego, grafiku i sprzedaży. Dyżurnego ustala Obsługa / admin i może go zmienić w każdej chwili (SPEC-007 US-4).

## Decyzja
- Bez nowej roli w `profiles.role` i bez zapisywania uprawnienia. Dostęp liczony przy każdym zapytaniu:
  `public.is_range_duty_officer()` — wywołujący (`auth.uid()`) jest `range_officers.profile_id` prowadzącego zwracanego przez
  `range_duty_for(range_today())`; `public.can_keep_range_log()` = `is_staff() or is_range_duty_officer()`.
- `can_keep_range_log()` zastępuje `is_staff()` tylko w funkcjach i politykach potrzebnych do wpisu do książki (lista w SPEC-008 §5).
  Ustawianie dyżurnego, grafik, sprzedaż na miejscu, zatwierdzanie prowadzących i bezpośredni odczyt tabel zostają przy `is_staff()` / `is_admin()`.
- Funkcje, które działały dzięki RLS Obsługi (`passes_for_range_entry` — `security invoker` na `orders`, `user_passes`),
  przechodzą na `security definer` z jawnym warunkiem, zamiast rozszerzać polityki tabel na dyżurnego.
- Interfejs: nowy stan bramki panelu `duty` (rola `user` + `rpc/is_range_duty_officer`); claim `app_role` w JWT bez zmian.

## Konsekwencje
- Zmiana dyżurnego (książka, zawody / wydarzenie, grafik), ukrycie prowadzącego, powrót zgłoszenia do `pending` i północ
  odcinają dostęp od razu — bez wylogowania i bez zadań w tle.
- Koszt: każde zapytanie RLS dyżurnego wywołuje `range_duty_for` (kilka odczytów po kluczu) — akceptowalne przy ruchu strzelnicy;
  polityki używają `(select public.can_keep_range_log())`, więc funkcja liczy się raz na zapytanie.
- Nowe funkcje „dla Obsługi” muszą świadomie wybrać `is_staff()` albo `can_keep_range_log()` (SPEC-008 §5 jako lista kontrolna).
