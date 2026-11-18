# SPEC-006: Numer zamówienia

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #98 (z decyzji w PR #97, pytanie 2-B)
- Zadania: #99, #100 (kolejność w sekcji 11)
- Powiązane: SPEC-003 (zamówienia, Tpay), SPEC-004 (panel faktur, AC-11, AC-15), ADR-0005

## 1. Cel

Dziś numer zamówienia to `orders.id` (UUID), np. `3f2b8c1e-…`. Trudno go przepisać do e-mikrofirmy, podać przez telefon
albo znaleźć w panelu. Każde zamówienie dostaje krótki, czytelny **numer zamówienia** w formacie `SV-2026-000123`.
Klient i admin posługują się tym samym numerem: w panelu, w historii płatności, w tytule transakcji Tpay i w banku.

## 2. Zakres

**W zakresie:**
- Kolumna `orders.order_number`, nadawana automatycznie przy utworzeniu zamówienia (każdy sposób: Tpay, sprzedaż na miejscu).
- Nadanie numerów wszystkim istniejącym zamówieniom w kolejności utworzenia (jednorazowo w migracji, decyzja 2-A).
- Numer widoczny wszędzie, gdzie dziś jest numer zamówienia (decyzja 3-A): panel faktur (pole „Kopiuj” i CSV),
  `/panel/zamowienia/` (kolumna, szczegóły, CSV, wyszukiwanie), „Historia płatności” w `/konto/`, `/konto/platnosc/`,
  „Dzisiejsza sprzedaż na miejscu” w `/panel/sprzedaz/`, tytuł transakcji Tpay.

**Poza zakresem:**
- Numeracja faktur — prowadzi e-mikrofirma (ADR-0005). Numer zamówienia nie jest numerem faktury.
- Usunięcie UUID: `orders.id` zostaje kluczem głównym, w adresach stron (`/konto/platnosc/?order=<uuid>`),
  w `hiddenDescription` / `tr_crc` Tpay i w powiązaniach tabel.
- Ciągłość numeracji bez luk (decyzja 1-A: luki są dopuszczalne).
- E-maile wysyłane przez aplikację — aplikacja ich nie wysyła (SPEC-004, 11-A).

## 3. Role i uprawnienia

Numer zamówienia nie jest daną osobową. Widzą go te same osoby, które widzą zamówienie (RLS `orders` bez zmian).

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Użytkownik | Numery własnych zamówień | — |
| Obsługa | Numery zamówień (dzisiejsza sprzedaż na miejscu, odczyt `orders`) | — |
| Admin | Numery wszystkich zamówień, wyszukiwanie po numerze | — |

Numeru nie zmienia nikt, także admin i klucz secret (wyzwalacz blokuje `update` kolumny).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako admin chcę, aby każde zamówienie miało krótki numer
- **AC-1**: Given tworzone jest nowe zamówienie (Tpay — `create_tpay_order`, na miejscu — `create_on_site_order`, każdy `insert` do `orders`)
  When wiersz jest zapisywany Then dostaje `order_number` = `SV-` + rok daty utworzenia (Europe/Warsaw) + `-` + kolejny numer
  z jednej sekwencji, uzupełniony zerami do 6 cyfr, np. `SV-2026-000123`.
- **AC-2**: Given licznik przekroczy 999999 When powstaje zamówienie Then numer ma więcej cyfr (`SV-2031-1000000`) — bez błędu.
- **AC-3**: Given rok się zmienia (1 stycznia) When powstaje zamówienie Then zmienia się tylko rok; licznik nie wraca do 1
  (decyzja 1-A), np. `SV-2026-000980` → `SV-2027-000981`.
- **AC-4**: Given zamówienie istnieje When ktokolwiek (także `service_role`) próbuje zmienić `order_number` Then baza odrzuca zmianę
  błędem `order_number_immutable`. Numer jest unikalny (`unique`) i wymagany (`not null`).
- **AC-5**: Given zamówienie zostało anulowane (np. nieopłacone po 24 h) lub transakcja nie powstała When patrzę na numerację
  Then jego numer nie jest używany ponownie; w numeracji może być luka.

### US-2: Jako admin chcę mieć numery także przy starych zamówieniach
- **AC-6**: Given w bazie są zamówienia sprzed zmiany When wykonuje się migracja Then każde dostaje numer w kolejności
  `created_at`, a przy równym czasie `id` — od `000001`, z rokiem jego daty utworzenia (Europe/Warsaw); sekwencja
  kontynuuje od następnego numeru. Migracja działa też na pustej tabeli.

### US-3: Jako admin chcę przepisać numer zamówienia do faktury
- **AC-7**: Given `/panel/faktury/` When rozwijam pozycję Then pole „Numer zamówienia” (z przyciskiem „Kopiuj”) zawiera
  `order_number` zamiast UUID (zmiana SPEC-004 AC-11); numer widać też w nagłówku pozycji obok daty zapłaty.
- **AC-8**: Given eksport CSV z panelu faktur When pobieram plik Then kolumna „Numer zamówienia” zawiera `order_number`
  (zmiana SPEC-004 AC-15).

### US-4: Jako admin chcę znaleźć zamówienie po numerze
- **AC-9**: Given `/panel/zamowienia/` When patrzę na listę i szczegóły Then widzę kolumnę „Nr zamówienia”; eksport CSV
  zamówień ma kolumnę „Numer zamówienia” (pierwsza kolumna).
- **AC-10**: Given filtr „Osoba” (pole tekstowe) ma teraz etykietę „Osoba lub nr zamówienia” When wpisuję numer w formie
  `SV-2026-000123`, `sv-2026-123` albo `SV-2026-123` (wielkość liter, spacje na brzegach i zera wiodące bez znaczenia)
  Then widzę tylko to zamówienie, niezależnie od pozostałych filtrów (także zakresu dat), i komunikat
  „Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.”; gdy numeru nie ma — „Brak zamówienia o tym numerze.”.
- **AC-11**: Given w polu jest tekst, który nie ma formy numeru When filtruję Then wyszukiwanie po osobie działa jak dotąd (SPEC-003 AC-24).

### US-5: Jako klient chcę widzieć numer swojego zamówienia
- **AC-12**: Given `/konto/` When patrzę na „Historia płatności” Then przy każdym zamówieniu widzę „Nr: SV-2026-000123”
  (zmiana SPEC-003 AC-13).
- **AC-13**: Given wracam z Tpay na `/konto/platnosc/?order=<uuid>` When strona pokazuje status Then widzę też
  „Zamówienie SV-2026-000123”.
- **AC-14**: Given płacę online When `payments-create` tworzy transakcję Tpay Then `description` = `SV-2026-000123 — <item_name>`
  (półpauza ze spacjami), skrócone do limitu pola Tpay (128 znaków): skraca się `item_name`, z końcówką `…`; numer nigdy nie jest
  skracany. `hiddenDescription` zostaje = `orders.id` (dopasowanie powiadomienia `tr_crc` bez zmian). Zmiana SPEC-003 §8 („SV <nr zamówienia>”).

### US-6: Jako obsługa chcę widzieć numer przy sprzedaży na miejscu
- **AC-15**: Given `/panel/sprzedaz/` When patrzę na „Dzisiejsza sprzedaż na miejscu” Then każdy wiersz ma kolumnę „Nr zamówienia”;
  po „Zarejestruj sprzedaż” komunikat sukcesu zawiera numer: „Sprzedaż zarejestrowana: SV-2026-000123.”.

## 5. Model danych

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `orders` (zmiana) | `order_number` | `text` `unique` | tak (`not null`) | nie | `check (order_number ~ '^SV-[0-9]{4}-[0-9]{6,}$')`; nadaje wyzwalacz |
| sekwencja | `order_number_seq` | `bigint` | — | — | jedna, ciągła, bez cyklu; `nextval` tylko w wyzwalaczu |

- Wyzwalacz `orders_before_insert_number` (`before insert`, funkcja `security definer`, `search_path = ''`): ignoruje wartość
  podaną przez klienta i ustawia `'SV-' || to_char(created_at at time zone 'Europe/Warsaw', 'YYYY') || '-' || lpad(n::text, 6, '0')`
  (dla `n ≥ 1000000` bez `lpad`).
- Wyzwalacz `orders_before_update_number` (`before update of order_number`): gdy wartość się zmienia → `order_number_immutable`.
- Migracja (AC-6): dodanie kolumny jako `null`, nadanie numerów (`row_number() over (order by created_at, id)`), `setval`
  sekwencji na `max` (albo `setval(…, 1, false)` dla pustej tabeli), potem `not null`, `unique`, `check`, wyzwalacze.
- Funkcje do zmiany (zwracają dodatkowo `order_number`; zmiana typu wyniku wymaga `drop` + `create` i ponownych `grant`):
  `admin_list_invoices`, `admin_list_orders` (+ wyszukiwanie po numerze, AC-10), `staff_on_site_sales_today`.
  `create_tpay_order` dodaje `order_number` do zwracanego `jsonb` (dla `payments-create`, także przy `duplicate`); `create_on_site_order` zwraca `uuid` jak dziś —
  numer UI czyta z odpowiedzi `staff_on_site_sales_today` albo osobnym `select` (do wyboru Implementatora).
- Normalizacja wyszukiwania (AC-10) w bazie: `upper(trim(p))` pasujące do `^SV-[0-9]{4}-[0-9]+$` → porównanie z numerem
  po uzupełnieniu części liczbowej zerami do 6 cyfr. Ta sama logika w `src/lib/` (bez DOM) do rozpoznania formy w UI.

Stany zamówień bez zmian (SPEC-003 §5).

## 6. Interfejs użytkownika

| Adres | Zmiana | Teksty (PL) |
| --- | --- | --- |
| `/panel/faktury/` | Pole „Numer zamówienia” = `order_number`; numer w nagłówku pozycji; CSV (AC-7, AC-8) | bez nowych |
| `/panel/zamowienia/` | Kolumna, szczegóły, CSV, filtr „Osoba lub nr zamówienia” (AC-9…AC-11) | „Nr zamówienia”, „Osoba lub nr zamówienia”, „Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.”, „Brak zamówienia o tym numerze.” |
| `/konto/` | „Nr: …” w „Historii płatności” (AC-12) | „Nr: {number}” |
| `/konto/platnosc/` | „Zamówienie …” (AC-13) | „Zamówienie {number}” |
| `/panel/sprzedaz/` | Kolumna i komunikat po sprzedaży (AC-15) | „Nr zamówienia”, „Sprzedaż zarejestrowana: {number}.” |

Teksty w plikach i18n. Na telefonie numer nie może się łamać (`white-space: nowrap`); w tabelach kolumna może być pierwszą
widoczną po przewinięciu w poziomie.

## 7. Przypadki brzegowe

- Zamówienie utworzone 31.12 o 23:59, opłacone 1.01 → numer ma rok utworzenia (np. `SV-2026-…`), data sprzedaży na fakturze
  = data zapłaty (SPEC-004 AC-11). To dopuszczalne: numer zamówienia nie jest numerem faktury.
- Rok wyznaczany w Europe/Warsaw, nie UTC (zamówienie 1.01 o 00:30 czasu polskiego ma nowy rok).
- Równoległe zamówienia → sekwencja daje różne numery bez blokad; transakcja wycofana zostawia lukę (AC-5).
- Ponowne „Zapłać” przy istniejącym `pending` (`duplicate` w `payments-create`) → ten sam numer, bez nowego.
- Klient próbuje podać `order_number` w `insert` → klient nie ma prawa `insert` do `orders` (RLS); i tak wyzwalacz nadpisuje wartość.
- Wyszukiwanie po numerze innego formatu (sam UUID, sama liczba „123”) → traktowane jak tekst osoby (AC-11).
- Usunięcie konta → zamówienia zostają z `user_id = null` i swoim numerem (SPEC-003).
- Odtworzenie bazy (`supabase db reset`) → numeracja od `000001` — dotyczy tylko środowisk lokalnych.

## 8. Integracje

- **Tpay Open API** — `payments-create`: `description` = `<order_number> — <item_name>` (AC-14), `hiddenDescription` = `orders.id`
  bez zmian. Implementator potwierdza limit długości pola `description` w dokumentacji Tpay; jeśli jest inny niż 128 znaków,
  stosuje limit z dokumentacji i opisuje to w PR. `payments-notify` i `payments-refund` — bez zmian (dopasowanie po `tr_crc` = UUID).
- **e-mikrofirma** — bez integracji; admin kopiuje `order_number` z panelu faktur.

## 9. RODO

Numer zamówienia nie zawiera danych osobowych (rok i licznik). Nie zmienia zakresu zbieranych danych ani okresów
przechowywania (SPEC-003 §9, SPEC-004 §9). Tytuł transakcji w Tpay i banku zawiera numer i nazwę produktu — jak dotąd zawierał UUID.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Numer zamówienia w panelu faktur | PR #97, pytanie 2-B: na razie UUID, krótki numer — osobne issue (#98) | 2026-11-18 |
| Format numeru | 1-A: `SV-RRRR-NNNNNN`, rok zakupu, licznik ciągły (bez zerowania), luki dopuszczalne | 2026-11-18 |
| Istniejące zamówienia | 2-A: numery dla wszystkich, w kolejności utworzenia, w migracji | 2026-11-18 |
| Gdzie numer jest widoczny | 3-A: panel faktur i CSV, `/panel/zamowienia/` (z wyszukiwaniem), `/konto/`, sprzedaż na miejscu, tytuł Tpay | 2026-11-18 |

Założenia analityka (zatwierdzane razem ze specyfikacją): rok = rok utworzenia zamówienia w Europe/Warsaw (numer jest
potrzebny już przy tworzeniu transakcji Tpay, przed zapłatą); 6 cyfr z zerami wiodącymi; wyszukiwanie po pełnym numerze
pomija pozostałe filtry; numer widoczny także na `/konto/platnosc/` i w komunikacie po sprzedaży na miejscu.

Otwarte: brak.

## 11. Zadania

1. #99 Baza i Tpay: kolumna `order_number`, sekwencja, wyzwalacze, nadanie numerów istniejącym, zmiany `admin_list_invoices`,
   `admin_list_orders` (wyszukiwanie), `staff_on_site_sales_today`, `create_tpay_order`; `description` w `payments-create`;
   testy pgTAP i Deno (AC-1…AC-6, AC-10 w bazie, AC-14).
2. #100 Interfejs: panel faktur i CSV, `/panel/zamowienia/` (kolumna, CSV, filtr), `/konto/`, `/konto/platnosc/`, `/panel/sprzedaz/`;
   testy Vitest i Playwright (AC-7…AC-13, AC-15).
