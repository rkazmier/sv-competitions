# SPEC-012: Zmiany w Ofercie wymagane przez regulamin sprzedaży

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #152 (zmienia SPEC-003; dotyka SPEC-001 — formularze kalendarza, SPEC-005 — ważność uprawnień w książce)
- Zadania: #158, #159, #160, #161, #162, #163, #164, #165 (kolejność w sekcji 11); dla właściciela: #166 konfiguracja poczty (`owner-task`), treść i PDF regulaminu (#154)
- Decyzje: ADR-0002 (Tpay), ADR-0006 (zadania cykliczne), ADR-0009 (e-maile aplikacji przez SMTP)
- **Termin: na produkcji przed 1 stycznia 2027 r.** (data wejścia w życie regulaminu sprzedaży)

## 1. Cel

Aplikacja robi to, co regulamin sprzedaży (#39, #154) obiecuje klientom, i spełnia ustawę o prawach konsumenta:
potwierdzenie zamówienia e-mailem z regulaminem (trwały nośnik), zgoda na korzystanie przed upływem 14 dni,
odstąpienie od umowy ze zwrotem proporcjonalnym, odwołanie wydarzenia ze zwrotem, przedłużenie ważności przy
zamknięciu strzelnicy, godziny otwarcia i zasada „karnety nie działają w czasie wydarzeń i zawodów”.
Oferta to karnety ilościowe, wejścia jednorazowe i wejściówki — karnety czasowe są usunięte (decyzja 7-A zmieniona 2026-11-24, US-10).

## 2. Zakres

**W zakresie:**
1. Wersja regulaminu przy zamówieniu online (`orders.terms_version`) i archiwum wersji PDF (§ 13 ust. 1).
2. Obowiązkowa zgoda na korzystanie przed upływem 14 dni przy zakupie online karnetu lub wejścia jednorazowego (1-A; § 8 ust. 2–3).
3. Przycisk „Zamawiam i płacę {kwota}” (art. 17 ust. 3 ustawy o prawach konsumenta).
4. Własne e-maile aplikacji przez SMTP skrzynki sprzedawcy (2-A, ADR-0009): potwierdzenie opłaconego zamówienia online
   z PDF regulaminu w załączniku (3-A; § 5 ust. 6, art. 21). Zmienia decyzję SPEC-003 11-A.
5. Odstąpienie w ciągu 14 dni: admin anuluje karnet online także po użyciu i zleca zwrot proporcjonalny przez Tpay
   (4-A — zaokrąglenie na korzyść klienta; § 8 ust. 2 i 7). Po 14 dniach regulamin nie przewiduje zwrotu (§ 9 ust. 1);
   „Anuluj i zwróć” zostaje jako wyjątkowa decyzja admina. Zmienia SPEC-003 6-A, AC-25, AC-26.
6. Odwołanie wydarzenia (§ 9 ust. 2, 6-A): oznaczenie „Odwołane”, zwrot wszystkich wejściówek, e-mail do kupujących z kontem.
7. Zamknięcie strzelnicy dłużej niż 7 dni → przedłużenie ważności uprawnień (`expires_on`, § 4 ust. 10). Zmienia „Przedłużanie ważności — poza zakresem” w SPEC-003.
8. Godziny otwarcia prowadzone przez admina i pokazywane publicznie (§ 4 ust. 11).
9. Karnety i wejścia jednorazowe nie obowiązują w dniach wydarzeń i zawodów z kalendarza (§ 4 ust. 11).
10. „Odstąp od umowy” w `/konto/` (5-A; dyrektywa 2023/2673; § 8 ust. 6) — ostatnie zadanie w kolejce.
11. Usunięcie karnetów czasowych (`days`) z Oferty, bazy i kodu (7-A, zmienione 2026-11-24; US-10).

**Poza zakresem:**
- Prawo odstąpienia dla wejściówek (art. 38 ust. 1 pkt 12), sprzedaży na miejscu i prezentów (SPEC-010) — bez zmian.
- Zwrot przy usunięciu konta — karnety przepadają (SPEC-002 AC-23, bez zmian).
- Automatyczny zwrot przy zmianie terminu wydarzenia — admin robi to akcją „Anuluj i zwróć” (wejściówka nieużyta), bez e-maila.
- Odwoływanie zawodów (`competitions`) — zawody nie mają jeszcze sprzedaży; cofnięcie odwołania; usuwanie zamknięcia strzelnicy.
- Godziny blokady karnetów (wydarzenia i zawody mają tylko daty — blokada obejmuje cały dzień).
- Karnety czasowe — usunięte (US-10); brak zasad zwrotu za dni czy przedłużania okresu aktywnego karnetu.
- Wpis do książki bez uprawnienia na bezpłatnym / zewnętrznym wydarzeniu (jak w SPEC-005 — poza zakresem).
- Inne e-maile (przypomnienia, faktury, newsletter), szablony e-maili edytowane w panelu, e-maile w języku angielskim
  (teksty w i18n, gotowe pod tłumaczenie).
- Ceny brutto — bez zmian (sprzedawca jest czynnym podatnikiem VAT, ceny w Ofercie są cenami brutto).

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Gość | Godziny otwarcia, dni wydarzeń/zawodów z blokadą karnetów, oznaczenie „Odwołane”, archiwum wersji regulaminu | — |
| Użytkownik | Własne zamówienia z wersją regulaminu i datą zgody, kwotę zwrotu, przedłużenia, własne zgłoszenia odstąpienia | Składa zgodę przy zakupie; zgłasza odstąpienie (US-9) |
| Obsługa | Komunikat o blokadzie karnetów w książce i przy sprzedaży | — |
| Admin | Wszystko powyżej, kolejkę e-maili (stan), listę zwrotów po odwołaniu, zgłoszenia odstąpienia | Odstąpienie i zwrot proporcjonalny, odwołanie wydarzenia, zamknięcie strzelnicy, godziny otwarcia, flaga blokady karnetów |

Zapis wyłącznie funkcjami `security definer` (sprawdzają `is_admin()` / właściciela zamówienia) i Edge Functions kluczem secret.
Status płatności i zwrotu zmienia nadal tylko `payments-notify` / `payments-refund` (ADR-0002).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako klient chcę wiedzieć, na jaki regulamin się zgodziłem (pkt 1, 3)
- **AC-1**: Given podsumowanie zamówienia (`/oferta/zamowienie/`) When je oglądam Then checkbox brzmi „Akceptuję regulamin sprzedaży (obowiązuje od 1.01.2027)”*
  — link „regulamin sprzedaży” otwiera w nowej karcie stronę regulaminu, a data to `effective_from` bieżącej wersji (Europe/Warsaw, dzień zamówienia).
- **AC-2**: Given podsumowanie When patrzę na przycisk Then brzmi „Zamawiam i płacę 120,00 zł” (zamiast „Zapłać 120,00 zł”); nieaktywny do zaznaczenia wymaganych checkboxów.
- **AC-3**: Given klikam „Zamawiam i płacę” When `payments-create` tworzy zamówienie Then zapisuje `orders.terms_version` = `effective_from` wersji, którą
  przeglądarka pokazała (pole `terms_version` w żądaniu); gdy to nie jest bieżąca wersja → 409 `terms_changed` i komunikat
  „Regulamin sprzedaży właśnie się zmienił. Zapoznaj się z nową wersją i zaakceptuj ją ponownie.” (podsumowanie pobiera wersję na nowo).
- **AC-4**: Given `/regulamin-sprzedazy/` When otwieram stronę Then pod treścią (#154) widzę „Wersje regulaminu” — listę wersji (od najnowszej)
  „Obowiązuje od 1.01.2027 — PDF” z linkiem do `/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf`.
- **AC-5**: Given `/konto/` „Historia płatności” albo zamówienie w panelu When zamówienie online ma `terms_version` Then widzę „Regulamin z 1.01.2027” z linkiem do PDF tej wersji
  oraz — gdy była zgoda — „Zgoda na korzystanie przed upływem 14 dni: 2.01.2027 14:05”.

### US-2: Jako sprzedawca chcę zgody na rozpoczęcie świadczenia przed upływem 14 dni (pkt 2, decyzja 1-A)
- **AC-6**: Given podsumowanie zakupu online karnetu ilościowego lub wejścia jednorazowego When je oglądam Then widzę drugi wymagany checkbox
  „Chcę korzystać z karnetu przed upływem 14 dni na odstąpienie od umowy. Wiem, że po wykorzystaniu usługi w całości tracę prawo odstąpienia.”*
  oraz pod nim „Bez tej zgody kupisz karnet na strzelnicy.”; dla wejściówki checkboxa nie ma, jest tekst „Wejściówki na wydarzenia nie podlegają odstąpieniu od umowy.”.
- **AC-7**: Given zakup produktu bez zgody (żądanie z pominięciem przeglądarki) When trafia do `payments-create` Then 400 `consent_required`, zamówienie nie powstaje.
- **AC-8**: Given zgoda zaznaczona When powstaje zamówienie Then `orders.early_performance_consent_at` = czas serwera (`now()`); dla wejściówki, sprzedaży na miejscu i prezentu — `null`.

### US-3: Jako klient chcę dostać potwierdzenie zamówienia e-mailem (pkt 1, decyzje 2-A, 3-A)
- **AC-9**: Given zamówienie Tpay przechodzi w `paid` When `payments-notify` zrealizuje zamówienie Then w tej samej transakcji powstaje wpis w `email_outbox`
  (`kind = 'order_paid'`, unikalny `(kind, order_id)` — powtórzone powiadomienie nie tworzy drugiego), a funkcja po zatwierdzeniu wywołuje wysyłkę.
- **AC-10**: Given wpis `order_paid` When Edge Function `mail-send` go wysyła Then klient (e-mail konta z `auth.users` w chwili wysyłki) dostaje od `MAIL_FROM`
  e-mail „Potwierdzenie zamówienia SV-2027-000123 — Steel Valley” z: numerem zamówienia, produktem (`item_name`), kwotą brutto (`120,00 zł`), datą i godziną zakupu (`paid_at`, Europe/Warsaw),
  ważnością („Ważny do 2.01.2028”; wejściówka — „Ważna w dniach wydarzenia: 14–15.03.2027”),
  treścią zgody z AC-6 i jej datą (jeśli była), informacją „W załączniku regulamin sprzedaży obowiązujący od 1.01.2027, zaakceptowany przy zakupie.”
  i załącznikiem `regulamin-sprzedazy-2027-01-01.pdf` (wersja `orders.terms_version`), oraz linkiem do `/konto/`.
- **AC-11**: Given wysyłka nie powiodła się (SMTP, brak PDF) When działa zadanie cykliczne co 10 min Then ponawia wpisy `pending` (maks. 5 prób, odstęp rośnie: 10 min, 30 min, 1 h, 3 h);
  po 5 nieudanych próbach — `failed`, admin widzi w zamówieniu „E-mail z potwierdzeniem: nie wysłano” i przycisk „Wyślij ponownie” (wraca do `pending`, licznik od zera).
  E-maila nigdy nie wysyłamy bez załącznika.
- **AC-12**: Given konto zostało usunięte przed wysyłką (`user_id = null`) When przychodzi kolej wpisu Then wpis → `skipped`, nic nie jest wysyłane.
- **AC-13**: Given zamówienie „na miejscu” albo „Prezent” When przechodzi w `paid` Then e-maila nie ma (bez zmian; SPEC-010).
- **AC-14**: Given zamówienie w panelu (`/panel/zamowienia/`) When je otwieram Then widzę stan e-maili („Wysłano 2.01.2027 14:06” / „W kolejce” / „Nie wysłano”).

### US-4: Jako admin chcę obsłużyć odstąpienie od umowy w ciągu 14 dni (pkt 3, decyzja 4-A)
Okno odstąpienia: od dnia opłacenia do dnia `paid_at` (data w Europe/Warsaw) + 14 dni włącznie. Dotyczy zamówień `tpay` `paid` na karnet ilościowy lub wejście jednorazowe (nie wejściówkę — AC-22).
- **AC-15**: Given zamówienie online karnetu ilościowego / wejścia jednorazowego w oknie odstąpienia When otwieram je w panelu Then widzę przycisk „Odstąpienie od umowy” (także gdy karnet był używany)
  i informację „Odstąpienie możliwe do 16.01.2027”.
- **AC-16**: Given klikam „Odstąpienie od umowy” When otwiera się okno Then wpisuję „Dzień odstąpienia”* (domyślnie dziś; od dnia opłacenia do dziś, nie później niż koniec okna)
  i widzę wyliczenie z `rpc/withdrawal_quote(order_id, day)`:
  ilościowy — „Cena 100,00 zł, wykorzystano 1 z 3 wejść (33,33 zł). Zwrot: 66,67 zł.”;
  nieużyty karnet lub wejście — zwrot pełnej kwoty; opcjonalna „Notatka” (do 300 znaków) i przyciski „Zleć zwrot” / „Wróć”.
- **AC-17**: Given wyliczenie When liczę kwotę Then: wartość wykorzystania = `floor(cena × wykorzystane / całość)` (grosze, w dół — 4-A), zwrot = cena − wartość wykorzystania;
  ilościowy: wykorzystane = `entries_total − entries_left` (całość = `entries_total`);
  wejście jednorazowe (całość = 1): wykorzystane = 1, gdy `used_up`, inaczej 0.
- **AC-18**: Given zwrot wyliczony na 0,00 zł (usługa wykonana w całości: ilościowy bez wejść, użyte wejście jednorazowe) When otwieram zamówienie
  Then przycisk jest nieaktywny z informacją „Usługa wykonana w całości — prawo odstąpienia wygasło.” (§ 8 ust. 3).
- **AC-19**: Given potwierdzam „Zleć zwrot” When `payments-refund` wykona żądanie z `mode = 'withdrawal'` Then `rpc/withdraw_order(order_id, day, note)` w jednej transakcji
  ponownie liczy kwotę (z blokadą uprawnienia), uprawnienie → `cancelled` (także z zużyciami), zamówienie → `refund_pending` z `refund_amount` i `withdrawal_on`,
  `audit_log` `order_refund` (`changes`: `reason: withdrawal`, `amount`, `refund_amount`, `withdrawal_on`, `used`, `total`); potem Tpay — zwrot częściowy kwoty `refund_amount`
  (`POST /transactions/{id}/refunds` z `amount`), a po powiadomieniu — `refunded`. Błąd Tpay → `revert_order_refund`, ale uprawnienie zostaje `cancelled` (AC-52).
- **AC-20**: Given zamówienie zwrócone częściowo When patrzę na `/konto/` albo panel Then status to „Zwrócone 66,67 zł z 100,00 zł” („Zwrot w toku: 66,67 zł”); suma kwot w panelu
  pokazuje osobno „Zwroty: −66,67 zł”; eksport CSV ma kolumny „Kwota zwrotu” i „Dzień odstąpienia”.
- **AC-21**: Given zamówienie po upływie okna When ma nieużywane uprawnienie Then zamiast „Odstąpienie od umowy” jest „Anuluj i zwróć” (SPEC-003 AC-25) z ostrzeżeniem
  „Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).” i **wymaganą** notatką (3–300 znaków);
  karnet używany po upływie okna — bez zmian (SPEC-003 AC-26, „Karnet był używany — zwrot poza systemem.”).
- **AC-22**: Given wejściówka, sprzedaż na miejscu When admin otwiera zamówienie Then akcja „Odstąpienie od umowy” nie występuje; „Anuluj i zwróć” jak w SPEC-003 AC-25
  (wejściówka — także przy zmianie terminu wydarzenia; „na miejscu” w oknie — bez ostrzeżenia o 14 dniach, ale z wymaganą notatką).

### US-5: Jako admin chcę odwołać płatne wydarzenie i zwrócić pieniądze (pkt 5, decyzja 6-A)
- **AC-23**: Given opublikowane wydarzenie, którego ostatni dzień jeszcze nie minął When klikam w `/panel/wydarzenia/` „Odwołaj wydarzenie” Then widzę okno
  „Wydarzenie zostanie oznaczone jako odwołane. Wszystkie wejściówki zostaną anulowane, a pieniądze zwrócone: online — automatycznie przez Tpay (N), na miejscu — lista do zwrotu (M).
  Kupujący z kontem dostaną e-mail. Tej operacji nie można cofnąć.”, wymagane pole „Powód odwołania (widoczny publicznie)” (3–200 znaków) z podpowiedzią „Nie wpisuj danych osobowych.” i „Odwołaj wydarzenie” / „Wróć”.
- **AC-24**: Given potwierdzam When Edge Function `event-cancel` wywoła `rpc/cancel_calendar_event(event_id, reason)` Then w jednej transakcji: `calendar_events.cancelled_at`, `cancel_reason`, `cancelled_by`;
  zamówienia już `cancelled`, `refund_pending` lub `refunded` — pomijane (bez zmian, e-maila i wpisu w `audit_log`); `pending` → `cancelled`; `paid` Tpay → `refund_pending` (pełna kwota); `paid` na miejscu → `refunded` z adnotacją „Zwrot gotówki / na terminal — odwołanie wydarzenia”;
  `paid` prezent → `cancelled`; wszystkie uprawnienia → `cancelled`; dla każdego opłaconego zamówienia z kontem (`paid` → `refund_pending` / `refunded` / `cancelled` prezent) — `email_outbox` `event_cancelled`
  (zamówienia `pending` → `cancelled` bez e-maila — nic nie zapłacono; decyzja właściciela w PR #179); `audit_log` `event_cancel` (wydarzenie, liczby, suma)
  i `order_refund` dla każdego zwrotu; wyzwalacz `site-rebuild`. Potem funkcja zleca zwroty w Tpay po kolei; nieudane wracają do `paid` (`revert_order_refund`), uprawnienie zostaje `cancelled` (AC-51).
- **AC-25**: Given wydarzenie odwołane When ktoś ogląda kalendarz lub kartę wydarzenia Then widzi plakietkę „Odwołane” i „Powód: <treść>”, bez „Kup wejściówkę” i liczby miejsc;
  `create_tpay_order`, `create_on_site_order` i `grant_pass` odrzucają wejściówkę (`event_cancelled`); wejściówki tego wydarzenia są nieważne (`pass_valid_on`, `passes_for_range_entry`),
  także gdyby któraś była `active`; wydarzenie nie blokuje karnetów (US-8).
- **AC-26**: Given wydarzenie odwołane When admin otwiera je w panelu Then widzi listę „Zwroty po odwołaniu”: osoba (lub „Osoba bez konta”), numer zamówienia, metoda, kwota, stan
  („Zwrot w toku” / „Zwrócone” / „Do zwrotu na miejscu” / „Zwrot Tpay nieudany — Ponów zwrot”); „Ponów zwrot” = „Anuluj i zwróć” dla tego zamówienia.
- **AC-27**: Given e-mail `event_cancelled` When jest wysyłany Then temat: „Wydarzenie odwołane: <nazwa> — Steel Valley”; treść: „Wydarzenie <nazwa> (<daty>) zostało odwołane. Powód: <powód>.” oraz w zależności od metody:
  online — „Zwrot <kwota> zlecony na rachunek lub kartę, z której zapłacono.”; na miejscu — „W sprawie zwrotu <kwota> za wejściówkę kupioną na strzelnicy odpowiedz na tę wiadomość.”;
  prezent — „Wejściówka została anulowana.”; stopka z numerem zamówienia.
- **AC-28**: Given wpłata Tpay za zamówienie anulowane z powodu odwołania (przyszła po odwołaniu) When `payments-notify` ją przyjmie Then zamówienie → `paid`, uprawnienie od razu `cancelled`, bez e-maila `order_paid`,
  pozycja pojawia się na liście AC-26 jako „Zwrot Tpay nieudany — Ponów zwrot” (admin zleca zwrot ręcznie).
- **AC-29**: Given wydarzenie odwołane When admin próbuje je edytować lub usunąć Then dozwolone są tylko opis i powód odwołania; „Odwołaj wydarzenie” nie występuje
  dla wydarzeń zakończonych i już odwołanych. Odwołać można wydarzenie w każdym trybie (bezpłatne i zewnętrzne — tylko oznaczenie i e-maili brak).

### US-6: Jako admin chcę przedłużyć ważność karnetów po zamknięciu strzelnicy (pkt 8)
- **AC-30**: Given `/panel/zamkniecia/` When dodaję zamknięcie: „Od”*, „Do”* (dzień „Do” nie później niż dziś — zamknięcie wpisuje się po jego zakończeniu), „Przyczyna”* (3–200 znaków, tylko dla admina)
  Then przed zapisem widzę z `rpc/range_closure_preview(from, to)` „Zamknięcie: 10 dni. Ważność przedłuży się o 10 dni dla 37 uprawnień.” i „Zapisz i przedłuż” / „Wróć”.
- **AC-31**: Given zamknięcie krótsze niż 8 kolejnych dni When zapisuję Then „Przedłużenie przysługuje przy zamknięciu dłuższym niż 7 kolejnych dni.” (`closure_too_short`);
  nakładające się na inne zamknięcie → „Ten okres nakłada się na zapisane zamknięcie.” (`closure_overlap`).
- **AC-32**: Given potwierdzam When `rpc/add_range_closure(from, to, reason)` się wykona Then w jednej transakcji dla każdego uprawnienia aktywnego w tym okresie
  (`status = 'active'`, kupione nie później niż „Do”, `expires_on ≥ Od`; bez wejściówek i uprawnień osoby bez konta):
  `expires_on += N` (N = liczba dni zamknięcia); każde przedłużenie w `range_closure_passes`; jeden wpis `audit_log` `range_closure` (okres, N, liczba uprawnień).
  Uprawnienie `used_up` i `cancelled` — bez zmian.
- **AC-33**: Given moje uprawnienie przedłużono When otwieram `/konto/` Then przy karnecie widzę nową datę „Ważny do” i „Przedłużono o 10 dni (zamknięcie strzelnicy 3–12.02.2027).”.
- **AC-34**: Given lista w `/panel/zamkniecia/` When ją oglądam Then widzę zamknięcia (od–do, dni, przyczyna, liczba uprawnień, kto, kiedy), od najnowszych; bez edycji i usuwania.

### US-7: Jako klient chcę znać godziny otwarcia (pkt 9)
- **AC-35**: Given `/panel/godziny/` When dla każdego dnia tygodnia (pn–nd) ustawiam „Otwarte od–do” albo „Zamknięte” Then zapis od razu obowiązuje na stronie (dane pobierane w przeglądarce).
- **AC-36**: Given `/panel/godziny/` When dodaję wyjątek: data*, „Otwarte od–do” albo „Zamknięte”, opis (do 100 znaków, publiczny, np. „Wigilia”) Then wyjątek zastępuje godziny dnia tygodnia; wyjątki z przeszłości znikają z listy po 30 dniach (zadanie nocne).
- **AC-37**: Given `/oferta/` When otwieram stronę Then sekcja „Godziny otwarcia” (kotwica `#godziny`) pokazuje tydzień, wyjątki na najbliższe 30 dni oraz
  „Dni wydarzeń i zawodów — karnety i wejścia jednorazowe nie obowiązują:” z listą dni na najbliższe 30 dni (nazwa, data, link do kalendarza).
- **AC-38**: Given dowolna strona When patrzę na stopkę Then widzę link „Godziny otwarcia” → `/oferta/#godziny`. Brak ustawionych godzin → sekcja „Godziny otwarcia wkrótce.”.
- **AC-39**: Godzina „Do” musi być późniejsza niż „Od” („Godzina zamknięcia musi być późniejsza niż otwarcia.”); jeden przedział na dzień; godziny są informacją — nie blokują wpisów do książki.

### US-8: Jako sprzedawca chcę, by karnety nie obowiązywały w czasie wydarzeń i zawodów (pkt 10)
- **AC-40**: Given formularz zawodów (SPEC-001) albo wydarzenia When go wypełniam Then widzę checkbox „Karnety i wejścia jednorazowe nie obowiązują w dniach tego wpisu” (domyślnie zaznaczony);
  odznaczam go tylko, gdy wpis nie zajmuje strzelnicy (np. wydarzenie poza strzelnicą).
- **AC-41**: Given dzień D należy do opublikowanego, nieodwołanego wpisu z zaznaczoną flagą (`starts_on ≤ D ≤ coalesce(ends_on, starts_on)`) When liczona jest ważność uprawnienia
  (`pass_valid_on`, `passes_valid_on`, `passes_for_range_entry`) Then karnety ilościowe i wejścia jednorazowe **nie są ważne dnia D**; wejściówki bez zmian.
  Funkcja `range_blocked_on(date)` zwraca listę blokujących wpisów (nazwa, rodzaj) — publiczna.
- **AC-42**: Given D zablokowany When obsługa wybiera osobę w `/panel/ksiazka/` Then widzi „Dziś: <nazwa> — karnety i wejścia jednorazowe nie obowiązują. Wejście na zasadach wydarzenia (wejściówka).”
  i tylko wejściówki; „Sprzedaj na miejscu” proponuje wejściówkę (jeśli wydarzenie płatne).
- **AC-43**: Given D zablokowany When obsługa sprzedaje na miejscu osobie bez konta wejście jednorazowe Then `create_on_site_order` odrzuca (`range_blocked`): „Dziś karnety i wejścia jednorazowe nie obowiązują.”;
  sprzedaż karnetu osobie z kontem jest dozwolona z ostrzeżeniem „Karnet nie obowiązuje dziś (<nazwa>).”.
- **AC-44**: (usunięte — karnety czasowe usunięte, US-10).
- **AC-45**: Given admin zmienia flagę, daty, publikację lub odwołuje wpis When dzień jest dziś lub w przyszłości Then nowa reguła działa od razu (ważność liczona w chwili sprawdzenia; zużycia z przeszłości bez zmian).

### US-9: Jako klient chcę odstąpić od umowy z konta (pkt 6, decyzja 5-A)
- **AC-46**: Given `/konto/` „Historia płatności” When zamówienie online karnetu ilościowego / wejścia jednorazowego jest `paid` w oknie odstąpienia i zwrot > 0 (AC-17, AC-18) Then widzę przycisk „Odstąp od umowy”.
- **AC-47**: Given klikam When otwiera się okno Then widzę „Odstępuję od umowy zakupu <produkt> (zamówienie <numer>, opłacone <data>).”, wyliczenie zwrotu na dziś (AC-16), uwagę
  „Od chwili wysłania karnet przestaje działać.”, pole „Uwagi” (opcjonalne, do 500 znaków) i przyciski „Wyślij oświadczenie” / „Wróć”.
- **AC-48**: Given wysyłam When `rpc/submit_withdrawal(order_id, comment)` się wykona Then w jednej transakcji: wpis `withdrawal_requests` (`submitted_at`), uprawnienie → `cancelled`,
  `orders.withdrawal_on` = dziś, `refund_amount` wyliczone na dziś; `email_outbox` `withdrawal_received` (potwierdzenie dla klienta z treścią oświadczenia i kwotą)
  i `withdrawal_admin` (powiadomienie na `MAIL_FROM`: numer zamówienia, link do panelu, bez danych osoby); widzę „Oświadczenie wysłane. Zwrot 66,67 zł otrzymasz w ciągu 14 dni.”.
- **AC-49**: Given zgłoszenie When admin otwiera `/panel/zamowienia/` Then filtr „Zgłoszone odstąpienia” i przy zamówieniu „Odstąpienie zgłoszone 5.01.2027 — zwróć do 19.01.2027”
  z przyciskiem „Zleć zwrot” (kwota z zgłoszenia, bez edycji; dalej jak AC-19, bez ponownego anulowania); po zleceniu zgłoszenie → `processed`.
- **AC-50**: Given drugie zgłoszenie do tego samego zamówienia albo po oknie When wysyłam Then `withdrawal_exists` / `withdrawal_window_closed` („Termin na odstąpienie minął.”).

### Nieudany zwrot po odwołaniu wydarzenia lub odstąpieniu (US-4, US-5, US-9)
- **AC-51**: Given zwrot za wejściówkę odwołanego wydarzenia (AC-24, AC-28) When Tpay go odrzuci i wykona się `revert_order_refund` Then zamówienie → `paid`,
  a uprawnienie **zostaje `cancelled`** (wejściówka odwołanego wydarzenia jest nieważna — także dla `pass_valid_on`, niezależnie od stanu, AC-41);
  pozycja na liście AC-26 ma stan „Zwrot Tpay nieudany — Ponów zwrot”; „Ponów zwrot” zleca zwrot pełnej kwoty bez sprawdzania zużycia (SPEC-003 AC-26 nie obowiązuje).
- **AC-52**: Given zwrot po odstąpieniu (`withdrawal_on` ustawione — AC-19, AC-48, AC-49) When Tpay go odrzuci i wykona się `revert_order_refund` Then zamówienie → `paid`
  z zachowanym `refund_amount` i `withdrawal_on`, uprawnienie **zostaje `cancelled`** (odstąpienie jest skuteczne od oświadczenia), zgłoszenie `withdrawal_requests` wraca do `new`;
  admin widzi „Zwrot nieudany — Ponów zwrot”, a ponowienie wysyła tę samą kwotę `refund_amount` (bez ponownego wyliczenia i anulowania).
  `revert_order_refund` przywraca `active` tylko dla zwrotu z „Anuluj i zwróć” (SPEC-003 AC-25, AC-21) — `withdrawal_on is null` i wydarzenie nieodwołane.

### US-10: Jako sprzedawca chcę usunąć karnety czasowe z Oferty (decyzja 7-A, zmieniona 2026-11-24)
Pierwotnie (7-A) typ `days` miał zostać dla karnetów sprzedanych do 31.12.2026. Decyzja właściciela z 2026-11-24: żaden karnet czasowy
nie został sprzedany, więc typ `days` usuwamy całkowicie — z Oferty, bazy i kodu (SPEC-003, SPEC-005, SPEC-010).
- **AC-53**: Given `/panel/oferta/` When dodaję produkt Then „Rodzaj” ma tylko „Karnet ilościowy” i „Wejście jednorazowe”; produkt `kind = 'days'`
  (także kluczem secret) odrzuca `check` tabeli `products` (23514). `user_passes.kind` i `pass_usages.effect` nie mają wartości `days` / `activated`;
  kolumn `products.days`, `user_passes.days_total`, `user_passes.first_used_on` nie ma.
- **AC-54**: Given migracja `remove_time_passes` When w bazie jest opłacone zamówienie (Tpay lub na miejscu) na produkt `days` Then migracja się przerywa
  (`time_passes_sold`) — trzeba je najpierw rozliczyć ręcznie; inaczej usuwa produkty `days` z ich nieopłaconymi / anulowanymi zamówieniami
  i prezentami (z uprawnieniami i zużyciami). Wpisy książki rejestru pobytu zostają.
- **AC-55**: (usunięte — karnetów czasowych nie ma; odstąpienie dotyczy karnetów ilościowych i wejść jednorazowych, AC-15, AC-46).

## 5. Model danych

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `sales_terms_versions` (nowa) | `effective_from` | `date` PK | tak | nie | wersja = data obowiązywania; plik `web/public/regulamin-sprzedazy/regulamin-sprzedazy-<RRRR-MM-DD>.pdf`; wiersze dodaje migracja (razem z PDF), odczyt publiczny |
| `orders` (zmiana) | `terms_version` | `date` FK → `sales_terms_versions` | nie | nie | `tpay` od SPEC-012; `null` — na miejscu, prezent, starsze |
| | `early_performance_consent_at` | `timestamptz` | nie | nie | zgoda z AC-6; wymagana przez `create_tpay_order` dla produktu |
| | `refund_amount` | `integer` | nie | nie | grosze, 1…`amount`; ustawiane przy każdym zwrocie (pełny = `amount`); starsze `refunded` — `null` = pełny |
| | `withdrawal_on` | `date` | nie | nie | dzień odstąpienia (AC-16, AC-48) |
| | `refund_requested_at` | `timestamptz` | nie | nie | kiedy zlecono zwrot w Tpay; `null` przy `refund_pending` = zwrot jeszcze nie wysłany (odwołanie wydarzenia, §7) |
| `email_outbox` (nowa) | `id` | `uuid` PK | tak | nie | |
| | `kind` | `text` check in (`order_paid`, `event_cancelled`, `withdrawal_received`, `withdrawal_admin`) | tak | nie | |
| | `order_id` | `uuid` FK → `orders.id` on delete cascade | tak | nie | unikalny `(kind, order_id)`; adres odbiorcy pobierany w chwili wysyłki (bez kopii e-maila) |
| | `status` | `text` check in (`pending`, `sent`, `failed`, `skipped`) | tak | nie | |
| | `attempts` | `integer` | tak | nie | |
| | `next_attempt_at`, `sent_at`, `created_at` | `timestamptz` | | nie | |
| | `last_error` | `text` | nie | nie | kod błędu bez adresu i treści (maks. 200 znaków) |
| `calendar_events` (zmiana) | `blocks_passes` | `boolean` | tak | nie | domyślnie `true` (także istniejące) |
| | `cancelled_at` | `timestamptz` | nie | nie | odwołanie (US-5) |
| | `cancel_reason` | `text` | gdy odwołane | nie | 3–200 znaków, publiczny |
| | `cancelled_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | niepubliczne (jak `created_by`) |
| `competitions` (zmiana) | `blocks_passes` | `boolean` | tak | nie | domyślnie `true` |
| `range_closures` (nowa) | `id`, `starts_on`, `ends_on` | `uuid`, `date`, `date` | tak | nie | `ends_on − starts_on + 1 ≥ 8`; bez nakładania (`exclude using gist`) |
| | `reason` | `text` | tak | możliwe | 3–200 znaków; tylko admin |
| | `days`, `passes_count` | `integer` | tak | nie | |
| | `created_by`, `created_at` | | tak | tak | |
| `range_closure_passes` (nowa) | `closure_id`, `user_pass_id` | PK złożony, FK (pass — on delete cascade) | tak | nie | `expires_on_before` — ślad przedłużenia |
| `opening_hours` (nowa) | `weekday` | `smallint` PK 1–7 (ISO, 1 = pn) | tak | nie | `opens_at`, `closes_at` `time` (oba `null` = zamknięte); odczyt publiczny |
| `opening_hours_exceptions` (nowa) | `day` | `date` PK | tak | nie | `opens_at`, `closes_at` (oba `null` = zamknięte), `note` do 100 znaków; odczyt publiczny |
| `withdrawal_requests` (nowa) | `order_id` | `uuid` PK, FK → `orders.id` | tak | nie | |
| | `user_id` | `uuid` FK → `profiles.id` on delete set null | nie | tak | |
| | `comment` | `text` | nie | możliwe | do 500 znaków |
| | `submitted_at`, `processed_at`, `processed_by` | | | `processed_by` | `status` `new` / `processed` |
| `products`, `user_passes` (zmiana) | `kind` | bez `days` (SPEC-003) | | nie | kolumny `days`, `days_total`, `first_used_on` usunięte (AC-53) |
| `audit_log` (zmiana) | `action` | + `event_cancel`, `range_closure`, `email_resend` | | | `order_refund` z `reason: withdrawal` / `event_cancel` |

Stany zamówienia (zmiana): `paid → refund_pending → refunded` z `refund_amount` (pełnym lub częściowym); reszta jak SPEC-003 / SPEC-010.
Stany uprawnienia (zmiana): `active → cancelled` także z zużyciami — przy odstąpieniu (US-4, US-9) i odwołaniu wydarzenia (US-5).
Stany e-maila: `pending → sent`, `pending → failed` (5 prób) `→ pending` („Wyślij ponownie”), `pending → skipped` (brak konta).

Ważność dnia D (zmiana SPEC-003 §5): dodatkowo dla wszystkich rodzajów poza `event_ticket` — `range_blocked_on(D)` pusty.

### RLS
- `sales_terms_versions`, `opening_hours`, `opening_hours_exceptions`: `select` dla wszystkich; zapis `opening_hours*` — `is_admin()`; `sales_terms_versions` — tylko migracja.
- `email_outbox`, `range_closure_passes`, `withdrawal_requests`: brak bezpośredniego dostępu klientów; odczyt przez funkcje
  (`my_withdrawals()`, stan e-maila w `admin_list_orders`, przedłużenia w danych `/konto/`).
- `range_closures`: `select`, zapis przez `add_range_closure` — admin.
- `calendar_events.cancelled_by` — bez odczytu publicznego (uprawnienia kolumnowe jak `created_by`).

## 6. Interfejs użytkownika

| Adres | Zmiana |
| --- | --- |
| `/oferta/zamowienie/` | Wersja regulaminu w checkboxie, zgoda (AC-6), „Zamawiam i płacę” |
| `/oferta/` | Sekcja „Godziny otwarcia” `#godziny` + dni blokady (AC-37); bez grupy „Karnety czasowe” (AC-53) |
| `/regulamin-sprzedazy/` | „Wersje regulaminu” (AC-4) |
| `/konto/` | Regulamin i zgoda przy zamówieniu, kwota zwrotu, „Przedłużono o…”, „Odstąp od umowy” |
| Kalendarz, karta wydarzenia | Plakietka „Odwołane” + powód |
| `/panel/zamowienia/` | „Odstąpienie od umowy”, ostrzeżenie po 14 dniach, stan e-maili, „Wyślij ponownie”, filtr „Zgłoszone odstąpienia”, kolumny zwrotu |
| `/panel/wydarzenia/` | „Odwołaj wydarzenie”, „Zwroty po odwołaniu”, checkbox blokady (także `/panel/zawody/`) |
| `/panel/zamkniecia/` (nowa) | Zamknięcia strzelnicy (admin); link w menu panelu „Zamknięcia” |
| `/panel/godziny/` (nowa) | Godziny otwarcia i wyjątki (admin); link „Godziny otwarcia” |
| `/panel/ksiazka/` | Komunikat blokady (AC-42) |
| `/panel/oferta/` | Bez rodzaju „Karnet czasowy” (AC-53) |
| Stopka | „Godziny otwarcia” |

E-maile: HTML + wersja tekstowa, nadawca `MAIL_FROM` (nazwa „Steel Valley”), `Reply-To` = `MAIL_FROM`, teksty w i18n (`email.*`), kwoty `120,00 zł`, daty `2.01.2027`.
Komunikaty błędów: `consent_required` — „Zaznacz zgodę na korzystanie przed upływem 14 dni.”, `terms_changed` (AC-3), `event_cancelled` — „Wydarzenie zostało odwołane.”,
`withdrawal_window_closed`, `withdrawal_nothing_to_refund` — tekst AC-18, `range_blocked` (AC-43), `time_passes_sold` (migracja, AC-54).

## 7. Przypadki brzegowe

- Zamówienie utworzone przed wdrożeniem / przed 1.01.2027 bez wersji → `terms_version = null`; e-mail `order_paid` wtedy nie powstaje (brak PDF do załączenia),
  odstąpienie w panelu działa (okno liczone od `paid_at`). Pierwsza wersja w `sales_terms_versions` = 2027-01-01 (dodawana z #154); przed tą datą `payments-create` przyjmuje `terms_version = null`.
- Wersja zmienia się o północy między podsumowaniem a „Zamawiam i płacę” → 409 `terms_changed` (AC-3).
- Okno odstąpienia: opłacone 31.12 o 23:50 (Warsaw) → ostatni dzień 14.01; liczone w Europe/Warsaw, także przy zmianie czasu.
- Zwrot częściowy, który Tpay odrzuci (np. środki rozliczone) → `revert_order_refund`, uprawnienie zostaje `cancelled` (AC-52), admin widzi „Zwrot nieudany”, może ponowić.
- Powiadomienie Tpay o zwrocie częściowym → `process_tpay_notification` porównuje kwotę zwrotu z `refund_amount` (nie z `amount`).
- Odwołanie wydarzenia z setkami zamówień Tpay → `event-cancel` zleca zwroty partiami po 20 (limit czasu Edge Function); niewysłane zostają w `refund_pending` z flagą `refund_requested_at is null`,
  a zadanie co 10 min (to samo co e-maile) je dokańcza.
- Odwołanie wydarzenia trwającego (dzień 2 z 3) → zwrot pełnej kwoty także za wejściówki użyte dnia 1 (decyzja admina — odwołanie obejmuje całe wydarzenie).
- Opłacony karnet czasowy w bazie produkcyjnej przy wdrożeniu → migracja przerwana (`time_passes_sold`, AC-54).
- Zamknięcie strzelnicy zachodzące na dni blokady → bez znaczenia (przedłużenie o pełne N dni).
- Uprawnienie wygasłe przed „Od” albo kupione po „Do” → bez przedłużenia; kupione w trakcie zamknięcia → przedłużenie o pełne N dni (prostota; zamknięcia > 7 dni są rzadkie).
- Wejście jednorazowe weekendowe a zablokowana sobota → nieważne tego dnia, ważne w inny weekend do `expires_on`.
- Kilka wpisów z kalendarza tego samego dnia — blokuje dowolny z flagą.
- Usunięcie konta z wpisem `email_outbox` `pending` → `skipped` (AC-12); `withdrawal_requests.user_id` → `null`.

## 8. Integracje

- **SMTP (ADR-0009)**: Edge Function `mail-send` (`verify_jwt = false`, POST z `Authorization: Bearer MAIL_INVOKE_SECRET`), klient SMTP po TLS na porcie 465.
  Sekrety Supabase: `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_INVOKE_SECRET`, `SITE_URL` (adres strony — PDF regulaminu i linki).
  Bez `SMTP_HOST` funkcja kończy się `503 mail_not_configured`, wpisy zostają `pending` (staging, lokalnie). Logi: tylko `kind`, id wpisu, kod błędu.
  Wywołanie: `payments-notify`, `event-cancel`, `submit_withdrawal` (przez `pg_net`) zaraz po zatwierdzeniu; `pg_cron` `mail-send-retry` co 10 min (`pg_net`, sekret z Vault).
- **Tpay** (ADR-0002): `payments-refund` przyjmuje `mode` (`full` / `withdrawal`) i wysyła `amount` = `refund_amount`; `event-cancel` (admin JWT) — zwroty pełne po kolei.
- **Przebudowa strony** (ADR-0003): odwołanie wydarzenia i zmiana flagi blokady wywołują `site-rebuild`; godziny otwarcia i lista blokad — pobierane w przeglądarce.
- **Zadania cykliczne** (ADR-0006): `mail-send-retry` (co 10 min, także dokończenie zwrotów po odwołaniu), `purge-opening-hours-exceptions` (nocne, wyjątki starsze niż 30 dni).

## 9. RODO

- E-mail odbiorcy pobierany z `auth.users` w chwili wysyłki; `email_outbox` nie przechowuje adresu ani treści. Wpisy `email_outbox` usuwane z zamówieniem (5 lat) — bez danych osobowych.
- Poczta przez skrzynkę sprzedawcy w domenie steel-valley.pl (2-A) — bez nowego odbiorcy danych w klauzuli RODO.
- Powiadomienie `withdrawal_admin` bez danych osoby (tylko numer zamówienia i link do panelu).
- `withdrawal_requests.comment`, `range_closures.reason` — tekst swobodny, tylko admin; podpowiedź „Nie wpisuj danych osobowych.” (przy przyczynie zamknięcia).
- `calendar_events.cancel_reason` — tekst publiczny; podpowiedź „Nie wpisuj danych osobowych.” (AC-23).
- Zgoda (AC-6) i wersja regulaminu przechowywane z zamówieniem (5 lat od końca roku zakupu, jak zamówienia).

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Zgoda na korzystanie przed upływem 14 dni | 1-A: checkbox obowiązkowy; bez zgody — zakup na miejscu | 2026-11-23 |
| Wysyłka e-maili | 2-A: SMTP skrzynki w domenie steel-valley.pl; dane w `owner-task`, w specyfikacji zmienne (`MAIL_FROM`, `SMTP_*`) | 2026-11-23 |
| Forma regulaminu w e-mailu | 3-A: PDF w załączniku, plik `regulamin-sprzedazy-<data>.pdf`, archiwum wersji | 2026-11-23 |
| Zaokrąglenie zwrotu częściowego | 4-A: na korzyść klienta (wartość wykorzystania w dół do grosza) | 2026-11-23 |
| Punkty opcjonalne 6 i 7 | 5-A: oba w tej specyfikacji; pkt 7 z zadaniem 1, pkt 6 ostatni | 2026-11-23 |
| Odwołanie wydarzenia | 6-A: „Odwołane” w kalendarzu bez zakupu + e-mail do kupujących z kontem | 2026-11-23 |
| Zwroty po 14 dniach | Brak zwrotu, nawet za niewykorzystany karnet; „Anuluj i zwróć” zostaje jako decyzja admina | 2026-11-23 |
| Zamknięcie strzelnicy | Ponad 7 kolejnych dni z przyczyn po stronie Sprzedawcy → przedłużenie `expires_on` o czas zamknięcia | 2026-11-23 |
| Godziny otwarcia, blokada karnetów | Admin prowadzi godziny; karnety nie działają w czasie wydarzeń i zawodów | 2026-11-23 |
| Termin | Regulamin obowiązuje od 1.01.2027 — zmiany na produkcji wcześniej | 2026-11-23 |
| Karnety czasowe | 7-A: wycofane z Oferty od 1.01.2027 (regulamin #154 zaktualizowany); bez zwrotu proporcjonalnego za dni i bez przedłużania okresu — **zmienione 2026-11-24**: nic nie sprzedano, typ `days` usunięty z bazy i kodu | 2026-11-23, 2026-11-24 |

**Założenia analityka (zatwierdzane razem ze specyfikacją — zmień w PR, jeśli inaczej):**
1. Okno odstąpienia: do dnia opłacenia + 14 dni włącznie (Europe/Warsaw); dzień odstąpienia wpisuje admin (domyślnie dziś) — zapis w zamówieniu; kwotę wyznaczają wykorzystane wejścia.
2. Blokada karnetów obejmuje **cały dzień** wydarzenia/zawodów (kalendarz nie ma godzin); steruje nią flaga przy wpisie, domyślnie zaznaczona dla zawodów i wszystkich wydarzeń; odwołane wydarzenie nie blokuje.
3. Karnety czasowe: usunięte 2026-11-24 (US-10) — sprzedaży nie było.
4. Zamknięcie strzelnicy admin wpisuje **po jego zakończeniu** (znany czas trwania); przedłużenie o pełną liczbę dni zamknięcia dla uprawnień ważnych choćby jednego dnia w tym okresie; bez cofania.
5. Godziny otwarcia: jeden przedział na dzień + wyjątki dzienne; pokazywane w `/oferta/#godziny` i linkiem w stopce; nie blokują wpisów do książki.
6. Odwołanie wydarzenia: zwrot pełnej kwoty wszystkich wejściówek (także użytych w trwającym wydarzeniu); prezenty tylko anulowane.
7. Treść zgody (AC-6) — dosłownie z issue #152 także przy wejściu jednorazowym.
8. Oświadczenie o odstąpieniu z `/konto/` od razu wyłącza karnet; zwrot zleca admin jednym kliknięciem (kwota stała, ustalona w chwili oświadczenia).
9. Kupujący po złożeniu oświadczenia dostaje potwierdzenie e-mailem; sprzedawca — powiadomienie na `MAIL_FROM`.

Otwarte: brak.

## 11. Zadania

Kolejność = kolejka realizacji (zależności, potem waga prawna). Wszystkie zadania powinny być na produkcji przed 1.01.2027.

1. #158 Wersja regulaminu, zgoda i „Zamawiam i płacę”: `sales_terms_versions`, `orders.terms_version`, `early_performance_consent_at`, `create_tpay_order`, `payments-create`, `/oferta/zamowienie/`, `/regulamin-sprzedazy/` „Wersje”, `/konto/` (AC-1…AC-8);
   wycofanie karnetów czasowych (AC-53, AC-54 — zastąpione usunięciem typu `days`, migracja `20261201100000_remove_time_passes.sql`).
2. #159 E-maile: ADR-0009, `email_outbox`, `mail-send` (SMTP 465, PDF), `pg_cron` ponowień, `payments-notify`, stan w panelu i „Wyślij ponownie” (AC-9…AC-14).
   PDF pobierany z `SITE_URL` — na stagingu bez pliku PDF w `web/public/regulamin-sprzedazy/` e-mail `order_paid` nie wyjdzie (ADR-0009); test na stagingu z przykładowym PDF.
3. #160 Odstąpienie i zwrot częściowy w panelu: `withdrawal_quote`, `withdraw_order`, `refund_amount`, `payments-refund` z kwotą, powiadomienie o zwrocie częściowym, ostrzeżenie po 14 dniach, `revert_order_refund` bez reaktywacji po odstąpieniu (AC-15…AC-22, AC-52).
4. #161 Blokada karnetów w dniach wydarzeń i zawodów: `blocks_passes`, `range_blocked_on`, `pass_valid_on`, formularze kalendarza, książka, sprzedaż na miejscu, `/oferta/` (AC-40…AC-43, AC-45).
5. #162 Odwołanie wydarzenia: kolumny, `cancel_calendar_event`, `event-cancel`, kalendarz „Odwołane”, lista zwrotów, e-mail `event_cancelled`, nieudany zwrot bez reaktywacji (AC-23…AC-29, AC-51).
6. #163 Zamknięcie strzelnicy i przedłużenie ważności: `range_closures`, `range_closure_passes`, `/panel/zamkniecia/`, `/konto/` (AC-30…AC-34).
7. #164 Godziny otwarcia: tabele, `/panel/godziny/`, `/oferta/#godziny`, stopka (AC-35…AC-39).
8. #165 „Odstąp od umowy” w `/konto/`: `withdrawal_requests`, `submit_withdrawal`, e-maile, filtr w panelu, nieudany zwrot → zgłoszenie `new` (AC-46…AC-50, AC-52).
