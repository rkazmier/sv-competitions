# SPEC-009: Link „Książka” w nagłówku dla dyżurnego Prowadzącego

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #134 (zmienia SPEC-008 §2 „Poza zakresem: link do książki w nagłówku strony”)
- Decyzje: ADR-0008 (nagłówek pyta bazę o dyżur, z pamięcią w `sessionStorage`)
- Zadania: #135 (sekcja 11)

## 1. Cel

Dyżurny Prowadzący z konta (SPEC-008) w dniu dyżuru ma w nagłówku stron publicznych link „Książka” → `/panel/ksiazka/`,
żeby nie musiał szukać wejścia w `/konto/` ani pamiętać adresu.

## 2. Zakres

**W zakresie:**
- Link „Książka” w nagłówku stron z `BaseLayout` (kalendarz, oferta, strony zawodów, `/konto/` itd.) dla roli `user`,
  gdy `rpc/is_range_duty_officer` = `true`.
- Lekkie sprawdzenie dyżuru z nagłówka (`fetch` do `rpc/is_range_duty_officer` z tokenem z zapisanej sesji, bez klienta Supabase)
  i zapamiętanie wyniku w `sessionStorage` na dany dzień (Europe/Warsaw) i danego użytkownika.
- Odświeżanie zapamiętanego wyniku tam, gdzie aplikacja i tak pyta o dyżur (`/konto/`, bramka panelu).

**Poza zakresem:**
- Zmiany w bazie, RLS i uprawnieniach (dostępu pilnują bramka panelu `panel.ts` i RLS — SPEC-008).
- Link „Książka” dla Obsługi i admina (mają „Panel”, a w menu panelu „Książka”) — także gdy są dyżurnymi.
- Menu panelu (`PanelLayout`) — bez zmian; stan `duty` nadal ma tylko „Książka” (SPEC-008 AC-2).
- Powiadomienia o rozpoczęciu dyżuru, odświeżanie nagłówka „na żywo” (bez przeładowania strony).
- Link dla prowadzącego bez konta (dodanego przez admina).

## 3. Role i uprawnienia

| Rola | Widzi w nagłówku | Może zmienić |
| --- | --- | --- |
| Gość | „Zaloguj się” (bez zmian) | — |
| Użytkownik (`user`), dziś nie dyżurny | „Moje konto” (bez zmian) | — |
| Użytkownik (`user`), dziś dyżurny Prowadzący | „Książka”, „Moje konto” | — (link jest tylko skrótem; dostęp sprawdza bramka panelu i baza) |
| Obsługa, admin | „Moje konto”, „Panel” (bez zmian, bez zapytania o dyżur) | — |

Nagłówek wywołuje wyłącznie istniejące `rpc/is_range_duty_officer` (zwraca tylko informację o wywołującym, `execute` dla `authenticated`).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako dyżurny Prowadzący chcę mieć link do książki w menu
- **AC-1**: Given jestem zalogowany z rolą `user` i `rpc/is_range_duty_officer` zwraca `true` When otwieram stronę publiczną (np. `/`, `/oferta/`, `/konto/`) Then w nagłówku widzę link „Książka” prowadzący do `/panel/ksiazka/`, umieszczony przed „Moje konto”.
- **AC-2**: Given rola `user` i `rpc/is_range_duty_officer` zwraca `false` When otwieram stronę publiczną Then nie widzę „Książka”; widzę „Moje konto” jak dotąd.
- **AC-3**: Given jestem gościem (brak sesji) albo sesja jest nieczytelna When otwieram stronę publiczną Then nie widzę „Książka” i nagłówek nie wysyła zapytania do bazy.
- **AC-4**: Given rola `staff` lub `admin` (claim `app_role`) When otwieram stronę publiczną Then nagłówek jest jak dotąd („Moje konto”, „Panel”), bez „Książka” i bez zapytania o dyżur.
- **AC-5**: Given zapytanie o dyżur kończy się błędem (sieć, 401 — np. wygasły token, 5xx) When nagłówek się ładuje Then nie ma „Książka”, reszta nagłówka działa, wynik **nie** jest zapamiętywany (kolejna strona pyta ponownie); bez komunikatu o błędzie.
- **AC-6**: Given „Książka” jest ukryta When strona się ładuje Then układ nagłówka nie „skacze” dla gościa i zwykłego użytkownika (link domyślnie `hidden`, jak „Panel”).

### US-2: Jako właściciel nie chcę obciążać bazy zapytaniami ze stron publicznych
- **AC-7**: Given nagłówek uzyskał wynik (`true` albo `false`) When przechodzę na kolejne strony w tej samej karcie tego samego dnia (Europe/Warsaw) Then nagłówek bierze wynik z `sessionStorage` i nie wysyła zapytania.
- **AC-8**: Given zapamiętany wynik jest z poprzedniego dnia albo dla innego użytkownika (inne `sub` w tokenie, np. po wylogowaniu i zalogowaniu na inne konto) When otwieram stronę publiczną Then nagłówek pyta bazę ponownie i nadpisuje zapamiętany wynik.
- **AC-9**: Given `/konto/` (sekcja prowadzącego, SPEC-008 AC-1) albo bramka panelu (`panel.ts`) właśnie sprawdziły `is_range_duty_officer` When wynik jest znany Then zapisują go w tej samej pamięci (ten sam klucz i format), a nagłówek tej strony pokazuje / ukrywa „Książka” zgodnie z nim — np. użytkownik, którego Obsługa ustawiła dyżurnym w ciągu dnia, dostaje link po wejściu na `/konto/`.
- **AC-10**: Given wylogowanie („Wyloguj” w `/konto/` lub w panelu) When wylogowanie się kończy Then zapamiętany wynik jest usuwany.

### US-3: Jako Obsługa chcę, żeby przestarzały link niczego nie otwierał
- **AC-11**: Given w karcie zapamiętano `true`, a dyżurny przestał nim być (zmiana dyżurnego, grafik, ukrycie, `pending`) When klika „Książka” Then trafia na `/panel/ksiazka/`, gdzie bramka panelu pokazuje stan z SPEC-008 AC-3 („Nie masz uprawnień do panelu.” + dopisek), i — zgodnie z AC-9 — zapisuje `false`, więc na kolejnych stronach publicznych linku już nie ma.

## 5. Model danych

Bez zmian w bazie. Pamięć w przeglądarce:

| Miejsce | Klucz | Wartość | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- |
| `sessionStorage` | `sv-duty-link` | JSON `{ "sub": "<uuid z tokenu>", "day": "RRRR-MM-DD", "duty": true \| false }` | identyfikator konta (pseudonim) | `day` w strefie Europe/Warsaw; znika po zamknięciu karty; usuwany przy wylogowaniu |

Wynik jest tylko podpowiedzią dla UI — nie daje żadnego dostępu.

## 6. Interfejs użytkownika

| Miejsce | Zmiana |
| --- | --- |
| `HeaderAuthLinks.astro` | Nowy element `<li data-header-auth="duty" hidden><a href="/panel/ksiazka/">Książka</a></li>` przed „Moje konto”; widoczny tylko dla stanu `user` z wynikiem `duty: true` |
| `/konto/` (`range-officer-account-ui.ts`) | Po sprawdzeniu dyżuru zapisuje wynik (AC-9) i odświeża widoczność linku w nagłówku bez przeładowania |
| Bramka panelu (`panel.ts`) | Po `rpc/is_range_duty_officer` zapisuje wynik (AC-9); przy wylogowaniu usuwa (AC-10) |
| Wylogowanie w `/konto/` (`auth-ui.ts`) | Usuwa zapamiętany wynik (AC-10) |

Logika bez DOM (odczyt `sub` i ważności tokenu, dzień w Europe/Warsaw, odczyt / zapis pamięci, decyzja „pytać czy nie”) w `web/src/lib/`
z testami Vitest; nagłówek nie importuje `@supabase/supabase-js` (zwykły `fetch` z `apikey` = `PUBLIC_SUPABASE_ANON_KEY`
i `Authorization: Bearer <access_token>`).

Teksty (i18n): `nav.rangeLog`: „Książka”.

Telefon: link jest kolejnym elementem istniejącej listy w nagłówku (zawijanie jak dziś), obszar dotyku ≥ `--tap-target`.

## 7. Przypadki brzegowe

- Wygasły `access_token` w localStorage (strona publiczna nie odświeża sesji) → nagłówek nie pyta (sprawdza `expires_at` / `exp`), linku nie ma, nic nie zapamiętuje; po wejściu na `/konto/` lub do panelu klient Supabase odświeża sesję i AC-9 zapisuje wynik.
- Użytkownik dostaje dyżur w trakcie dnia, a w karcie zapamiętano `false` → link pojawi się po wejściu na `/konto/` (AC-9), w nowej karcie albo następnego dnia. Świadomie akceptowane (koszt zapytań).
- Użytkownik traci dyżur, a w karcie zapamiętano `true` → przestarzały link; dostęp i tak blokuje bramka i RLS (AC-11).
- Północ przy otwartej karcie → przy następnym załadowaniu strony `day` się nie zgadza, nagłówek pyta ponownie (AC-8).
- Dyżurny z rolą `staff` / `admin` → bez linku „Książka”, wejście przez „Panel” (AC-4).
- `sessionStorage` niedostępny (tryb prywatny, blokada) → nagłówek pyta przy każdym załadowaniu strony, bez błędu.
- Strony panelu mają własne menu (slot `nav` w `PanelLayout`) — `HeaderAuthLinks` się tam nie renderuje, więc nie ma podwójnej „Książki”.

## 8. Integracje

Brak nowych. Supabase REST `POST /rest/v1/rpc/is_range_duty_officer` (istniejąca funkcja, SPEC-008 §5).

## 9. RODO

- Nowych danych osobowych nie zbieramy. W `sessionStorage` karty: identyfikator konta (`sub`) i informacja „dziś dyżurny tak / nie” —
  tylko w przeglądarce tej osoby, do zamknięcia karty lub wylogowania.
- Zapytanie wysyła wyłącznie token zalogowanej osoby i zwraca informację tylko o niej.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Link „Książka” w nagłówku dla dyżurnego (zmiana SPEC-008 §2) | Tak — dla roli `user`, gdy `is_range_duty_officer` = `true` | 2026-11-20 (#134) |
| Jak często nagłówek pyta bazę | Wynik w `sessionStorage` na dany dzień; przestarzały link akceptowalny (pilnują bramka i RLS) | 2026-11-20 (#134) |
| Zmiany w bazie i uprawnieniach | Brak | 2026-11-20 (#134) |

Założenia analityka (zatwierdzane razem ze specyfikacją): link przed „Moje konto”; Obsługa i admin bez linku (mają „Panel”);
pamięć powiązana z `sub` i usuwana przy wylogowaniu; `/konto/` i bramka panelu odświeżają pamięć (AC-9); błąd zapytania
nie jest zapamiętywany (AC-5); wygasły token — bez zapytania.

Otwarte: brak.

## 11. Zadania

1. #135 UI: link „Książka” w `HeaderAuthLinks.astro`, logika pamięci i sprawdzania dyżuru w `web/src/lib/` (bez DOM),
   zapis wyniku w `/konto/` i bramce panelu, czyszczenie przy wylogowaniu, tekst i18n, testy Vitest i E2E — AC-1…AC-11.
