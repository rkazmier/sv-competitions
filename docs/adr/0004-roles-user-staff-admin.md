# ADR-0004: Role użytkownik / obsługa / admin zamiast zawodnik / organizator

- Data: 2026-11-17
- Status: przyjęta (decyzje 2-A i 3-A w #38)

## Kontekst
Aplikacja obsługuje nie tylko zawody, ale wszystkich klientów strzelnicy (Oferta, książka rejestru pobytu — SPEC-002…005).
Potrzebna jest rola dla obsługi przy okienku, która wpisuje do książki i sprzedaje na miejscu, ale nie prowadzi kalendarza.

## Decyzja
- `profiles.role` ∈ {`user`, `staff`, `admin`}; hierarchia `admin` ⊃ `staff` ⊃ `user`. Migracja: `competitor` → `user`, `organizer` → `admin`.
- RLS używa funkcji `public.is_staff()` i `public.is_admin()` (odczyt `profiles`, `security definer`) — odebranie roli działa od razu.
  `public.is_organizer()` zostaje jako alias `is_admin()` dla istniejących polityk i `site-rebuild`; nowy kod jej nie używa.
- Claim `app_role` w JWT nadal tylko dla interfejsu.
- Role nadaje admin w panelu funkcją `set_user_role` z zapisem w `audit_log`; zawsze musi zostać co najmniej jeden admin.

## Konsekwencje
- Słownik: „Organizator” → „Admin” w panelu; „Zawodnik” to użytkownik zapisujący się na zawody (przyszła specyfikacja rejestracji).
- Bramka panelu (`web/src/lib/panel.ts`) rozróżnia menu obsługi i admina.
