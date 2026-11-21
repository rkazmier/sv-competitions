# Architektura

```
 przeglądarka ──► events.steel-valley.pl (GitHub Pages, Astro, statyczny)
       │
       ├──► Supabase Auth            (Google oraz e-mail + hasło; role user / staff / admin — ADR-0004)
       ├──► Supabase PostgreSQL      (dane, dostęp przez RLS, klucz publishable)
       ├──► Supabase Storage         (regulaminy PDF — publiczny `documents`; podpisy — prywatny `signatures`)
       └──► Supabase Edge Functions  (logika z kluczem secret)
                 ├── site-rebuild     ──► GitHub Actions (rebuild-site.yml, ADR-0003)
                 ├── payments-create  ──► Tpay Open API (utworzenie transakcji)
                 ├── payments-notify  ◄── Tpay (powiadomienie JWS) → status zamówienia, uprawnienie
                 ├── payments-refund  ──► Tpay Open API (zwrot)
                 ├── company-lookup   ──► Biała lista MF / GUS REGON (dane firmy po NIP)
                 ├── admin-delete-user ─► Supabase Auth Admin API
                 └── retention        ◄── pg_cron + pg_net (usuwanie starych wpisów i podpisów, ADR-0006)
 Faktury: admin wystawia ręcznie w e-mikrofirmie (KSeF) — bez integracji (ADR-0005)
```

## Środowiska

| Środowisko | Frontend | Supabase | Tpay |
| --- | --- | --- | --- |
| Lokalnie | `npm run dev` | `supabase start` | sandbox |
| Staging | events-staging.steel-valley.pl (repo `sv-competitions-staging`) | `sv-competitions-staging` (ref `xvqlralvzgmaztugghry`, Frankfurt) | sandbox |
| Produkcja | events.steel-valley.pl (Pages tego repo) | `sv-competitions` (ref `kicftecnawfkfpjbtejg`, Frankfurt) | produkcja |

## Zasady

- Frontend nie zna żadnych sekretów; ma tylko URL Supabase i klucz publiczny (publishable, `sb_publishable_…`)
  ze zmiennej `PUBLIC_SUPABASE_ANON_KEY`. Nie używaj starych kluczy `anon`/`service_role` (JWT) — Supabase wycofuje je na początku 2027.
  Po stronie serwera (Edge Functions) używaj klucza secret (`sb_secret_…`), nigdy we frontendzie.
- W obu projektach Supabase włączone jest automatyczne RLS dla nowych tabel w schemacie `public`.
  Migracja i tak musi jawnie zawierać `enable row level security` i polityki — nie polegaj na wyzwalaczu.
- Każda tabela z danymi osobowymi: RLS włączone, polityki per rola (`user`, `staff`, `admin` — ADR-0004).
- Role trzymane w tabeli `profiles`. RLS sprawdza rolę funkcjami `public.is_staff()` / `public.is_admin()` (odczyt z `profiles`;
  `is_organizer()` to alias `is_admin()` z SPEC-001), claim `app_role` w JWT (Custom Access Token Hook) służy tylko interfejsowi.
- Zmiany danych użytkownika dokonane przez inne osoby, role, zwroty, faktury i eksporty książki → `audit_log` (SPEC-002).
  Zapis do `audit_log` tylko funkcjami `security definer`: wyzwalacz `audit_profile_changes` (zmiana danych profilu, gdy
  `auth.uid() <> id`), `set_user_role()` (`role_change`), `admin_log_account_delete()` (`account_delete`, bez danych
  osobowych — tylko identyfikator konta), `revert_pass_usage()` (`pass_usage_revert`, SPEC-005 AC-23), `admin_range_log()` (`range_log_export`, SPEC-005 AC-29).
  Odczyt — tylko admin.
- `profiles` (SPEC-002 §5): klient zmienia wyłącznie kolumny danych (`full_name`, `phone`, `permit_number`, `permit_authority`,
  `address`, `privacy_notice_ack_at` — uprawnienia kolumnowe; własny wiersz, admin — każdy). Wyzwalacz `profiles_normalize`
  przycina tekst i zamienia puste ciągi na `null`. `is_range_ready` liczone w bazie (kolumna generowana).
  `role` — tylko `set_user_role(user_id, role)` (admin, zawsze zostaje jeden admin: błąd `last_admin`);
  `qr_token` — tylko `rotate_qr_token()` (własny). Lista kont z e-mailem: `admin_list_users(search, page)` (admin, 50 na stronę);
  e-mail jednego konta: `admin_user_email(user_id)` (admin).
- Zadania cykliczne: `pg_cron` (ADR-0006); okresy przechowywania jako funkcje SQL zmieniane przez PR.
- Strony publiczne generowane przy budowaniu, panel pobiera dane w przeglądarce; przebudowa po zmianach (ADR-0003).
- Kalendarz strzelnicy = zawody (`competitions`) + wydarzenia (`calendar_events`) w osobnych tabelach, łączone we frontendzie (`CalendarEntry`).
- Daty wpisów (zawody, wydarzenia) i harmonogram w czasie lokalnym strzelnicy (`date`/`time`), znaczniki zapisu w `timestamptz`.
- Kwoty w groszach (`integer`), czas w UTC (`timestamptz`), prezentacja w strefie Europe/Warsaw.
- Status płatności zmienia wyłącznie `payments-notify` po weryfikacji podpisu JWS, sprawdzeniu kwoty i idempotencji.

## Frontend (`web/`)

- `src/styles/tokens.css` — jedyne miejsce z kolorami, fontami, odstępami i promieniami (SPEC-001 §6.1); `base.css` — style bazowe.
- `src/i18n/pl.ts` + `t('sekcja.klucz')` z `src/i18n/index.ts` — wszystkie teksty UI (test AC-3 wykrywa teksty wpisane w szablony `.astro`).
- `src/layouts/BaseLayout.astro` (strony publiczne), `PanelLayout.astro` (menu panelu, `noindex`, bramka logowania).
- `src/lib/supabase.ts` — klient Supabase w przeglądarce (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, PKCE,
  sesja w localStorage pod kluczem `sv-auth`); tworzony leniwie, więc build bez tych zmiennych działa.
- `src/lib/panel.ts` — bramka panelu (ADR-0004): stan z roli w `profiles` (jak w RLS) — logowanie Google / brak uprawnień
  z linkiem do `/konto/` (`user`) / menu obsługi (`staff`) / treść i pełne menu (`admin`). `requireAdmin()` zwraca klienta
  tylko adminowi; skrypty stron kalendarza i słowników pobierają dane dopiero po niej. Strony z `PanelLayout access="staff"`
  (książka, sprzedaż na miejscu) pokazują treść także obsłudze i pobierają dane po `requireStaff()`. Menu obsługi i admina — `PanelLayout.astro`.
- Konta (SPEC-002 AC-1…AC-6): `/rejestracja/`, `/logowanie/` (z „Nie pamiętam hasła”), `/logowanie/nowe-haslo/`, `/konto/`.
  Logika bez DOM w `src/lib/auth.ts` (`?next=` tylko ścieżki aplikacji, walidacja, mapowanie błędów Auth), wyspy w `src/lib/auth-ui.ts`.
  Google i link potwierdzający wracają na `/konto/` — tam pierwsze logowanie bez `privacy_notice_ack_at` pokazuje klauzulę
  (`PrivacyNotice.astro`) z „Rozumiem”, potem przejście do `?next=`. Rejestracja e-mailem przekazuje `privacy_notice_ack: true`
  w metadanych konta, a wyzwalacz `handle_new_user` zapisuje czas potwierdzenia. Linki w e-mailach Auth niosą `token_hash`
  (szablony `supabase/templates/`, `verifyOtp`), więc działają też na innym urządzeniu. Nagłówek stron publicznych
  (`HeaderAuthLinks.astro`): „Zaloguj się” / „Moje konto” / „Panel” z sesji w localStorage i claimu `app_role` — bez zapytań;
  wyjątek (SPEC-009, ADR-0008): rola `user` pyta raz na kartę i dzień `rpc/is_range_duty_officer` (`fetch` z tokenem sesji)
  i pokazuje „Książka” → `/panel/ksiazka/` dyżurnemu; wynik w `sessionStorage` `sv-duty-link` (`sub`, dzień Europe/Warsaw),
  nadpisywany przez `/konto/` i bramkę panelu, usuwany przy wylogowaniu.
- Panel użytkownika (SPEC-002 AC-7…AC-15): `/konto/` — blok braków albo „Gotowy do wpisu do książki” (z kolumny
  `is_range_ready`), kod QR, „Twoje dane”; `/konto/dane/` — formularz danych (zapis tylko kolumn z uprawnieniami
  kolumnowymi, własny wiersz). Walidacja i lista braków bez DOM w `src/lib/profile.ts` (te same limity co `check` w bazie),
  wyspy w `src/lib/account-ui.ts`. Pola formularza — `src/components/ProfileFields.astro` (wspólne z kartą użytkownika w panelu).
  Kod QR (`src/lib/qr.ts`) to SVG generowany w przeglądarce z pakietu `qrcode` (treść = sam `qr_token`, bez usług
  zewnętrznych); pełny ekran to `<dialog>` z wpisem w historii (gest wstecz zamyka), druk — styl `@media print`
  w `pages/konto/index.astro`, nowy kod — `rpc('rotate_qr_token')`.
- Panel admina — konta (SPEC-002 AC-16…AC-18, AC-20, AC-21, tylko admin): `/panel/uzytkownicy/` — lista z wyszukiwarką
  (`rpc/admin_list_users`; fraza nie trafia do adresu strony), `/panel/uzytkownicy/profil/?id=` — e-mail (`rpc/admin_user_email`),
  dane (zapis do `profiles` jak w `/konto/dane/`, wpis w `audit_log` robi wyzwalacz), rola (`rpc/set_user_role`, potwierdzenie,
  błąd `last_admin`), „Historia zmian” (`audit_log` z autorem przez `actor_id`, od najnowszych, 100 ostatnich).
  „Usuń konto” (AC-23…AC-25): ostrzeżenie i wpisanie „USUŃ”, potem Edge Function `admin-delete-user`; na własnej karcie
  przycisk niedostępny. Logika bez DOM w `src/lib/admin-users.ts`, wyspy w `src/lib/admin-users-ui.ts`.
- `src/lib/calendar.ts` — typ `CalendarEntry` (zawody + wydarzenia), kolejność wpisów, „dziś” w Europe/Warsaw
  i grupowanie nadchodzących po miesiącach (`upcomingByMonth`).
- Strony publiczne (`/`, `/zawody/<slug>/`) pobierają dane **przy budowaniu** w `src/lib/public-data.ts` (klucz publishable,
  tylko opublikowane, jedno pobranie na build). Błąd Supabase = błąd buildu. Brak zmiennych Supabase jest dozwolony tylko
  bez `PUBLIC_APP_ENV` (lint/test/build w CI) — wtedy strony są puste; wdrożenia (staging, produkcja) ustawiają `PUBLIC_APP_ENV`
  i bez zmiennych build się nie uda.
- `src/lib/competition-page.ts` — widok strony zawodów i wiersze → `CalendarEntry`; `src/components/CalendarCard.astro` (karta wpisu),
  `CompetitionDetails.astro` (strona zawodów; bez `view` — pusty wzór wypełniany w podglądzie panelu przez
  `src/lib/competition-view-ui.ts`, `/panel/zawody/podglad/?id=`). Opisy: `src/lib/text.ts` (akapity, `meta description`).
- Panel wydarzeń (`/panel/wydarzenia/nowe/`, `/panel/wydarzenia/edytuj/?id=`): `src/components/CalendarEventForm.astro`,
  `src/lib/calendar-event-form-ui.ts` (wyspa), `src/lib/calendar-events.ts` (walidacja jak `check` w `calendar_events`).
  Podgląd karty to `CalendarCard.astro` bez `entry` (ukryty pusty wzór) wypełniany w przeglądarce przez `src/lib/calendar-card-ui.ts`.
- Panel produktów (SPEC-003 AC-1…AC-4, tylko admin): `/panel/oferta/` — formularz dodawania/edycji, lista w grupach rodzaju,
  „Pokaż w ofercie” / „Ukryj”, strzałki kolejności (`rpc/move_product`). Walidacja, ceny (zł ↔ grosze, `120,00 zł`) i grupy
  bez DOM w `src/lib/products.ts`, wyspa `src/lib/products-ui.ts`. Produkt z zamówieniami (`rpc/product_has_orders`) ma zablokowane
  pola rodzaju, liczby wejść/dni i dnia. `/oferta/` pobiera produkty w przeglądarce, więc zmiany nie uruchamiają `site-rebuild`.
- Oferta i zakup (SPEC-003 AC-5…AC-7, AC-10, AC-12…AC-15): `/oferta/` (link „Oferta” w nagłówku) — aktywne produkty w grupach
  rodzaju, pobierane w przeglądarce; „Kup” prowadzi do `/oferta/zamowienie/?product=` (gość — przez `/logowanie/?next=`).
  Podsumowanie pobiera cenę z bazy, wymaga akceptacji regulaminu sprzedaży (`/regulamin-sprzedazy/`, tekst zastępczy do czasu #39),
  ma sekcję „Faktura” (SPEC-004, niżej) i wywołuje `payments-create` z `{ product_id, request_key, invoice? }` (nowy klucz na kliknięcie,
  przycisk zablokowany do odpowiedzi), potem przekierowanie na bramkę Tpay. `/konto/platnosc/?order=` czyta `orders.status`
  co 3 s przez maks. 60 s. `/konto/` — „Twoje karnety” (aktywne: `status = 'active'` i dziś ≤ „Ważny do”), „Historia karnetów”
  (`<details>`), „Historia płatności” (tabela od najnowszych), „Przedłuż karnet” → `/oferta/`. Zapytania z kluczem publishable
  i JWT — RLS zwraca tylko własne `orders`, `user_passes`, `pass_usages`. Logika bez DOM: `src/lib/offer.ts`, wyspy `src/lib/offer-ui.ts`.
- Sprzedaż na miejscu (SPEC-003 AC-21…AC-23, obsługa i admin): `/panel/sprzedaz/` (`PanelLayout access="staff"`, `requireStaff`;
  pozycja „Sprzedaż” w menu obsługi i admina). Osoba — skan kodu QR (`rpc/staff_find_by_qr`, SPEC-005 AC-5), `rpc/staff_search_people` albo
  „Osoba bez konta”; lista pozycji (aktywne produkty i wejściówki na trwające płatne wydarzenia, dla osoby bez konta zawężona
  do dziś), „Gotówka” / „Terminal”, zapis `rpc/create_on_site_order`. Poniżej `rpc/staff_on_site_sales_today` z sumami
  gotówki i terminala (tylko `paid`). Logika bez DOM: `src/lib/on-site-sales.ts`, wyspa `src/lib/on-site-sales-ui.ts`.
  Z książki (`?osoba=<id>&powrot=ksiazka`, SPEC-005 AC-12): osoba wybrana od razu (`rpc/staff_person_by_id`), po sprzedaży
  tej osobie powrót do `/panel/ksiazka/?osoba=<id>`.
- Zamówienia (SPEC-003 AC-24…AC-27, tylko admin): `/panel/zamowienia/` (`requireAdmin`, pozycja „Zamówienia” w menu admina).
  Filtry (zakres dat — domyślnie bieżący miesiąc, status, metoda, produkt lub wejściówka, osoba) → `rpc/admin_list_orders`,
  suma kwot widoku, „Eksportuj CSV” (generowany w przeglądarce: BOM, `;`, kwota `120,00`, formuły arkusza neutralizowane).
  „Anuluj i zwróć” (okno `<dialog>` z opcjonalną notatką) przy `paid` bez zużycia uprawnienia; Tpay → Edge Function
  `payments-refund`, na miejscu → `rpc/cancel_order`. Używany karnet: „Karnet był używany — zwrot poza systemem.”.
  Logika bez DOM: `src/lib/orders-admin.ts`, wyspa `src/lib/orders-admin-ui.ts`.
- `src/lib/site.ts` — adres produkcyjny: `link rel=canonical`, `og:url` i `og:image` (`public/og-default.png`) zawsze na produkcję.
- Komponenty `.astro`: test przez Container API (`astro/container`, `vitest.config.ts` z `getViteConfig`).
- `src/components/DictionaryList.astro` + `src/lib/dictionary*.ts` — wspólna lista słownikowa (dyscypliny, kategorie,
  prowadzący strzelanie); ustawienia list (tabela, kolumna nazwy, długość, unikalność, przebudowa) w `DICTIONARIES`.
- Książka — prowadzący (SPEC-005 AC-1…AC-4): `/panel/prowadzacy/` (admin) — lista `range_officers` (imię i nazwisko, nr legitymacji,
  instytucja — `OFFICER_INSTITUTIONS` w `src/lib/dictionary.ts`, pola dodatkowe tylko dla tej listy) z „Ukryj” / „Przywróć”,
  bez usuwania (zmiana nazwiska nie zmienia wpisów — kopia w `range_log.range_officer_name`). `/panel/ksiazka/` (obsługa i admin) —
  dyżurny Prowadzący w bazie (SPEC-007 AC-15…AC-17, AC-19, #116; zastąpił wybór w localStorage `sv-range-shift`):
  bez dyżurnego „Kto prowadzi dziś strzelanie?” z widocznymi prowadzącymi (`rpc/range_officer_choices`) i wyszukiwarką
  (`rpc/staff_search_range_officers`, także ukryci), wybór → `rpc/set_range_duty`; z dyżurnym „Prowadzący strzelanie: …” (+ „(z grafiku)” /
  „(<nazwa>)”) i „Zmień” (`rpc/current_range_duty`). Prowadzący wpisu (SPEC-007 AC-18…AC-21, #117) = dyżurny pobrany przy
  otwarciu kroku podpisu; tam „Prowadzący: …” + „Zmień” — lista `rpc/range_officer_choices(person_id)` (osoba wpisywana
  z zatwierdzonymi uprawnieniami pierwsza, także ukryta) i wyszukiwarka; wybór dotyczy tylko tego wpisu (dyżurny bez zmian).
  Brak dyżurnego → ponowny wybór (zdarzenia `range-duty:missing` / `range-duty:changed` na korzeniu strony). Lista
  z wyszukiwarką — `src/components/OfficerPicker.astro` + `src/lib/range-officer-picker-ui.ts`; logika `src/lib/range-duty.ts`,
  wyspy `src/lib/range-log-ui.ts`, `src/lib/range-entry-ui.ts`.
  SPEC-007 (#112, dalsze zadania): zgłoszenia z kont w „Twoje dane” (`rpc/my_range_officer`, `rpc/save_my_range_officer`) i zatwierdzanie w `/panel/prowadzacy/`.
  Grafik dyżurów (SPEC-007 AC-22…AC-25, #119): `/panel/dyzury/` (Obsługa i admin, „Dyżury” w menu) — 30 dni od dziś
  („Pokaż kolejne 30 dni”, do dziś + 90), dyżurny ze źródłem (`rpc/range_duty_schedule`), „Ustaw” / „Zmień” pod dniem (ten sam
  `OfficerPicker`) → `rpc/set_scheduled_range_duty`, „Usuń z grafiku” → `rpc/clear_scheduled_range_duty`; podpowiedzi AC-24, AC-25;
  logika `src/lib/range-duty-schedule.ts`, wyspa `src/lib/range-duty-schedule-ui.ts`. Dyżurny zawodów i wydarzeń
  (SPEC-007 AC-26…AC-30, #120): pole „Dyżurny Prowadzący (opcjonalnie)” w formularzach zawodów i wydarzeń
  (`src/components/DutyOfficerField.astro` z `OfficerPicker`, wyspa `src/lib/calendar-duty-ui.ts`, logika `src/lib/calendar-duty.ts`);
  odczyt `rpc/admin_calendar_duty`, zapis `duty_range_officer_id` razem z formularzem; zmiana samego dyżurnego nie uruchamia
  `site-rebuild` (przebudowa tylko przy zmianie pól publicznych opublikowanego wpisu). Kolejność: książka → zawody / wydarzenie → grafik (`range_duty_for`).
  Zatwierdzanie (SPEC-007 AC-7…AC-10, #115): `/panel/prowadzacy/` dostępne też dla Obsługi (`PanelLayout access="staff"`) —
  sekcja „Do zatwierdzenia (n)” (`rpc/review_range_officer`, `src/lib/range-officer-review*.ts`), lista tylko do odczytu dla Obsługi,
  oznaczenia „Z konta” / „Ukryty dla innych”, zgłoszeń z kont admin nie edytuje (tylko „Ukryj” / „Przywróć”); „Prowadzący (n)” w menu
  admina i obsługi (licznik `pending` z `range_officers`, aktualizowany zdarzeniem `sv:officers-pending`).
- Książka — wpis osoby z kontem (SPEC-005 AC-5…AC-12): w `/panel/ksiazka/` po wyborze prowadzącego „Skanuj kod QR”
  (`src/lib/qr-scanner.ts` + `src/components/QrScanDialog.astro`: `getUserMedia` z tylną kamerą, `BarcodeDetector`,
  a gdy brak formatu `qr_code` — `jsqr` ładowany dynamicznie; ten sam skaner w `/panel/sprzedaz/`), wyszukiwarka
  (`rpc/staff_search_people`) albo `?osoba=<id>` (karta użytkownika „Rozpocznij wpis do książki”, powrót ze sprzedaży).
  Karta osoby: ostrzeżenie o dzisiejszym wpisie z „Kontynuuj” (AC-9), braki i „Uzupełnij dane” tylko z brakującymi polami
  (`rpc/staff_complete_profile`, AC-7), uprawnienia `rpc/passes_for_range_entry` jako lista wyboru z opisem skutku (AC-10, AC-11),
  bez uprawnienia — „Sprzedaj na miejscu” i „Wpisz jako osobę towarzyszącą” (AC-12). „Dalej” aktywny tylko przy komplecie
  danych i wybranym uprawnieniu. Logika `src/lib/range-entry.ts`, wyspa `src/lib/range-entry-ui.ts`.
- Książka — podpis i zapis (SPEC-005 AC-13…AC-20): ekran podpisu w trybie „podaj urządzenie” (`body.handover` ukrywa
  nawigację): dane wpisu (osoba z kontem — `rpc/staff_person_entry_data`), regulamin strzelnicy i — dla osoby bez konta —
  klauzula informacyjna (`PrivacyNoticeText.astro`, treść `privacy.body`; regulamin — tekst zastępczy `rangeSign.rulesPlaceholder` do czasu #39), pole podpisu `<canvas>` (`touch-action: none`,
  „Zapisz wpis” od 20 punktów ścieżki). Zapis: klient nadaje `id` wpisu, PNG (białe tło, ≤ 200 KB) → `signatures/<RRRR>/<MM>/<id>.png`,
  potem `rpc/create_range_log_entry`; ponowienie z tym samym podpisem używa tego samego `id` (plik „już istnieje” = OK),
  po zmianie podpisu — nowe `id` (stary plik usuwa retencja po 24 h, AC-31). „Osoba bez konta”: formularz (walidacja SPEC-002),
  potem sprzedaż na miejscu w tym samym ekranie (`rpc/create_on_site_order` z `p_user_id = null`) i jej uprawnienie
  (`user_passes` po `order_id`) do zużycia. Po wpisie „Dodaj osobę towarzyszącą” — ten sam przebieg bez kroku uprawnienia
  (`is_companion`). Logika `src/lib/range-sign.ts`, pole podpisu i zapis `src/lib/range-sign-ui.ts`.
- Książka — adnotacje, cofnięcie zużycia, historia (SPEC-005 AC-21…AC-25): w `/panel/ksiazka/` lista „Dzisiejsze wpisy”
  (godzina, imię i nazwisko; `range_log` z dzisiejszego dnia Europe/Warsaw, odświeżana po zapisie — zdarzenie `range-entry-saved`),
  ukryta w trybie „podaj urządzenie”; przy wpisie adnotacje (autor przez `profiles!range_log_annotations_created_by_fkey`, czas,
  treść) i „Dodaj adnotację” (5–500 znaków, `insert` do `range_log_annotations`; odrzucenie RLS `42501` → komunikat AC-22).
  Adnotacje do starszych wpisów — admin w przeglądzie książki. Formularz adnotacji wspólny:
  `src/components/AnnotationForm.astro` + `src/lib/range-annotation-ui.ts`. Karta użytkownika (admin) — „Karnety i zużycie”:
  `user_passes` osoby z niecofniętymi `pass_usages` i „Cofnij zużycie” → `rpc/revert_pass_usage` (AC-23), potem odświeżenie
  „Historii zmian”. `/konto/` — „Historia wejść” (`rpc/my_range_entries`, od najnowszych, bez podpisów; osoba towarzysząca —
  „osoba towarzysząca”) i w każdym karnecie zwinięta „Historia zużycia” (data i godzina niecofniętych zużyć, AC-25).
  Logika `src/lib/range-history.ts`, wyspy `src/lib/range-today-ui.ts`, `src/lib/range-revert-ui.ts`, `src/lib/offer-ui.ts`.
- Książka — przegląd i eksport (SPEC-005 AC-26…AC-29): `/panel/ksiazka/przeglad/` (admin, menu „Przegląd książki”) — filtry
  data od–do (domyślnie dziś), imię i nazwisko, prowadzący; kolumny książki (bez kolumn technicznych), miniatura podpisu
  przez podpisany link 60 s (`storage.createSignedUrls`), pod wpisem adnotacje i „Dodaj adnotację” (admin — dowolny wpis).
  Każde pobranie wpisów to `rpc/admin_range_log(format)`: `view` (lista z podpisami), `pdf`, `csv` — funkcja zapisuje
  `range_log_export` w `audit_log`. Eksport wymaga dnia lub zakresu dat. CSV: UTF-8 z BOM, `;`, data `RRRR-MM-DD GG:MM`
  (Europe/Warsaw), podpis „tak”, adnotacje w ostatniej kolumnie. PDF w przeglądarce: `pdf-lib` + `@pdf-lib/fontkit`
  (ładowane dynamicznie przy eksporcie), A4 poziomo, nagłówek z zakresem dat, obrazy podpisów (pobrane z linków 60 s),
  adnotacje pod wpisem, „Strona X z Y”; font Inter z `public/fonts/inter-{400,600}.otf` (OTF z tych samych podzbiorów co
  WOFF2 — pdf-lib osadza plik bez konwersji; bez podzbioru i bez `calt`, inaczej czytniki źle rysują tekst). Błąd pobrania
  podpisu przerywa eksport. Logika `src/lib/range-review.ts`, PDF `src/lib/range-pdf.ts`, wyspa `src/lib/range-review-ui.ts`.
- `src/components/CompetitionForm.astro` + `src/lib/competition*.ts` — formularz zawodów (`/panel/zawody/nowe/`, `/panel/zawody/edytuj/?id=`),
  matchbook i harmonogram; matchbook i harmonogram dostępne po pierwszym zapisie (potrzebują `id` zawodów).
- Teksty z bazy trafiają do DOM tylko przez `textContent` (bez `innerHTML`).
- `src/lib/site-rebuild.ts` — wywołanie Edge Function `site-rebuild` z panelu i komunikat (AC-25 / §7). Wywołują je:
  publikacja i cofnięcie publikacji zawodów, każdy zapis opublikowanych zawodów (formularz, matchbook, harmonogram),
  zmiana nazwy i ukrycie/przywrócenie dyscypliny lub kategorii, zmiana tytułu regulaminu, przycisk „Odśwież stronę publiczną” w `/panel/`.
- `src/lib/dates.ts` — formatowanie dat i zakresów (`pl-PL`, dni liczone w UTC).
- Fonty lokalnie w `public/fonts/` (te same pliki co landing-page). `PUBLIC_SITE_URL` → `site` w `astro.config.mjs`.
- Testy: Vitest (`web/src/**/*.test.ts`), Playwright w katalogu głównym (`playwright.config.ts`, `tests/e2e/`).
  Testy panelu wymagają `supabase start`: `playwright.config.ts` bierze URL i klucze z `supabase status`
  (tylko lokalna instancja), użytkownicy testowi z hasłem powstają przez API administratora lokalnego Supabase,
  sesja jest wstrzykiwana do localStorage (bez Google). W CI `supabase start` uruchamia Auth i REST.
  Testy z e-mailami Auth (rejestracja, ponowny link, reset hasła) czytają skrzynkę lokalnego Mailpit (`MAILPIT_URL`);
  bez Mailpit (dziś w CI `-x mailpit`) są pomijane.

## Baza (`supabase/`)

- Migracje w `supabase/migrations/`, testy pgTAP w `supabase/tests/` (`supabase test db`, uruchamiane w CI).
- `supabase/seed.sql` — fikcyjne dane tylko lokalnie i w CI (`supabase start` / `db reset`; `db push` ich nie wczytuje):
  zawody i wydarzenia z datami liczonymi od dziś, dla strony publicznej i testów E2E. Testy pgTAP, które liczą wiersze,
  usuwają dane seed w swojej transakcji.
- `created_by` w `rulebooks`, `competitions`, `calendar_events` (oraz `duty_range_officer_id` w `competitions`, `calendar_events`)
  nie ma uprawnienia `select` dla `anon` ani `authenticated`
  (uprawnienia kolumnowe). Zapytania z frontendu **wymieniają kolumny jawnie** — `select('*')` na tych tabelach kończy się błędem 42501.
  `created_by` ustawia wyzwalacz (`auth.uid()`), klient go nie podaje.
- Wyzwalacze: `published_at` przy pierwszej publikacji (zawody, wydarzenia), `updated_at`, `slug` zawodów
  (`<starts_on>-<nazwa-ascii>`, sufiks `-2`… przy kolizji, zamrożony od pierwszej publikacji), zakres dnia punktu harmonogramu,
  niezmienność pliku regulaminu.
- Błędy z wyzwalaczy mają kod `23514` i stały komunikat do mapowania w UI na tekst i18n:
  `schedule_item_day_out_of_range` (AC-22), `rulebook_file_immutable` (AC-16), `product_has_orders` (SPEC-003 AC-3).
- `products` (SPEC-003 §5): wyzwalacz `products_before_write` — trim nazwy i opisu, nowy produkt zawsze ukryty
  i na końcu swojej grupy (`position`), blokada zmiany `kind`, `entries`, `days`, `day_type`, gdy produkt ma zamówienia.
  Sprawdzenie zamówień w `product_order_exists()` (wewnętrzna, zapytanie do `orders`).
  Bez `delete` dla klientów (ukrycie zamiast usunięcia). `move_product(id, 'up'|'down')` — zamiana z sąsiadem w grupie (RLS: admin).
- `orders`, `user_passes` (SPEC-003 §5): klient ma tylko `select` (własne; obsługa — wszystkie); `payment_notifications` bez dostępu.
  Zapis wyłącznie funkcjami `security definer` i kluczem secret:
  - `fulfil_order(order_id)` — tylko `service_role` (`payments-notify`): `pending`/`cancelled` → `paid` + uprawnienie w jednej transakcji,
    idempotentna; `expires_on` = `pass_expires_on(dzień zakupu)` (+ `pass_validity()` = 1 rok), bez konta — dzień zakupu.
  - `create_on_site_order(user_id | null, product_id | null, 'cash'|'terminal', event_id | null)` — obsługa (AC-21, AC-22):
    dokładnie jedno z produktu i wejściówki; wejściówka jak w `create_tpay_order` (opublikowane płatne wydarzenie, do ostatniego dnia,
    limit z blokadą wiersza); bez konta tylko wejście jednorazowe pasujące do dziś albo wejściówka na wydarzenie trwające dziś.
  - `staff_on_site_sales_today()` — obsługa (AC-23): dzisiejsze (Europe/Warsaw) zamówienia `on_site` od najnowszych — godzina,
    pozycja, kwota, gotówka/terminal, stan, imię i nazwisko sprzedającego (bez danych kupującego); `order_number` (SPEC-006).
  - `cancel_order(order_id, note)` — admin, tylko `paid` bez zużycia (`pass_has_usage`: stan uprawnienia + niewycofane `pass_usages`);
    Tpay → `refund_pending`, na miejscu → `refunded`; wpis `order_refund` w `audit_log`.
  - `admin_list_orders(from, to, status, method, product_id, event_id, person)` — admin (AC-24): zamówienia z filtrami (dni
    w Europe/Warsaw, osoba — fragment imienia i nazwiska lub e-maila z `auth.users`), osoba, sprzedający, `pass_used` (AC-26), `invoice_requested` (SPEC-004 AC-14),
    `order_number`; `person` w formie numeru zamówienia → tylko to zamówienie, pozostałe filtry pominięte (SPEC-006 AC-10).
  - `revert_order_refund(order_id, actor_id)` — tylko `service_role` (`payments-refund`): Tpay odrzucił zwrot →
    `refund_pending` → `paid`, uprawnienie znów `active`, wpis `order_refund` (`reason: tpay_refund_failed`).
  - `passes_valid_on(user_id, date)` — invoker (RLS), reguły ważności z §5; wyzwalacz `user_passes_before_write` liczy
    `valid_until` karnetu czasowego z `first_used_on` i ustawia `used_up` przy `entries_left = 0`.
  - `cancel_unpaid_orders()` — `pg_cron` `cancel-unpaid-orders` (`5 * * * *` UTC): `pending` starsze niż 24 h → `cancelled` (AC-11).
  - Płatności Tpay (tylko `service_role`, ADR-0002): `create_tpay_order(user_id, product_id | event_id, request_key)` — `pending`
    z ceną z bazy, wynik z `order_number`; ten sam `request_key` konta → istniejące zamówienie (`duplicate`, unikalny indeks `(user_id, request_key)`);
    wejściówka z blokadą wiersza wydarzenia, limit `capacity` liczy `paid` + `pending` młodsze niż `ticket_reservation()` (30 min).
    `attach_tpay_transaction` (id i tytuł transakcji), `discard_tpay_order` (Tpay niedostępny — usuwa `pending` bez transakcji).
    `process_tpay_notification(hash, tytuł, order_id, kwota, wpłata, czy_wpłata, czy_zwrot)` — w jednej transakcji: idempotencja po
    `payload_hash`, zgodność `tpay_title` i kwot, `fulfil_order` albo zwrot, wpis do `payment_notifications`; wynik `paid` /
    `already_paid` / `refunded` / `already_refunded` / `ignored_status` / `order_not_found` / `transaction_mismatch` / `amount_mismatch`, powtórzenie → `duplicate:<wynik>`.
  Błędy (`raise`, do mapowania w UI): `forbidden`, `guest_product_not_allowed`, `invalid_on_site_method`, `order_not_paid`, `pass_used`,
  `product_unavailable`, `event_unavailable`, `sales_closed`, `sold_out`.
- Faktury (SPEC-004 §5, ADR-0005 — wystawia admin ręcznie w e-mikrofirmie): `billing_details` (jeden wiersz na konto,
  kaskada z `profiles`; RLS: własny wiersz — odczyt i zapis, obsługa — odczyt, admin — zapis cudzych). Wyzwalacz
  `billing_details_before_write`: `normalize_nip` (spacje, myślniki, prefiks `PL`), trim, `updated_at`.
  `is_valid_nip(nip)` (10 cyfr, suma kontrolna) i `is_valid_ksef_number` (`NIP-RRRRMMDD-12 hex-2 hex`) — w `check` i funkcjach.
  `orders`: `invoice_requested`, kopia `invoice_nip`, `invoice_company_name`, `invoice_company_address`, `invoice_data_source`
  (`vat_whitelist` / `regon` / `manual`), `invoice_fetched_at` (null dla `manual`), oraz `invoice_number`, `ksef_number`,
  `invoice_issued_at`, `invoice_issued_by`; stany pilnują `check` (`orders_invoice_details`, `orders_invoice_issued`),
  indeks częściowy `orders_invoice_todo_idx` dla listy „Do wystawienia”. Zapis tylko funkcjami `security definer`:
  - `set_order_invoice_details(order_id, nip, name, address, source, fetched_at, save_billing_details)` — klucz secret
    (`payments-create`, AC-5), admin (AC-14) albo obsługa dla własnej sprzedaży `on_site` (AC-9); tylko przed wystawieniem
    i nie dla zwróconych. `save_billing_details` (nadpisanie `billing_details` właściciela zamówienia) — tylko klucz secret i admin.
  - `mark_invoice_issued(order_id, invoice_number, ksef_number)` — admin (AC-12): opłacone z żądaniem faktury; wpis `invoice_issued`.
  - `unmark_invoice(order_id)` — admin (AC-13): czyści numer, KSeF, kto/kiedy; wpis `invoice_unmarked`.
  Błędy: `forbidden`, `order_not_found`, `invalid_nip`, `invalid_company_name`, `invalid_company_address`, `invalid_data_source`,
  `invalid_invoice_number`, `invalid_ksef_number`, `invoice_not_requested`, `invoice_already_issued`, `invoice_not_issued`,
  `order_not_paid`, `order_refunded`.
  Interfejs (AC-1…AC-9): wspólny komponent `InvoiceFields.astro` + wyspa `src/lib/invoice-ui.ts` (logika bez DOM:
  `src/lib/invoice.ts` — normalizacja i suma kontrolna NIP jak w bazie): NIP → `company-lookup` → dane z rejestru
  (przyjęte bez ręcznego potwierdzenia) albo wpis ręczny (`manual`, „Dane są poprawne”); zapisane `billing_details` →
  NIP wypełniony i automatyczne pobranie z rejestru (gdy rejestr nie zwróci danych — zapisane dane). Nic nie zapisuje
  sama — zapis robi strona: `/oferta/zamowienie/` przekazuje `invoice` do `payments-create` („Zapłać” nieaktywny do potwierdzenia),
  `/konto/dane/` — `upsert`/`delete` własnego `billing_details` (RLS), `/panel/sprzedaz/` — `rpc/set_order_invoice_details`
  po `create_on_site_order` (bez `save_billing_details`; błąd → sprzedaż zostaje, komunikat „poproś admina”).
  `/konto/` — „Faktura: w przygotowaniu” / „Faktura: <numer>” w „Historii płatności”.
  Panel faktur (AC-10…AC-16, admin): `admin_list_invoices(tab, from, to)` — `todo` (opłacone z żądaniem faktury bez numeru,
  od najstarszej płatności; zwrócone znikają) albo `issued` (z numerem, także zwrócone, od najnowszego oznaczenia; `issued_by_name`
  — imię i nazwisko albo e-mail oznaczającego); zakres dat zapłaty w Europe/Warsaw; błąd `invalid_tab`. `/panel/faktury/`
  (`src/lib/invoices-admin-ui.ts`, logika bez DOM `src/lib/invoices-admin.ts`): zakładki, rozwijane pozycje z „Kopiuj”
  (Clipboard API), `mark_invoice_issued` / `unmark_invoice`, eksport CSV bieżącej zakładki (BOM, `;`), ostrzeżenie o korekcie
  przy zwrocie. Menu admina: „Faktury (n)” — liczba „Do wystawienia” (`count` z `orders`, RLS). `admin_list_orders` zwraca też
  `invoice_requested`; `/panel/zamowienia/` — „Dodaj dane do faktury” przy opłaconych bez faktury (`InvoiceFields` w oknie,
  `set_order_invoice_details` z `save_billing_details = false`, AC-14). Numer zamówienia na fakturze = `orders.order_number` (SPEC-006).
- Numer zamówienia (SPEC-006 §5): `orders.order_number` (`SV-RRRR-NNNNNN`, `unique`, `not null`) z sekwencji
  `order_number_seq` (ciągła, rok utworzenia w Europe/Warsaw); nadaje wyzwalacz `orders_before_insert_number`, zmianę blokuje
  `orders_before_update_number` (`order_number_immutable`, także `service_role`); `normalize_order_number(text)` — forma
  numeru z pola wyszukiwania (wielkość liter, spacje, zera wiodące) albo `null` (ta sama logika w `web/src/lib/order-number.ts` — komunikat w UI). `orders.id` (UUID) zostaje kluczem, w adresach i w `tr_crc` Tpay;
  `order_number` — w UI, CSV, wyszukiwaniu `admin_list_orders` i `description` transakcji Tpay.
- Książka rejestru pobytu (SPEC-005 §5): `range_officers` (obsługa czyta, admin zapisuje, bez `delete`), `range_log`,
  `range_log_annotations`, `pass_usages`. Wpisy i adnotacje bez `update`/`delete` dla wszystkich ról (także `service_role`);
  wyzwalacz `range_log_immutable` (`23514 range_log_immutable`) przepuszcza tylko `on delete set null` kluczy obcych,
  a `delete` — tylko gdy zadanie retencji ustawi w transakcji `sv.range_log_purge = on` (#64). Odczyt: admin — całość,
  obsługa — dzisiejsze (`range_today()`, Europe/Warsaw z zegara bazy); adnotacje — `insert` admin do dowolnego, obsługa
  do dzisiejszego wpisu (`created_by = auth.uid()`). Bucket `signatures` prywatny (PNG, 200 KB): `insert` obsługa pod nazwą
  `<RRRR>/<MM>/<id wpisu>.png` (`range_log.signature_path`), `select` admin (podpisane linki), bez `update`/`delete`
  (upload bez `upsert`). Funkcje:
  - Prowadzący z konta (SPEC-007 §5, #113): `range_officers.profile_id` (unikalny, `on delete cascade`; `null` = dodany przez
    admina), `status` `pending`/`approved`/`rejected` (domyślnie `approved`), `hide_from_others`, `submitted_at`, `reviewed_by`,
    `reviewed_at`. „Na liście” = `is_active and status = 'approved'`. Admin dodaje tylko wiersze bez konta; w zgłoszeniach
    z kont zmienia z API tylko `is_active` (wyzwalacz `range_officers_account_guard`, `42501 forbidden`). `full_name` zgłoszenia
    = kopia `profiles.full_name` (wyzwalacz `sync_range_officer_name`; wyczyszczone nazwisko nie nadpisuje kopii).
    Użytkownik — bez dostępu do tabeli, tylko `my_range_officer()`, `save_my_range_officer(license_number, institution,
    institution_other?, hide_from_others? = true)` (`pending` przy nowym, przywróconym i zmianie nr / instytucji; błędy
    `full_name_required`, `23514` z nazwą `check`), `set_my_range_officer_hidden(hidden)`, `remove_my_range_officer()`
    (`is_active = false`). `review_range_officer(id, decision)` — obsługa i admin, tylko `pending` z kontem; `audit_log`
    `range_officer_review` (`changes`: `range_officer_id`, `decision`, nr legitymacji, instytucja); błędy `forbidden`,
    `invalid_decision`, `not_pending`.
  - Dyżurny Prowadzący (SPEC-007 §5, #116): `range_duty` (PK `day`, `source`; `source` `book` / `schedule`; `range_officer_id`
    `on delete cascade`, `set_by`, `set_at`), `select` obsługa i admin, zapis tylko przez funkcje. `range_duty_for(day)` —
    wewnętrzna (bez `execute` dla API): pierwsze źródło z prowadzącym „na liście” w kolejności `book` → zawody / wydarzenie
    trwające w tym dniu, także szkice (#120, `event_name` = nazwa) → `schedule`; zwraca `range_officer_id`, `full_name`, `source` (`book` / `event` / `schedule`), `event_name`.
    Obsługa i admin: `current_range_duty()` (= `range_duty_for(range_today())`), `set_range_duty(officer_id)` (upsert
    `range_today()`, `book`; błąd `range_officer_inactive`), `staff_search_range_officers(query)` (od 3 znaków, maks. 10,
    zatwierdzeni i aktywni — także ukryci; tylko `id`, `full_name`; `ilike` ze znakami wzorca dosłownie),
    `range_officer_choices(person_id?)` (#117, AC-18: prowadzący „na liście” bez „Ukryj mnie dla innych” oraz osoba wpisywana
    — `profile_id = person_id`, także ukryta — pierwsza z `is_person = true`; `id`, `full_name`, `is_person`). Błąd `forbidden`.
    Grafik (#119): `set_scheduled_range_duty(day, officer_id)` (upsert `day`, `schedule`; `day` od `range_today()` do
    `range_today() + 90`, inaczej `invalid_day`; `range_officer_inactive`), `clear_scheduled_range_duty(day)` (usuwa tylko wpis
    grafiku; `invalid_day`), `range_duty_schedule(days)` (1…91 dni od dziś: dyżurny jak `current_range_duty()` oraz wpis grafiku
    `schedule_range_officer_id`, `schedule_full_name`, `schedule_on_list`).
    `purge_range_duty()` — `pg_cron` `purge-range-duty` (`20 2 * * *` UTC): usuwa dni sprzed `range_today()`.
    Dyżurny zawodów i wydarzeń (#120): `competitions.duty_range_officer_id`, `calendar_events.duty_range_officer_id`
    (FK `range_officers` `on delete set null`; bez `select` dla `anon` / `authenticated`; zapis — admin, istniejące polityki).
    Wyzwalacz `check_calendar_duty` (`insert` / `update` dyżurnego lub dat): prowadzący „na liście” przy zmianie
    (`range_officer_inactive`), nakładanie terminów z innym dyżurnym w obu tabelach (`range_duty_conflict`, `detail` = JSON
    `day`, `name`; `pg_advisory_xact_lock`). `admin_calendar_duty(kind, id)` — admin; `kind` `competition` / `event`;
    `range_officer_id`, `full_name`, `on_list`; błędy `forbidden`, `invalid_kind`.
  - Dyżurny Prowadzący w książce (SPEC-008, ADR-0007, #128): `is_range_duty_officer()` (`security definer`, `execute` dla
    `authenticated`) — wywołujący ma zgłoszenie z konta będące dziś dyżurnym (`range_duty_for(range_today())`);
    `can_keep_range_log()` = `is_staff() or is_range_duty_officer()`. Zastępuje `is_staff()` w funkcjach wpisu
    (`staff_find_by_qr`, `staff_search_people`, `staff_person_by_id`, `staff_person_entry_data`, `staff_complete_profile`,
    `passes_for_range_entry` — teraz `security definer`, `create_range_log_entry`, `current_range_duty`, `range_officer_choices`,
    `staff_search_range_officers`) oraz w politykach `range_log` (dzisiejsze), `range_log_annotations` i `signatures` (`insert`).
    Ustawianie dyżurnego, grafik, sprzedaż, zatwierdzanie i odczyt tabel — bez zmian (`is_staff()` / `is_admin()`).
    Bramka panelu: stan `duty` (rola `user` + `rpc/is_range_duty_officer`) — tylko `/panel/ksiazka/`, bez „Zmień” i sprzedaży.
  - `create_range_log_entry(id, signature_path, range_officer_id, profile_id?, user_pass_id?, is_companion?, full_name?,
    permit_number?, permit_authority?, address?)` — obsługa; w jednej transakcji: plik podpisu istnieje, prowadzący „na liście”,
    dane osoby (kopia z profilu albo podane dla osoby bez konta), uprawnienie `for update` + `pass_valid_on(dziś)`, wpis
    i zużycie (`activated` / `covered` / `decremented` / `consumed`). Uprawnienie bez właściciela — jednym wpisem.
    Ponowienie z tym samym `id` przez tę samą osobę zwraca istniejący wpis. Błędy: `forbidden`, `invalid_signature_path`,
    `signature_missing`, `range_officer_inactive`, `person_not_found`, `person_data_incomplete`, `pass_required`,
    `pass_not_allowed`, `pass_not_valid` (AC-16: „Uprawnienie zostało właśnie wykorzystane”), `entry_exists`.
  - `passes_for_range_entry(user_id)` — `security definer`, `can_keep_range_log()` (SPEC-008), uprawnienia ważne dziś z `priority` 0–4 (AC-10) i nazwą z zamówienia.
    `pass_valid_on(pass, date)` — reguły ważności jednego uprawnienia (używa jej też `passes_valid_on`).
  - `staff_find_by_qr(token)`, `staff_search_people(query)` (od 3 znaków, maks. 10, e-mail częściowo) — obsługa; minimum danych:
    imię i nazwisko, `is_range_ready`, `missing_fields` (`full_name`, `permit_or_address`), godzina dzisiejszego wpisu.
    `staff_person_by_id(id)` — to samo podsumowanie po identyfikatorze (AC-8, powrót ze sprzedaży).
  - `staff_complete_profile(id, full_name?, permit_number?, permit_authority?, address?)` — obsługa (bez `update` na `profiles`)
    uzupełnia tylko brakujące pola (imię i nazwisko; decyzja z organem lub adres, gdy brak obu), nie nadpisuje istniejących;
    `permit_pair` przy niepełnej parze, długości — `check` w `profiles`; wpis `profile_update` w `audit_log` robi wyzwalacz
    `audit_profile_changes` (aktor = obsługa). Zwraca nowe podsumowanie osoby.
  - `staff_person_entry_data(id)` — obsługa; imię i nazwisko, decyzja z organem, adres — dane, które wpis skopiuje (AC-13).
  - `my_range_entries()` — własne wpisy bez podpisu i kolumn technicznych, z nazwą wykorzystanego uprawnienia.
  - `revert_pass_usage(usage_id)` — admin (AC-23); blokada uprawnienia `for update`, `reverted_at`/`reverted_by`; skutek:
    `decremented` — licznik +1 (`used_up` → `active`), `consumed` — `used_up` → `active`, karnet czasowy bez innych niecofniętych
    zużyć — `first_used_on = null` (zdjęcie aktywacji). Anulowane uprawnienie zostaje anulowane. Adnotacja „Cofnięto zużycie
    karnetu” do wpisu (jeśli nie usunięty retencją) i `audit_log` `pass_usage_revert` (`changes`: zużycie, karnet, `used_on`,
    `effect`, wpis). Błędy: `forbidden`, `usage_not_found`, `usage_already_reverted`.
  - `admin_range_log(format, from?, to?, person?, officer_id?)` — admin (AC-26, AC-29); `volatile`, filtry: dzień od–do
    w Europe/Warsaw, fragment `full_name` (`ilike`, znaki wzorca dosłownie), `range_officer_id`. Zwraca kolumny książki
    + `signature_path` i `annotations` (jsonb: `body`, `created_at`, `author`), od najstarszego wpisu, i w tej samej
    transakcji dopisuje `audit_log` `range_log_export` (`changes`: `format` `view`/`pdf`/`csv`, `from`, `to`, liczba wpisów;
    bez filtra nazwiska). Błędy: `forbidden`, `invalid_format`.
- Retencja (ADR-0006, SPEC-005 AC-30, AC-31, SPEC-002 §9): okresy jako funkcje `range_log_retention()` i `audit_log_retention()`
  (`1 year`), `orphan_signature_grace()` (`24 hours`) — zmiana przez PR i migrację. Tylko `service_role`:
  `retention_signatures(limit)` — ścieżki podpisów wpisów starszych niż retencja (`orphan = false`) i plików bez wpisu starszych
  niż 24 h (`orphan = true`); `purge_range_log()` — usuwa wpisy starsze niż retencja, których plik podpisu już nie istnieje
  (najpierw pliki, potem wiersze; jedyne miejsce z `sv.range_log_purge = on`), adnotacje kaskadą, `pass_usages` zostaje
  z `range_log_entry_id = null`. `purge_audit_log()` — `pg_cron` `purge-audit-log` (`15 2 * * *` UTC).
  `invoke_retention()` — `pg_cron` `range-log-retention` (`30 2 * * *` UTC), `pg_net` → `POST /functions/v1/retention`
  z `Authorization: Bearer <sekret>`; URL projektu i sekret z Vault (`project_url`, `retention_invoke_secret`), bez nich — `notice`.
- `calendar_events` (SPEC-003 §5, US-4): `access_mode` (`external` domyślnie / `free` / `paid`), `ticket_price` (grosze,
  wymagana dla `paid`), `capacity` (1–1000, `null` = bez limitu) — odczyt publiczny. `check` publikacji
  `calendar_events_published_needs_url`: link wymagany tylko dla `external` (AC-16). `event_seats_left(event_id)` — `anon`,
  `security definer`: `capacity` − (`paid` + `pending` młodsze niż `ticket_reservation()`), min. 0; `null` — bez limitu,
  szkic lub wydarzenie niepłatne (AC-17, AC-18). Wyzwalacz `calendar_events_tickets_guard` (AC-20): gdy są zamówienia `paid`,
  zmiana `access_mode` / `ticket_price` i `delete` → `P0001 event_has_tickets`, `capacity` poniżej liczby sprzedanych →
  `P0001 capacity_below_sold`.
  Frontend: formularz wydarzenia (tryb, cena, limit), karta w kalendarzu „Wejściówka: 50,00 zł” + „Kup wejściówkę”
  (`/oferta/zamowienie/?event=`); wolne miejsca, „Wyprzedane” i „Sprzedaż zakończona.” liczone w przeglądarce
  (`lib/event-tickets-ui.ts`), bo kalendarz jest statyczny.
- Custom Access Token Hook `public.custom_access_token_hook` (claim `app_role` = `user` / `staff` / `admin`, tylko UI) — lokalnie włączony w `config.toml`,
  w projektach Supabase włączany ręcznie w panelu (Authentication → Hooks).

## Edge Functions (`supabase/functions/`)

- Logika w `handler.ts` (zależności — `fetch`, konfiguracja — wstrzykiwane), `index.ts` tylko czyta `Deno.env` i uruchamia `Deno.serve`.
  Testy Deno obok (`*_test.ts`, `deno test supabase/functions/`), z zamockowanym `fetch`.
- `site-rebuild` (ADR-0003): rola sprawdzana przez `rpc/is_organizer` (alias `is_admin()`) z JWT wywołującego (to samo źródło co RLS), potem
  `workflow_dispatch` workflowu `rebuild-site.yml` (`ref: main`, `inputs.target` = `SITE_ENV`). Odpowiedzi: 202 — uruchomiono,
  403 — nie organizator, 500 — brak `GITHUB_DISPATCH_TOKEN` / `SITE_ENV`, 502 — błąd GitHub API. Token nie trafia do logów ani odpowiedzi.
- `admin-delete-user` (SPEC-002 AC-24, AC-25): POST `{ user_id }`. `rpc/is_admin` z JWT wywołującego, potem
  `rpc/admin_log_account_delete` z tym samym JWT (wpis `account_delete` z autorem; odmowa dla własnego konta — `own_account`,
  i nieistniejącego — `not_found`), na końcu `DELETE /auth/v1/admin/users/:id` kluczem secret (`SUPABASE_SECRET_KEY`
  albo `default` z `SUPABASE_SECRET_KEYS`). Gdy usunięcie się nie uda, wpis jest wycofywany. Skutki w bazie przez klucze obce:
  `profiles` i `user_passes` — kaskada, `orders.user_id`, `created_by`, `audit_log.actor_id` — `null`; `audit_log.target_user_id`
  bez FK, więc wpis zostaje. Odpowiedzi: 204, 403, 404, 409 (własne konto), 500.
- `payments-create` (SPEC-003 AC-8, AC-18): POST `{ product_id | event_id, request_key, invoice? }` z JWT osoby. Konto z `/auth/v1/user`,
  imię i nazwisko z `profiles` (brak → e-mail), `rpc/create_tpay_order` kluczem secret; z `invoice` (SPEC-004 AC-5:
  `nip`, `company_name`, `company_address`, `data_source`, `fetched_at`) — `rpc/set_order_invoice_details` z
  `save_billing_details = true` (odrzucone przez bazę → zamówienie usuwane, 400 `invalid_invoice`), potem Tpay: `POST /oauth/auth`
  (client credentials) i `POST /transactions` (kwota, opis `<order_number> — <item_name>` skrócony do 128 znaków
  limitu Tpay — skraca się nazwa z `…`, SPEC-006 AC-14, `hiddenDescription` = id zamówienia,
  powiadomienie na `TPAY_NOTIFICATION_URL`, powrót na `SITE_URL/konto/platnosc/?order=`), na końcu `rpc/attach_tpay_transaction`.
  Odpowiedzi: 200 `{ order_id, payment_url }`, 400, 401, 409 (`sold_out`, `product_unavailable`, `event_unavailable`,
  `sales_closed`, `duplicate_request`), 500, 502 (Tpay niedostępny — zamówienie usuwane). Sekrety: `TPAY_API_URL`,
  `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`, `TPAY_NOTIFICATION_URL`, `SITE_URL`.
- `payments-notify` (SPEC-003 AC-9, `verify_jwt = false` w `config.toml`): podpis JWS z `X-JWS-Signature` (RS256, payload odłączony),
  `x5u` musi być certyfikatem Tpay dla środowiska z `TPAY_API_URL` (sandbox: `secure.sandbox.tpay.com`, produkcja: `secure.tpay.com`);
  klucz publiczny z certyfikatu (`jws.ts`, bez bibliotek), pamiętany w instancji. Pola `tr_id`, `tr_crc` (= id zamówienia),
  `tr_amount`, `tr_paid` (→ grosze), `tr_status` (`TRUE`/`PAID` = wpłata, `CHARGEBACK` = zwrot), potem
  `rpc/process_tpay_notification` (zwrot: `refund_pending` lub `paid` → `refunded`, uprawnienie `cancelled`; dla `paid` —
  zwrot spoza panelu — wpis `order_refund` bez autora). Odpowiedzi: `TRUE` (przyjęte, powtórzone, inny stan), 400 `FALSE`
  (odrzucone), 401 (podpis), 500 (Tpay ponowi). E-mail płatnika z powiadomienia nie jest zapisywany ani logowany.
- `payments-refund` (SPEC-003 AC-25, AC-27): POST `{ order_id, refund_note? }` z JWT admina. `rpc/cancel_order` z JWT
  wywołującego (rola, stan i brak zużycia sprawdza baza), dla `refund_pending` — Tpay `POST /transactions/{id}/refunds`
  bez kwoty (zwrot pełnej kwoty); `refunded` ustawia `payments-notify`. Tpay odrzucił / brak odpowiedzi →
  `rpc/revert_order_refund` i 502 `refund_failed`. Odpowiedzi: 200 `{ status }`, 400, 401, 403, 404, 409 (`pass_used`,
  `order_not_paid`), 500, 502. Sekrety: `TPAY_API_URL`, `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`.
- `retention` (SPEC-005 AC-30, AC-31, ADR-0006, `verify_jwt = false`): POST z `Authorization: Bearer RETENTION_INVOKE_SECRET`
  (porównanie w stałym czasie, inaczej 401). Kluczem secret: `rpc/retention_signatures` partiami po 1000 (maks. 20),
  `DELETE /storage/v1/object/signatures` po 100 plików, na końcu `rpc/purge_range_log`. Nieudane usunięcie pliku zostawia
  wpis do następnego uruchomienia. W logu i odpowiedzi tylko liczby (`signatures_deleted`, `orphans_deleted`,
  `signatures_failed`, `entries_deleted`). Odpowiedzi: 200, 401, 405, 500.
- `company-lookup` (SPEC-004 AC-2…AC-4, §7, §8): POST `{ nip }` z JWT osoby. NIP normalizowany jak `normalize_nip`
  (spacje, myślniki, prefiks `PL`) i sprawdzany sumą kontrolną przed jakimkolwiek zapytaniem (400 `invalid_nip`;
  prefiks innego kraju — 400 `foreign_nip`). Potem `rpc/company_lookup_take_quota` z JWT wywołującego (limit 20 zapytań
  na konto na godzinę, tabela `company_lookup_requests` bez NIP-u, wiersze starsze niż godzina usuwane przy każdym
  wywołaniu; 429 `rate_limited`). Rejestry, każde zapytanie z limitem 5 s: Biała lista MF
  (`GET wl-api.mf.gov.pl/api/search/nip/{nip}?date=` — data w Europe/Warsaw; pierwszy podmiot „Czynny”, inaczej pierwszy;
  `workingAddress`, inaczej `residenceAddress`), a gdy brak podmiotu lub błąd — GUS REGON BIR1.1 (SOAP: `Zaloguj` kluczem
  `GUS_BIR_KEY`, `DaneSzukajPodmioty` po NIP z nagłówkiem `sid`, `Wyloguj`; podmiot bez daty zakończenia działalności),
  tylko gdy ustawiono `GUS_BIR_KEY` (opcjonalnie `GUS_BIR_URL` — np. środowisko testowe BIR). Odpowiedź 200
  `{ found, name, address, source }` (`vat_whitelist` / `regon`; brak lub brak odpowiedzi → `found: false`, wpis ręczny).
  Nic nie zapisuje w bazie; do rejestrów trafia tylko NIP; w logach tylko nazwa rejestru i status (bez NIP-u i klucza).
  Odpowiedzi: 200, 400, 401, 405, 429, 500.
- Workflow `rebuild-site.yml`: staging z `main` (repo `sv-competitions-staging`), produkcja z najnowszego Release (Pages);
  osobne `concurrency` z `cancel-in-progress` dla każdego środowiska; nocny harmonogram przebudowuje oba.

## Model danych

Szczegóły kolumn i polityk RLS — w specyfikacjach (SPEC-001 kalendarz; SPEC-002…005 klienci strzelnicy).

```
auth.users 1──1 profiles (role: user | staff | admin; dane do książki; qr_token)   — SPEC-002
profiles 1──0..1 billing_details                                                  — SPEC-004
profiles 1──* orders *──0..1 products | calendar_events (wejściówka)              — SPEC-003
orders 1──1 user_passes 1──* pass_usages 0..1──1 range_log                        — SPEC-003 / SPEC-005
range_officers 1──* range_log 1──* range_log_annotations                          — SPEC-005
profiles 1──0..1 range_officers (zgłoszenie z konta: status, hide_from_others)     — SPEC-007
range_officers 1──* range_duty (dyżurny: książka / grafik, wiersz na dzień i źródło) — SPEC-007
range_officers 1──* competitions, calendar_events (duty_range_officer_id)          — SPEC-007
audit_log (kto, kogo, co) — bez FK do usuwanych kont                              — SPEC-002
Storage bucket signatures (prywatny): signatures/<RRRR>/<MM>/<range_log.id>.png
disciplines 1──* competitions *──0..1 rulebooks
competitions 1──* schedule_items
event_categories 1──* calendar_events
Storage bucket documents: rulebooks/<uuid>.pdf, matchbooks/<competition_id>/<uuid>.pdf
```

| Tabela | Zawiera | Dane osobowe | Odczyt publiczny |
| --- | --- | --- | --- |
| `profiles` | rola, dane do książki, `qr_token` | tak | nie (własny wiersz; obsługa i admin — wszystkie) |
| `audit_log` | dziennik zmian (`profile_update`, `role_change`, `account_delete`, `order_refund`, `pass_usage_revert`, `range_log_export`, `invoice_issued`, `invoice_unmarked`, `range_officer_review` — SPEC-007) | tak | nie (admin) |
| `products` | produkty Oferty | nie | tylko aktywne |
| `orders` | zamówienia (+ kopia danych faktury) | tak | nie (własne; obsługa, admin) |
| `payment_notifications` | idempotencja powiadomień Tpay | nie | nie |
| `user_passes`, `pass_usages` | uprawnienia i ich zużycie | tak (powiązanie z kontem) | nie (własne; obsługa, admin) |
| `billing_details` | dane do faktury | tak | nie (własne; obsługa, admin) |
| `company_lookup_requests` | limit zapytań `company-lookup` (konto, czas; bez NIP-u; ostatnia godzina) | powiązanie z kontem | nie (tylko funkcja `company_lookup_take_quota`) |
| `range_officers` | prowadzący strzelanie (admina i zgłoszenia z kont — SPEC-007) | tak | nie (obsługa, admin; użytkownik — własne zgłoszenie przez funkcje) |
| `range_duty` | dyżurny Prowadzący na dzień: zmiana w książce (dziś) i grafik dyżurów (do 90 dni) | `set_by` | nie (obsługa, admin) |
| `range_log`, `range_log_annotations` | książka rejestru pobytu (tylko `insert`, retencja 1 rok) | tak | nie (admin; obsługa — dzisiejsze; osoba — własne przez funkcję) |
| `disciplines` | lista dyscyplin | nie | tak |
| `event_categories` | kategorie wydarzeń | nie | tak |
| `rulebooks` | biblioteka regulaminów PDF | `created_by` | tylko używane w opublikowanych zawodach, bez `created_by` |
| `competitions` | zawody (`draft` / `published`) | `created_by` | tylko opublikowane, bez `created_by` |
| `schedule_items` | punkty harmonogramu | nie | tylko opublikowanych zawodów |
| `calendar_events` | wydarzenia w kalendarzu (`draft` / `published`; tryb `external` / `free` / `paid` — SPEC-003) | `created_by` | tylko opublikowane, bez `created_by` |
