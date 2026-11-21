# SPEC-010: Przyznanie karnetu (prezent) przez admina

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #142 (rozszerza SPEC-003 — sprzedaż na miejscu, zamówienia, anulowanie; SPEC-004 — faktury)
- Zadania: #143, #144, #145 (sekcja 11)

## 1. Cel

Admin przyznaje (podarowuje) wybranej osobie z kontem dowolny produkt z Oferty — także ukryty (`is_active = false`) —
albo wejściówkę na płatne wydarzenie, bez płatności. Osoba dostaje uprawnienie tak, jakby je kupiła.
Zastosowania: nagrody w zawodach, prezenty, rozliczenia barterowe, karnety dla współpracowników.

## 2. Zakres

**W zakresie:**
- Formularz „Przyznaj karnet” w panelu admina: osoba z kontem, produkt (aktywny lub ukryty) albo wejściówka na płatne wydarzenie,
  „Ważny do” (domyślnie jak przy zakupie, admin może zmienić — decyzja 8-B), wymagany powód (4-A).
- Zapis jako zamówienie z kwotą 0,00 zł i metodą „Prezent” (`gift`), od razu opłacone, z numerem `SV-RRRR-NNNNNN` (3-A, SPEC-006).
- Widoczność: klient — karnet w „Twoje karnety” i pozycja „Prezent — 0,00 zł” w „Historia płatności” (bez powodu);
  panel admina — metoda „Prezent” w zamówieniach (filtr, CSV), powód w zamówieniu i w profilu osoby (5-A).
- Brak faktury dla prezentu (5-A): bez checkboxa, nigdy na liście „Do wystawienia”.
- Anulowanie przyznania przez admina w każdej chwili, także częściowo wykorzystanego karnetu (6-A).
- Dziennik zmian: przyznanie i anulowanie przyznania.

**Poza zakresem:**
- Przyznawanie przez Obsługę (decyzja 1-A — tylko admin).
- Przyznawanie osobie bez konta (2-A); gość bez konta — sprzedaż na miejscu (SPEC-003 AC-22) albo osoba towarzysząca w książce.
- Wejściówki na wydarzenia bezpłatne i zewnętrzne (nie mają wejściówek), wejściówki po zakończeniu wydarzenia.
- Zmiana „Ważny do” po przyznaniu, przedłużanie ważności, cofnięcie anulowania.
- Kilka sztuk naraz, przyznanie wielu osobom jednocześnie, e-mail do obdarowanego.
- Faktury, korekty i rozliczenia podatkowe prezentów.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Użytkownik | Własne przyznane uprawnienie i zamówienie „Prezent — 0,00 zł” (bez powodu) | — |
| Obsługa | Przyznane uprawnienie osoby obsługiwanej (jak każde uprawnienie — wybór przy wpisie do książki); bez powodu | — |
| Admin | Wszystkie przyznania z powodem, notatką anulowania i autorem | Przyznaje, anuluje przyznanie |

Zapis wyłącznie funkcjami `security definer` (`grant_pass`, `cancel_pass_grant`) z `is_admin()`. Powód i notatka anulowania
są w osobnej tabeli `order_grants` czytanej tylko przez admina — RLS `orders` pozwala klientowi czytać cały własny wiersz,
więc powód nie może być kolumną `orders` (5-A: klient nie widzi treści powodu).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako admin chcę przyznać osobie karnet bez płatności
- **AC-1**: Given jestem adminem When otwieram `/panel/zamowienia/` Then widzę przycisk „Przyznaj karnet” → `/panel/zamowienia/przyznaj/`;
  w profilu osoby (`/panel/uzytkownicy/profil/?id=`) przycisk „Przyznaj karnet” prowadzi do `/panel/zamowienia/przyznaj/?osoba=<id>` z wybraną osobą.
  Obsługa nie widzi przycisków, a wejście na adres kończy się bramką panelu (brak dostępu).
- **AC-2**: Given formularz When wybieram „Osoba”* Then mogę wyszukać osobę z kontem po imieniu i nazwisku lub e-mailu (jak w sprzedaży na miejscu, SPEC-003 AC-21)
  albo zeskanować kod QR; nie ma opcji „Osoba bez konta” (2-A).
- **AC-3**: Given formularz When rozwijam „Co przyznać”* Then widzę grupy „Karnety ilościowe”, „Karnety czasowe”, „Wejścia jednorazowe” ze wszystkimi produktami
  (także ukrytymi — z dopiskiem „(ukryty w Ofercie)”) oraz „Wejściówki” — opublikowane płatne wydarzenia, których ostatni dzień (Europe/Warsaw) jeszcze nie minął,
  z datą i — przy limicie — „wolne: 12” albo „wyprzedane” (pozycja nieaktywna). Cena produktu jest widoczna jako informacja („cena w Ofercie: 120,00 zł”).
- **AC-4**: Given wybrany produkt When patrzę na „Ważny do”* Then pole daty ma wartość domyślną = dziś + 1 rok (`pass_expires_on(dziś)`, jak przy zakupie)
  i mogę ją zmienić na dowolny dzień od dziś do dziś + 5 lat (8-B); podpowiedź pod polem dla karnetu czasowego: „Do tego dnia trzeba zacząć korzystać z karnetu — dni liczą się od pierwszego wejścia.”.
- **AC-5**: Given wybrana wejściówka When patrzę na formularz Then pola „Ważny do” nie ma, jest tekst „Wejściówka ważna w dniach wydarzenia.” (ważność jak przy zakupie).
- **AC-6**: Given formularz When wpisuję „Powód”* (3–300 znaków po obcięciu spacji, np. „Nagroda — zawody X”) Then pod polem widzę licznik znaków i podpowiedź
  „Widoczny tylko dla admina. Nie wpisuj danych osobowych — osoba jest już wskazana.”; za krótki / za długi → „Powód musi mieć od 3 do 300 znaków.”.
- **AC-7**: Given poprawny formularz When klikam „Przyznaj karnet” Then `rpc/grant_pass` w jednej transakcji tworzy zamówienie: `payment_method = 'gift'`,
  `amount = 0`, `status = 'paid'`, `paid_at = now()`, `item_name` jak przy zakupie (nazwa produktu / „Wejściówka: <nazwa wydarzenia>”), `created_by` = ja,
  numer `SV-RRRR-NNNNNN`; zapisuje powód w `order_grants`; tworzy uprawnienie dla osoby (`fulfil_order`) z `expires_on` = wybrana data „Ważny do”
  (wejściówka: jak przy zakupie, `valid_until` = ostatni dzień wydarzenia); dopisuje `audit_log` `pass_grant`.
- **AC-8**: Given przyznanie się udało When strona odświeża widok Then widzę „Przyznano: <nazwa> — <imię i nazwisko>. Zamówienie <numer>.”
  oraz przyciski „Przyznaj kolejny” (czyści formularz) i „Pokaż zamówienie” (`/panel/zamowienia/` z wyszukaniem po numerze — SPEC-006 AC-10).
- **AC-9**: Given podwójne kliknięcie lub ponowienie po błędzie sieci When to samo żądanie (`request_key`) trafia drugi raz Then powstaje tylko jedno zamówienie
  (unikalny indeks `(user_id, request_key)` jak w Tpay), wynik zwraca istniejące zamówienie; przycisk zablokowany do odpowiedzi.
- **AC-10**: Given wejściówka na wydarzenie z limitem When liczba zamówień `paid` (w tym prezentów) + świeżych `pending` osiągnęła limit Then `grant_pass` odrzuca
  przyznanie: „Brak wolnych miejsc na to wydarzenie.” (7-B: prezent wlicza się do limitu, sprawdzenie z blokadą wiersza wydarzenia jak w SPEC-003 AC-18).
- **AC-11**: Given wydarzenie zakończone, nieopublikowane albo nie w trybie „Płatne przez Ofertę” When próbuję przyznać wejściówkę Then
  „Na to wydarzenie nie można już przyznać wejściówki.” (`event_unavailable` / `sales_closed`).

### US-2: Jako klient chcę widzieć przyznany karnet
- **AC-12**: Given dostałam/dostałem karnet When otwieram `/konto/` Then widzę go w „Twoje karnety” jak kupiony (AC-12 SPEC-003; „Ważny do” = data ustawiona przez admina);
  wejściówka — jak kupiona.
- **AC-13**: Given `/konto/` When patrzę na „Historia płatności” Then pozycja ma kwotę „0,00 zł”, metodę „Prezent”, status „Opłacone” (po anulowaniu — „Anulowane”),
  bez statusu faktury i bez treści powodu.

### US-3: Jako admin chcę widzieć przyznania w panelu i rozliczeniach
- **AC-14**: Given `/panel/zamowienia/` When filtruję „Metoda” Then mam opcje „Online”, „Na miejscu”, „Prezent”; prezent na liście ma kwotę „0,00 zł”,
  metodę „Prezent”, kolumnę „Kto” = admin przyznający; w szczegółach — „Powód: <treść>” (i „Notatka anulowania”, jeśli jest). Eksport CSV zawiera metodę „Prezent”
  i kolumnę „Powód przyznania” (pusta dla innych metod). Suma kwot widoku nie zmienia się (prezenty = 0,00 zł).
- **AC-15**: Given `/panel/sprzedaz/` When patrzę na „Dzisiejsza sprzedaż na miejscu” i sumy gotówki/terminala Then prezentów nie ma (to nie jest sprzedaż na miejscu).
- **AC-16**: Given profil osoby w panelu (`/panel/uzytkownicy/profil/?id=`, sekcja karnetów) When osoba ma przyznany karnet Then przy karnecie widzę „Prezent: <powód>” (tylko admin);
  w „Historia zmian” profilu wpisy „Przyznano karnet: <nazwa>” i „Anulowano przyznanie: <nazwa>” (`pass_grant`, `pass_grant_cancel`).
- **AC-17**: Given zamówienie „Prezent” When admin otwiera je w `/panel/zamowienia/` Then nie ma przycisków „Dodaj dane do faktury” ani „Anuluj i zwróć”;
  `set_order_invoice_details` dla prezentu zwraca `invoice_not_available`, a `cancel_order` — `order_is_gift`; prezent nigdy nie trafia na „Do wystawienia” (SPEC-004 AC-10).

### US-4: Jako admin chcę anulować przyznany karnet (6-A)
- **AC-18**: Given zamówienie „Prezent” w stanie `paid` (karnet nieużywany, częściowo wykorzystany albo wykorzystany) When klikam „Anuluj przyznanie”
  Then widzę okno: „Karnet zostanie anulowany. Niewykorzystane wejścia i dni przepadają, historia wejść zostaje. Tej operacji nie można cofnąć.”,
  opcjonalne pole „Notatka” (do 300 znaków) i przyciski „Anuluj przyznanie” / „Wróć”.
- **AC-19**: Given potwierdzam When `rpc/cancel_pass_grant` się wykona Then w jednej transakcji: zamówienie → `cancelled` (`cancelled_at = now()`),
  uprawnienie `active` → `cancelled` (uprawnienie już `used_up` zostaje `used_up`), zużycia (`pass_usages`) i wpisy w książce bez zmian,
  notatka → `order_grants.cancel_note`, `audit_log` `pass_grant_cancel`; bez zwrotu pieniędzy. Widzę „Przyznanie anulowane.”.
- **AC-20**: Given uprawnienie anulowane When osoba otwiera `/konto/` lub obsługa robi wpis do książki Then karnetu nie ma w „Twoje karnety” ani na liście
  uprawnień do wyboru przy wpisie; jest w „Historia karnetów” (SPEC-003 AC-15). Anulowana wejściówka zwalnia miejsce w limicie wydarzenia.
- **AC-21**: Given zamówienie „Prezent” `cancelled` When ktoś ponownie wywoła `cancel_pass_grant` Then błąd `order_not_paid` („Przyznanie zostało już anulowane.”).

## 5. Model danych

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `orders` (zmiana) | `payment_method` | `text` check in (`tpay`, `on_site`, `gift`) | tak | nie | `gift` = przyznanie (prezent) |
| | `amount` | `integer` check `0…1 000 000` | tak | nie | dotąd `1…1 000 000` |
| | | | | | nowy `check orders_gift_amount`: `(payment_method = 'gift') = (amount = 0)` |
| | | | | | nowy `check orders_gift_no_invoice`: `payment_method <> 'gift' or not invoice_requested` |
| `order_grants` (nowa) | `order_id` | `uuid` PK, FK → `orders.id` on delete restrict | tak | nie | tylko dla zamówień `gift` (sprawdza `grant_pass`) |
| | `reason` | `text` | tak | możliwe (tekst swobodny) | 3–300 znaków po `trim` |
| | `cancel_note` | `text` | nie | możliwe | maks. 300 znaków |
| | `created_at` | `timestamptz` | tak | nie | |
| `audit_log` (zmiana) | `action` | + `pass_grant`, `pass_grant_cancel` | | | `changes`: `order_id`, `order_number`, `item_name`, `expires_on`, `reason` / `note` |

Bez zmian: `user_passes` (uprawnienie z prezentu jest zwykłym uprawnieniem z `order_id`), `on_site_method` (`null` dla `gift`, istniejący `check` to spełnia).
Kto przyznał = `orders.created_by`, kiedy = `orders.paid_at`.

Stany zamówienia `gift`: powstaje od razu jako `paid`; `paid → cancelled` (anulowanie przyznania, AC-19). Bez `pending`, `refund_pending`, `refunded`.
Stany uprawnienia: jak SPEC-003; `active → cancelled` także przy częściowym wykorzystaniu (tylko dla prezentu).

### Funkcje (`security definer`, `is_admin()`, `set search_path = ''`)
- `grant_pass(p_user_id uuid, p_product_id uuid, p_event_id uuid, p_reason text, p_expires_on date, p_request_key uuid) returns jsonb`
  (`order_id`, `order_number`, `duplicate`): dokładnie jedno z produktu i wydarzenia; produkt dowolny (także `is_active = false`);
  wydarzenie jak w `create_on_site_order` (opublikowane, `paid`, do ostatniego dnia, limit z blokadą wiersza); `p_expires_on` wymagane dla produktu
  (dziś…dziś + 5 lat, Europe/Warsaw), `null` dla wejściówki. Zamówienie, `order_grants`, `fulfil_order`, nadpisanie `user_passes.expires_on`, `audit_log` — w jednej transakcji.
  Błędy: `forbidden`, `invalid_request`, `user_not_found`, `product_not_found`, `event_unavailable`, `sales_closed`, `sold_out`, `invalid_grant_reason`, `invalid_expires_on`.
- `cancel_pass_grant(p_order_id uuid, p_note text default null) returns text`: tylko `gift` w stanie `paid` (blokada wiersza).
  Błędy: `forbidden`, `order_not_found`, `order_not_gift`, `order_not_paid`, `invalid_note`.
- Zmiany istniejących: `cancel_order` — `order_is_gift` dla `gift`; `set_order_invoice_details` — `invoice_not_available` dla `gift`;
  `admin_list_orders` — filtr metody przyjmuje `gift`, wynik + `grant_reason`, `grant_cancel_note`;
  sekcja karnetów w profilu osoby (dziś `select` z `user_passes`) czyta powód z `order_grants` po `order_id` (RLS: admin).
  `staff_on_site_sales_today`, `admin_list_invoices`, płatności Tpay — bez zmian (filtrują po `on_site` / `tpay` / `invoice_requested`).

### RLS
- `order_grants`: `select` tylko `is_admin()`; brak `insert/update/delete` dla klientów (zapis tylko funkcjami).
- `orders`, `user_passes`: bez zmian (klient — własne wiersze; obsługa — wszystkie).

## 6. Interfejs użytkownika

| Adres | Zmiana |
| --- | --- |
| `/panel/zamowienia/przyznaj/` (nowy, `requireAdmin`) | Formularz: Osoba*, Co przyznać*, Ważny do* (produkt), Powód*, „Przyznaj karnet”; potwierdzenie (AC-1…AC-11) |
| `/panel/zamowienia/` | Przycisk „Przyznaj karnet”; filtr „Prezent”; powód i notatka w szczegółach; „Anuluj przyznanie”; kolumna CSV (AC-14, AC-17…AC-19) |
| `/panel/uzytkownicy/profil/?id=` | Przycisk „Przyznaj karnet”; „Prezent: <powód>” przy karnecie (AC-1, AC-16) |
| `/konto/` | Metoda „Prezent”, kwota „0,00 zł”, bez statusu faktury (AC-13) |

Komunikaty błędów (`grant_pass`): `user_not_found` — „Nie znaleziono osoby.”; `product_not_found` — „Nie znaleziono produktu.”;
`event_unavailable` / `sales_closed` — „Na to wydarzenie nie można już przyznać wejściówki.”; `sold_out` — „Brak wolnych miejsc na to wydarzenie.”;
`invalid_grant_reason` — „Powód musi mieć od 3 do 300 znaków.”; `invalid_expires_on` — „Data ważności musi być między dziś a <data za 5 lat>.”;
inne — „Nie udało się przyznać karnetu. Spróbuj ponownie.”.
Na telefonie formularz w jednej kolumnie, przyciski ≥ 44 px. Teksty w `web/src/i18n/pl.ts`.

## 7. Przypadki brzegowe

- Produkt ukryty → można przyznać (cel funkcji); w „Twoje karnety” klient widzi jego nazwę jak każdego karnetu.
- Pierwsze zamówienie produktu to prezent → blokuje zmianę rodzaju / liczby wejść / dni produktu (SPEC-003 AC-3, `product_order_exists`) — jak zakup.
- Wejściówka-prezent jest „sprzedaną” wejściówką dla blokady zmiany trybu i ceny wydarzenia (SPEC-003 AC-20, wyzwalacz liczy `paid`) — także gdy to jedyne wejściówki.
- „Ważny do” = dziś → karnet ważny tylko dziś. Karnet czasowy z „Ważny do” = dziś aktywowany dziś → ważny `days_total` dni od dziś (`expires_on` ogranicza tylko aktywację, SPEC-003 §7).
- „Ważny do” 29.02 → dozwolone, gdy taki dzień istnieje w danym roku (kontrolka daty).
- Anulowanie w dniu, w którym osoba już weszła na karnet → wpis w książce i zużycie zostają; od kolejnego wpisu karnet niedostępny.
- Cofnięcie zużycia (SPEC-005 AC-23) na anulowanym karnecie → licznik +1, ale karnet nadal `cancelled` (status nie wraca do `active`).
- Usunięcie konta obdarowanego → uprawnienie usuwane (kaskada), zamówienie zostaje z `user_id = null`, `order_grants` zostaje z zamówieniem.
- Admin przyznaje karnet sobie → dozwolone; widoczne w dzienniku zmian (`actor_id = target_user_id`).
- Równoczesne przyznanie ostatniego miejsca i zakup online → blokada wiersza wydarzenia, jedno z nich dostaje `sold_out`.

## 8. Integracje

Brak. Prezent nie tworzy transakcji Tpay, nie wysyła e-maili (11-A), nie wywołuje `site-rebuild` (ceny i miejsca pobierane w przeglądarce).

## 9. RODO

- Nowe dane: `order_grants.reason` i `cancel_note` — tekst swobodny; cel: rozliczalność wydania towaru bez zapłaty.
  Podpowiedź w formularzu zniechęca do wpisywania danych osobowych (osoba jest powiązana przez `user_id`).
- Dostęp: tylko admin (RLS). Klient i obsługa nie widzą treści.
- Przechowywanie: razem z zamówieniem (SPEC-003 §9 — 5 lat od końca roku); po usunięciu konta zamówienie bez powiązania z osobą.
  Wpisy `audit_log` — retencja dziennika zmian (`audit_log_retention()`).

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Kto przyznaje | 1-A: tylko admin | 2026-11-21 |
| Komu | 2-A: tylko osobie z kontem | 2026-11-21 |
| Jak zapisać | 3-A: zamówienie 0,00 zł, metoda „Prezent” (`gift`), od razu opłacone, z numerem zamówienia | 2026-11-21 |
| Powód | 4-A: wymagany (3–300 znaków), widoczny tylko w panelu, w dzienniku zmian | 2026-11-21 |
| Widoczność i rozliczenia | 5-A: klient widzi karnet i „Prezent — 0,00 zł” w historii płatności (bez powodu); filtr „Prezent”; poza sumami gotówka/terminal; bez faktury | 2026-11-21 |
| Anulowanie | 6-A: admin w każdej chwili, także częściowo wykorzystany; zużycia zostają; zamówienie „Anulowane”, bez zwrotu | 2026-11-21 |
| Co można przyznać | 7-B: wszystkie produkty (aktywne i ukryte) + wejściówki na płatne wydarzenia (w limicie miejsc, do końca wydarzenia) | 2026-11-21 |
| Ważność | 8-B: admin może ustawić inną datę ważności | 2026-11-21 |

Założenia analityka (zatwierdzane razem ze specyfikacją): „Ważny do” w zakresie dziś…dziś + 5 lat (ochrona przed pomyłką w roku), domyślnie dziś + 1 rok;
data ważności tylko dla produktów, wejściówka zawsze w dniach wydarzenia; notatka przy anulowaniu opcjonalna;
anulowanie nieodwracalne; powód w osobnej tabeli `order_grants` (ukrycie przed klientem przy RLS na poziomie wierszy).

Otwarte: brak.

## 11. Zadania

1. #143 Baza: `gift` w `orders`, `order_grants`, `grant_pass`, `cancel_pass_grant`, zmiany `cancel_order`, `set_order_invoice_details`,
   `admin_list_orders`, akcje `audit_log`, testy pgTAP (sekcja 5, AC-7, AC-9…AC-11, AC-17, AC-19…AC-21).
2. #144 Formularz „Przyznaj karnet”: `/panel/zamowienia/przyznaj/`, przyciski w zamówieniach i profilu osoby (AC-1…AC-11).
3. #145 Prezent w panelu i koncie: filtr, powód, CSV, „Anuluj przyznanie”, profil osoby, `/konto/` (AC-12…AC-21).
