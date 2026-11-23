# SPEC-003: Oferta — karnety, wejścia, wejściówki i płatności

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #38 (etap 2 z 4; wymaga SPEC-002)
- Zadania: #47, #48, #49, #50, #51, #52, #53 (kolejność w sekcji 11); dla właściciela: #39 (regulamin sprzedaży) (`owner-task`)
- Decyzje: ADR-0002 (Tpay), ADR-0006 (zadania cykliczne)
- Zmiany: SPEC-012 (#152) — regulamin sprzedaży: e-maile, zgoda 14 dni, odstąpienie i zwrot częściowy, odwołanie wydarzenia, przedłużenie ważności, blokada karnetów w dniach wydarzeń

## 1. Cel

Klient kupuje online (Tpay) karnety i wejścia na strzelnicę oraz wejściówki na własne wydarzenia Steel Valley;
obsługa rejestruje sprzedaż na miejscu (gotówka / terminal). Każdy zakup tworzy **uprawnienie** (`user_pass`),
które zużywa wpis do książki rejestru pobytu (SPEC-005).

## 2. Zakres

**W zakresie:**
- Produkty i ceny prowadzone przez admina: karnet ilościowy, karnet czasowy, wejście jednorazowe (weekend / dzień powszedni).
- Wejściówki na wydarzenia: tryb wydarzenia (płatne / bezpłatne / zewnętrzne), cena, limit miejsc.
- Zamówienie = jeden produkt, ilość 1 (decyzja 9-A). Płatność Tpay albo „na miejscu”.
- Uprawnienia użytkownika: ważność 1 rok od zakupu, aktywacja karnetu czasowego, licznik wejść.
- Panel użytkownika: aktywne karnety, historia płatności, „Przedłuż karnet”.
- Panel: produkty, sprzedaż na miejscu (także osobie bez konta — decyzja 10-A), zamówienia, anulowanie i zwrot (decyzja 6-A).
- Regulamin sprzedaży: tekst zastępczy do czasu dostarczenia przez właściciela (12-A).

**Poza zakresem:**
- Faktury → SPEC-004 (tu tylko miejsce na checkbox w podsumowaniu zamówienia).
- Zużywanie uprawnień i wybór uprawnienia przy wpisie → SPEC-005 (tu: model i reguły ważności).
- Koszyk, ilość > 1, kody rabatowe, karnety na inną osobę (decyzja 8-A: karnet imienny).
- Własne e-maile (11-A: potwierdzenie płatności wysyła Tpay) — od SPEC-012 potwierdzenie zamówienia wysyła aplikacja. Paragony / kasa fiskalna.
- Zwrot częściowo wykorzystanego karnetu (6-A) — od SPEC-012 w oknie 14 dni (odstąpienie). Przedłużanie ważności karnetu — od SPEC-012 przy zamknięciu strzelnicy.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Gość | `/oferta/` (aktywne produkty z cenami), cenę i dostępność wejściówek na kartach wydarzeń | — (zakup wymaga logowania) |
| Użytkownik | Własne zamówienia i uprawnienia | Tworzy zamówienie Tpay dla siebie |
| Obsługa | Uprawnienia i zamówienia osoby obsługiwanej, listę dzisiejszej sprzedaży na miejscu | Tworzy zamówienie „na miejscu” (opłacone) |
| Admin | Wszystkie produkty, zamówienia, uprawnienia | Produkty i ceny, tryb i cena wydarzeń, anulowanie i zwrot |

Status zamówienia Tpay zmienia wyłącznie `payments-notify` (CLAUDE.md, ADR-0002). Zamówienie „na miejscu” powstaje od razu jako opłacone (funkcja bazy, tylko `is_staff()`).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako admin chcę prowadzić produkty i ceny
- **AC-1**: Given `/panel/oferta/` When dodaję produkt: Rodzaj* (Karnet ilościowy / Karnet czasowy / Wejście jednorazowe), Nazwa*, Cena* (zł, do grosza),
  Liczba wejść* (ilościowy, 1–100) albo Liczba dni* (czasowy, 1–366) albo Dzień* (Weekend / Dzień powszedni — jednorazowe), Opis (maks. 500 znaków) Then produkt pojawia się na liście jako ukryty.
- **AC-2**: Given produkt When klikam „Pokaż w ofercie” / „Ukryj” Then pojawia się / znika z `/oferta/`; produktów nie da się usunąć.
- **AC-3**: Given produkt z zamówieniami When zmieniam cenę lub nazwę Then istniejące zamówienia i uprawnienia zachowują swoje wartości (kopie w zamówieniu); rodzaju, liczby wejść/dni i dnia nie da się zmienić, gdy istnieje zamówienie („Utwórz nowy produkt i ukryj ten.”).
- **AC-4**: Given lista produktów When ustawiam kolejność (strzałki góra/dół) Then w tej kolejności produkty są wyświetlane w swojej grupie w `/oferta/`.

### US-2: Jako klient chcę kupić karnet lub wejście online
- **AC-5**: Given `/oferta/` When otwieram stronę Then widzę grupy „Karnety ilościowe”, „Karnety czasowe”, „Wejścia jednorazowe” z nazwą, ceną (`120,00 zł`), opisem i informacją „Ważny 1 rok od zakupu.”; karnet czasowy dodatkowo „Odliczanie dni zaczyna się od pierwszego wejścia.”; wejście jednorazowe „Tylko w soboty i niedziele.” / „Tylko od poniedziałku do piątku.”.
- **AC-6**: Given jestem niezalogowany When klikam „Kup” Then trafiam do `/logowanie/?next=/oferta/zamowienie/?product=<id>`.
> Od SPEC-012: checkbox z datą wersji regulaminu, zgoda na korzystanie przed upływem 14 dni, przycisk „Zamawiam i płacę 120,00 zł” (SPEC-012 AC-1…AC-8).

- **AC-7**: Given jestem zalogowany When klikam „Kup” Then widzę podsumowanie: produkt, cena, ważność, checkbox „Akceptuję regulamin sprzedaży”* (link do tekstu), miejsce na „Potrzebuję faktury” (SPEC-004) i przycisk „Zapłać 120,00 zł”.
- **AC-8**: Given podsumowanie When klikam „Zapłać” Then Edge Function `payments-create` tworzy zamówienie `pending` (cena z bazy, nie z przeglądarki) i transakcję Tpay, a ja jestem przekierowany na bramkę Tpay.
- **AC-9**: Given zapłaciłam/zapłaciłem When `payments-notify` otrzyma poprawne powiadomienie (JWS, kwota, idempotencja — ADR-0002) Then w jednej transakcji bazy zamówienie przechodzi w `paid` i powstaje uprawnienie (`user_pass`) z `expires_on` = data zakupu + 1 rok.
- **AC-10**: Given wracam z Tpay na `/konto/platnosc/?order=<id>` When status to jeszcze `pending` Then widzę „Czekamy na potwierdzenie płatności…” (odświeżanie co 3 s przez maks. 60 s, potem „Potwierdzenie może potrwać kilka minut. Sprawdź „Moje konto”.”); po `paid` — „Płatność przyjęta. Karnet jest aktywny w Twoim koncie.”.
- **AC-11**: Given zamówienie `pending` bez płatności When minie 24 h Then zadanie cykliczne zmienia je na `cancelled` (ADR-0006); w historii widać „Nieopłacone — anulowane”.

### US-3: Jako klient chcę widzieć swoje karnety i płatności
- **AC-12**: Given `/konto/` When mam uprawnienia Then sekcja „Twoje karnety” pokazuje aktywne: nazwę, pozostałe wejścia (`7 z 10`), datę pierwszego użycia, „Ważny do” (czasowy aktywowany: ostatni dzień ważności; pozostałe: `expires_on`); nieaktywowany czasowy — „Nieaktywny — dni liczą się od pierwszego wejścia”.
- **AC-13**: Given `/konto/` When patrzę na „Historia płatności” Then widzę zamówienia (data, produkt, kwota, metoda „Online” / „Na miejscu”, status „Opłacone” / „Oczekuje” / „Anulowane” / „Zwrot w toku” / „Zwrócone”), od najnowszych.
- **AC-14**: Given `/konto/` When klikam „Przedłuż karnet” Then trafiam do `/oferta/`.
- **AC-15**: Given uprawnienie wykorzystane, wygasłe albo anulowane When otwieram `/konto/` Then nie ma go w „Twoje karnety”, jest w „Historia karnetów” (zwinięta lista).

### US-4: Jako admin chcę sprzedawać wejściówki na własne wydarzenia (decyzja 7-A)
- **AC-16**: Given formularz wydarzenia (SPEC-001 AC-48) When wybieram Tryb: „Zewnętrzne — organizator rozlicza u siebie” / „Otwarte, bezpłatne” / „Płatne przez Ofertę” Then: zewnętrzne — link wymagany do publikacji (jak dziś); bezpłatne i płatne — link opcjonalny; płatne — Cena* i Limit miejsc (opcjonalny, 1–1000).
- **AC-17**: Given opublikowane płatne wydarzenie When gość ogląda kalendarz Then karta pokazuje „Wejściówka: 50,00 zł” i przycisk „Kup wejściówkę” (→ `/oferta/zamowienie/?event=<id>`, zakup jak AC-6…AC-10); przy limicie także „Wolne miejsca: 12” (pobierane w przeglądarce, nie przy budowaniu).
- **AC-18**: Given limit miejsc When liczba zamówień `paid` + `pending` młodszych niż 30 min osiągnie limit Then przycisk zmienia się na „Wyprzedane”, a `payments-create` odrzuca nowe zamówienie (sprawdzenie z blokadą wiersza wydarzenia).
- **AC-19**: Given wydarzenie płatne When minął jego ostatni dzień (Europe/Warsaw) Then sprzedaż jest zamknięta („Sprzedaż zakończona.”); wejściówka ważna tylko w dniach wydarzenia.
- **AC-20**: Given płatne wydarzenie ma opłacone wejściówki When admin próbuje zmienić tryb, cenę lub usunąć wydarzenie Then widzi „Wydarzenie ma sprzedane wejściówki — zmiana niedostępna.”; zmiana opisu, nazwy, limitu (nie poniżej liczby sprzedanych) jest dozwolona.

### US-5: Jako obsługa chcę zarejestrować sprzedaż na miejscu
- **AC-21**: Given `/panel/sprzedaz/` When wybieram osobę (skan kodu QR, wyszukanie po imieniu i nazwisku lub e-mailu), produkt lub wejściówkę i „Gotówka” / „Terminal”, a potem „Zarejestruj sprzedaż” Then powstaje zamówienie `on_site` w stanie `paid`, z `created_by` = ja, i uprawnienie dla tej osoby.
- **AC-22**: Given osoba bez konta (decyzja 10-A) When wybieram „Osoba bez konta” Then mogę sprzedać tylko wejście jednorazowe pasujące do dzisiejszego dnia lub wejściówkę na dzisiejsze wydarzenie; zamówienie nie zawiera danych osoby (`user_id = null`), a uprawnienie bez właściciela czeka na wpis do książki w tym samym przebiegu (SPEC-005) i wygasa z końcem dnia.
- **AC-23**: Given `/panel/sprzedaz/` When patrzę na „Dzisiejsza sprzedaż na miejscu” Then widzę listę (godzina, produkt, kwota, gotówka/terminal, kto sprzedał) i sumy dla gotówki i terminala.

### US-6: Jako admin chcę przeglądać zamówienia, anulować i zwracać (decyzja 6-A)
- **AC-24**: Given `/panel/zamowienia/` When filtruję (zakres dat, status, metoda, produkt, osoba) Then widzę listę z sumą kwot; eksport CSV bieżącego widoku.
> Od SPEC-012: w oknie 14 dni od opłacenia zamówienia online karnetu — „Odstąpienie od umowy” ze zwrotem proporcjonalnym, także po użyciu (SPEC-012 AC-15…AC-20);
> po oknie regulamin nie przewiduje zwrotu, „Anuluj i zwróć” zostaje jako decyzja admina z wymaganą notatką (SPEC-012 AC-21, AC-22).

- **AC-25**: Given zamówienie `paid`, którego uprawnienie nie ma żadnego zużycia When klikam „Anuluj i zwróć” i potwierdzam Then uprawnienie przechodzi w `cancelled`; dla Tpay Edge Function `payments-refund` zleca zwrot pełnej kwoty, zamówienie → `refund_pending`, po powiadomieniu Tpay → `refunded`; dla „na miejscu” → od razu `refunded` z adnotacją „Zwrot gotówki / na terminal”.
- **AC-26**: Given uprawnienie ma co najmniej jedno zużycie When otwieram zamówienie Then przycisku „Anuluj i zwróć” nie ma; widzę „Karnet był używany — zwrot poza systemem.”.
- **AC-27**: Given każda operacja anulowania/zwrotu When zostanie wykonana Then `audit_log` zapisuje `order_refund` (kto, kiedy, zamówienie, kwota).

## 5. Model danych

Kwoty w groszach (`integer`), waluta `PLN`. Daty ważności jako `date` w czasie lokalnym strzelnicy (Europe/Warsaw).
Okres ważności uprawnienia: stała `public.pass_validity()` = `interval '1 year'` (zmiana przez PR).

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `products` | `id` | `uuid` PK | tak | nie | |
| | `kind` | `text` check in (`entries`, `days`, `single_entry`) | tak | nie | karnet ilościowy / czasowy / wejście jednorazowe |
| | `name` | `text` | tak | nie | 1–100 znaków |
| | `description` | `text` | nie | nie | maks. 500 znaków |
| | `price` | `integer` | tak | nie | grosze, 1–1 000 000 |
| | `entries` | `integer` | dla `entries` | nie | 1–100 |
| | `days` | `integer` | dla `days` | nie | 1–366 |
| | `day_type` | `text` check in (`weekend`, `weekday`) | dla `single_entry` | nie | |
| | `is_active` | `boolean` | tak | nie | domyślnie `false` |
| | `position` | `integer` | tak | nie | kolejność w grupie |
| | `created_at`, `updated_at` | `timestamptz` | tak | nie | |
| `calendar_events` (zmiana) | `access_mode` | `text` check in (`external`, `free`, `paid`) | tak | nie | domyślnie `external` (dotychczasowe wydarzenia) |
| | `ticket_price` | `integer` | dla `paid` | nie | grosze |
| | `capacity` | `integer` | nie | nie | 1–1000; `null` = bez limitu |
| | | | | | `check` publikacji: `external` ⇒ `external_url` niepuste; `paid` ⇒ `ticket_price` niepuste |
| `orders` | `id` | `uuid` PK | tak | nie | |
| | `user_id` | `uuid` FK → `profiles.id` on delete set null | nie | tak | `null`: osoba bez konta albo usunięte konto |
| | `product_id` | `uuid` FK → `products.id` on delete restrict | nie | nie | dokładnie jedno z `product_id`, `calendar_event_id` |
| | `calendar_event_id` | `uuid` FK → `calendar_events.id` on delete restrict | nie | nie | wejściówka |
| | `item_name` | `text` | tak | nie | kopia nazwy produktu / „Wejściówka: <nazwa wydarzenia>” |
| | `amount` | `integer` | tak | nie | kopia ceny w chwili zamówienia; `0` tylko dla `gift` (SPEC-010) |
| | `currency` | `text` | tak | nie | `PLN` |
| | `payment_method` | `text` check in (`tpay`, `on_site`) | tak | nie | + `gift` (prezent) — SPEC-010 |
| | `on_site_method` | `text` check in (`cash`, `terminal`) | dla `on_site` | nie | |
| | `status` | `text` check in (`pending`, `paid`, `cancelled`, `refund_pending`, `refunded`) | tak | nie | stany poniżej |
| | `tpay_transaction_id` | `text` unikalny | nie | nie | |
| | `tpay_title` | `text` | nie | nie | tytuł transakcji Tpay |
| | `paid_at`, `cancelled_at`, `refunded_at` | `timestamptz` | nie | nie | |
| | `refund_note` | `text` | nie | nie | maks. 300 znaków |
| | `created_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | obsługa przy `on_site` |
| | `created_at` | `timestamptz` | tak | nie | |
| `payment_notifications` | `id`, `tpay_transaction_id`, `payload_hash` unikalny, `received_at`, `result` | | tak | nie | idempotencja `payments-notify` (bez danych kart; payload bez danych osobowych płatnika) |
| `user_passes` | `id` | `uuid` PK | tak | nie | uprawnienie |
| | `user_id` | `uuid` FK → `profiles.id` on delete cascade | nie | tak | `null` tylko dla sprzedaży osobie bez konta (AC-22) |
| | `order_id` | `uuid` FK → `orders.id` unikalny | tak | nie | 1 zamówienie = 1 uprawnienie |
| | `kind` | `text` check in (`entries`, `days`, `single_entry`, `event_ticket`) | tak | nie | kopia z produktu |
| | `entries_total`, `entries_left` | `integer` | dla `entries` | nie | `entries_left` 0…`entries_total` |
| | `days_total` | `integer` | dla `days` | nie | |
| | `day_type` | `text` | dla `single_entry` | nie | |
| | `calendar_event_id` | `uuid` FK | dla `event_ticket` | nie | |
| | `first_used_on` | `date` | nie | nie | aktywacja karnetu czasowego |
| | `valid_until` | `date` | nie | nie | czasowy: `first_used_on + days_total − 1`; wejściówka: ostatni dzień wydarzenia |
| | `expires_on` | `date` | tak | nie | data zakupu + `pass_validity()`; bez konta: dzień zakupu |
| | `status` | `text` check in (`active`, `used_up`, `cancelled`) | tak | nie | wygaśnięcie liczone z dat (widok), nie stanem |
| | `created_at` | `timestamptz` | tak | nie | |
| `pass_usages` | definiuje SPEC-005 | | | | |

Stany zamówienia: `pending → paid` (powiadomienie Tpay), `pending → cancelled` (24 h bez płatności / błąd Tpay),
`paid → refund_pending → refunded` (Tpay), `paid → refunded` (na miejscu). `on_site` powstaje od razu jako `paid`.
Zamówienie anulowane, za które Tpay mimo to przyśle wpłatę → `paid` i uprawnienie powstaje (wejściówka ponad limit: także, z oznaczeniem do decyzji admina).

Stany uprawnienia: `active → used_up` (ostatnie wejście karnetu ilościowego / wejście jednorazowe), `active → cancelled` (zwrot).
Uprawnienie jest **ważne dnia D**, gdy `status = 'active'` i `D ≤ expires_on` oraz: czasowy aktywowany — `first_used_on ≤ D ≤ valid_until`;
jednorazowe — dzień tygodnia D pasuje do `day_type` (sob.–niedz. = `weekend`, pn–pt = `weekday`, także w święta); wejściówka — D w dniach wydarzenia.
Funkcja `public.passes_valid_on(user_id, date)` zwraca listę uprawnień ważnych danego dnia (używa jej SPEC-005).

### RLS
- `products`: `select` aktywnych dla wszystkich, wszystkich dla `is_staff()`; zapis — `is_admin()`.
- `orders`, `user_passes`: `select` własnych (`user_id = auth.uid()`) i dla `is_staff()`; brak `insert/update/delete` dla klientów.
  Zapis tylko funkcje `security definer` (`create_on_site_order`, `cancel_order`) i Edge Functions kluczem secret.
- `payment_notifications`: brak dostępu dla klientów.
- Liczba wolnych miejsc: funkcja `event_seats_left(event_id)` dostępna dla `anon`.

## 6. Interfejs użytkownika

| Adres | Zawartość |
| --- | --- |
| `/oferta/` | Grupy produktów (AC-5), dane pobierane w przeglądarce (ceny zawsze aktualne); link w nagłówku „Oferta” |
| `/oferta/zamowienie/?product=` / `?event=` | Podsumowanie i „Zapłać” (AC-7) |
| `/konto/platnosc/?order=` | Status po powrocie z Tpay (AC-10) |
| `/konto/` | + „Twoje karnety”, „Historia karnetów”, „Historia płatności”, „Przedłuż karnet” |
| `/panel/oferta/` | Produkty (admin) |
| `/panel/sprzedaz/` | Sprzedaż na miejscu i dzisiejsza lista (obsługa, admin) |
| `/panel/zamowienia/` | Zamówienia, anulowanie i zwrot (admin) |
| `/panel/uzytkownicy/profil/?id=` | + karnety i zamówienia użytkownika |

Komunikaty: błąd tworzenia płatności — „Nie udało się rozpocząć płatności. Spróbuj ponownie.”; produkt ukryty w trakcie — „Ten produkt nie jest już dostępny.”.
Skan kodu QR — ten sam komponent co w SPEC-005 (kamera w przeglądarce); do czasu SPEC-005 tylko wyszukiwanie.

## 7. Przypadki brzegowe

- Podwójne kliknięcie „Zapłać” → jedno zamówienie (blokada przycisku + klucz idempotencji żądania w `payments-create`).
- Powtórzone powiadomienie Tpay → bez zmian (`payment_notifications`, ADR-0002); kwota niezgodna → odrzucone, wpis do logu bez danych osobowych.
- Admin ukrywa produkt w trakcie płatności → zamówienie `pending` zostaje zrealizowane po wpłacie.
- Zmiana ceny między wyświetleniem a „Zapłać” → obowiązuje cena z bazy w chwili zamówienia, podsumowanie pokazuje ją po ponownym pobraniu.
- Karnet kupiony 29.02 → `expires_on` = 28.02 następnego roku (arytmetyka `date + interval '1 year'` w PostgreSQL).
- Karnet czasowy aktywowany 11 miesięcy po zakupie, N dni wykracza poza `expires_on` → ważny do `valid_until` (liczy się aktywacja; `expires_on` ogranicza tylko aktywację).
- Wejściówka na wydarzenie wielodniowe → obejmuje każdy dzień wydarzenia (każdy dzień = osobne zużycie w historii, wejściówka nie przechodzi w `used_up`, wygasa po ostatnim dniu).
- Usunięcie konta → uprawnienia usuwane (kaskada, przepadają — SPEC-002 AC-23), zamówienia zostają z `user_id = null`.
- Tpay niedostępny → `payments-create` zwraca 502, zamówienie nie powstaje.

## 8. Integracje

- **Tpay Open API** (ADR-0002): `payments-create` (OAuth client credentials, transakcja z kwotą, tytułem „<numer zamówienia> — <nazwa produktu>” (SPEC-006 AC-14), e-mailem i imieniem płatnika z profilu, `callbacks.notification.url` = `payments-notify`, powrót na `/konto/platnosc/?order=`),
  `payments-notify` (JWS, kwota, idempotencja, realizacja zamówienia funkcją `fulfil_order` w jednej transakcji), `payments-refund` (tylko admin, zwrot pełnej kwoty).
  Sekrety Supabase: `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`, `TPAY_API_URL`, `TPAY_NOTIFICATION_URL` (konfiguracja — zadanie `owner-task`).
- **Zadanie cykliczne** (ADR-0006): co godzinę anulowanie `pending` starszych niż 24 h.
- **Przebudowa strony** (ADR-0003): zmiana trybu/ceny wydarzenia wywołuje `site-rebuild`; liczba wolnych miejsc pobierana w przeglądarce.

## 9. RODO

- Zamówienie zawiera tylko powiązanie z kontem (`user_id`) i kto sprzedał; nie kopiujemy danych osobowych do zamówienia (dane faktury — SPEC-004).
- Do Tpay przekazujemy e-mail i imię i nazwisko płatnika (wymagane przez Tpay do potwierdzenia płatności).
- Sprzedaż osobie bez konta nie zapisuje żadnych danych osoby (10-A); jej dane trafiają tylko do książki (SPEC-005).
- Zamówienia przechowywane 5 lat od końca roku zakupu (przepisy podatkowe); po usunięciu konta bez powiązania z osobą.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Rodzaje produktów, ważność 1 rok, aktywacja karnetu czasowego | Z issue #38 | 2026-11-17 |
| Zwroty | 6-A: admin anuluje niewykorzystany karnet i zleca zwrot (Tpay) lub oznacza zwrot gotówki; częściowo wykorzystanych nie zwracamy — **zmienione w SPEC-012**: zwrot proporcjonalny w oknie 14 dni; po oknie brak zwrotu (zwrot tylko jako decyzja admina) | 2026-11-17 |
| Wejściówki | 7-A: cena i opcjonalny limit miejsc przy wydarzeniu; zużywana przy wpisie w dniu wydarzenia; płatne i bezpłatne bez wymaganego linku | 2026-11-17 |
| Karnet imienny | 8-A: tylko dla właściciela konta | 2026-11-17 |
| Koszyk | 9-A: jedno zamówienie = jeden produkt, ilość 1 | 2026-11-17 |
| Osoba bez konta | 10-A: sprzedaż na miejscu bez konta, wejście od razu wykorzystane, dane tylko w książce | 2026-11-17 |
| E-maile | 11-A: potwierdzenie płatności wysyła Tpay — **zmienione w SPEC-012** (2-A, 3-A: e-mail aplikacji z PDF regulaminu) | 2026-11-17 |
| Regulamin sprzedaży | 12-A: tekst od właściciela (`owner-task`) | 2026-11-17 |

Założenia analityka (zatwierdzane razem ze specyfikacją): nieopłacone zamówienie anulowane po 24 h; rezerwacja miejsca na wydarzeniu przez 30 min od rozpoczęcia płatności;
sprzedaż wejściówek do końca ostatniego dnia wydarzenia; wejściówka obejmuje wszystkie dni wydarzenia; święto w dzień powszedni = dzień powszedni.

Otwarte: brak.

## 11. Zadania

1. #47 Produkty: tabela, RLS, panel `/panel/oferta/` (AC-1…AC-4).
2. #48 Zamówienia i uprawnienia: tabele, stany, `fulfil_order`, `passes_valid_on`, zadanie anulowania (sekcja 5, AC-11), testy pgTAP.
3. #49 Płatności Tpay: `payments-create`, `payments-notify` (AC-8, AC-9, przypadki brzegowe), testy Deno.
4. #50 Oferta i zakup: `/oferta/`, podsumowanie, powrót z Tpay, sekcje w `/konto/` (AC-5…AC-7, AC-10, AC-12…AC-15).
5. #51 Wejściówki: tryb wydarzenia, cena, limit, karta w kalendarzu (AC-16…AC-20).
6. #52 Sprzedaż na miejscu (AC-21…AC-23).
7. #53 Zamówienia w panelu, anulowanie i zwrot, `payments-refund` (AC-24…AC-27).
