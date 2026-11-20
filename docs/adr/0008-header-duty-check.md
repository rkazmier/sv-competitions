# ADR-0008: Nagłówek stron publicznych pyta bazę o dyżur (z pamięcią na dzień)

- Data: 2026-11-20
- Status: proponowana (zatwierdzenie = merge SPEC-009, #134)

## Kontekst
Nagłówek stron publicznych (`HeaderAuthLinks.astro`, SPEC-002 §6) bierze stan wyłącznie z sesji w localStorage i claimu
`app_role` — bez klienta Supabase i bez zapytań. SPEC-009 dodaje link „Książka” dla dyżurnego Prowadzącego z konta, a dyżur
nie jest rolą (ADR-0007) — zmienia się w ciągu dnia i nie ma go w JWT.

## Decyzja
- Wyjątek od „nagłówek bez zapytań”: tylko dla roli `user` z czytelną, nieprzeterminowaną sesją nagłówek wysyła jeden
  `fetch` do `POST /rest/v1/rpc/is_range_duty_officer` (token z sesji, klucz anon), bez importu `@supabase/supabase-js`.
- Wynik (`true` / `false`) trafia do `sessionStorage` (`sv-duty-link`) z `sub` i dniem Europe/Warsaw; do końca dnia w tej
  karcie nagłówek nie pyta ponownie. Błędów nie zapamiętujemy.
- Miejsca, które i tak sprawdzają dyżur (`/konto/`, bramka panelu), nadpisują tę pamięć; wylogowanie ją usuwa.
- Claim `app_role` i Custom Access Token Hook — bez zmian (dyżur nadal poza JWT, ADR-0007).

## Konsekwencje
- Najwyżej jedno zapytanie na kartę i dzień na zalogowanego użytkownika `user`; gość, Obsługa i admin — zero.
- Link może być przestarzały do końca dnia w karcie (w obie strony). Akceptowane: link nie daje dostępu, pilnują go bramka
  panelu i RLS; brakujący link naprawia wejście na `/konto/`.
- Nowe elementy nagłówka zależne od stanu spoza JWT powinny używać tego samego wzorca (pamięć z `sub` i dniem, odświeżanie w miejscach,
  które i tak pytają bazę).
