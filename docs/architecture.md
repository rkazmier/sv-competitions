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
  `auth.uid() <> id`), `set_user_role()` (`role_change`). Odczyt — tylko admin.
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
  tylko adminowi; skrypty stron kalendarza i słowników pobierają dane dopiero po niej. Menu obsługi i admina — `PanelLayout.astro`.
- Konta (SPEC-002 AC-1…AC-6): `/rejestracja/`, `/logowanie/` (z „Nie pamiętam hasła”), `/logowanie/nowe-haslo/`, `/konto/`.
  Logika bez DOM w `src/lib/auth.ts` (`?next=` tylko ścieżki aplikacji, walidacja, mapowanie błędów Auth), wyspy w `src/lib/auth-ui.ts`.
  Google i link potwierdzający wracają na `/konto/` — tam pierwsze logowanie bez `privacy_notice_ack_at` pokazuje klauzulę
  (`PrivacyNotice.astro`) z „Rozumiem”, potem przejście do `?next=`. Rejestracja e-mailem przekazuje `privacy_notice_ack: true`
  w metadanych konta, a wyzwalacz `handle_new_user` zapisuje czas potwierdzenia. Linki w e-mailach Auth niosą `token_hash`
  (szablony `supabase/templates/`, `verifyOtp`), więc działają też na innym urządzeniu. Nagłówek stron publicznych
  (`HeaderAuthLinks.astro`): „Zaloguj się” / „Moje konto” / „Panel” z sesji w localStorage i claimu `app_role` — bez zapytań.
- Panel użytkownika (SPEC-002 AC-7…AC-11): `/konto/` — blok braków albo „Gotowy do wpisu do książki” (z kolumny
  `is_range_ready`), „Twoje dane”; `/konto/dane/` — formularz danych (zapis tylko kolumn z uprawnieniami
  kolumnowymi, własny wiersz). Walidacja i lista braków bez DOM w `src/lib/profile.ts` (te same limity co `check` w bazie),
  wyspy w `src/lib/account-ui.ts`. Pola formularza — `src/components/ProfileFields.astro` (wspólne z kartą użytkownika w panelu).
- Panel admina — konta (SPEC-002 AC-16…AC-18, AC-20, AC-21, tylko admin): `/panel/uzytkownicy/` — lista z wyszukiwarką
  (`rpc/admin_list_users`; fraza nie trafia do adresu strony), `/panel/uzytkownicy/profil/?id=` — e-mail (`rpc/admin_user_email`),
  dane (zapis do `profiles` jak w `/konto/dane/`, wpis w `audit_log` robi wyzwalacz), rola (`rpc/set_user_role`, potwierdzenie,
  błąd `last_admin`), „Historia zmian” (`audit_log` z autorem przez `actor_id`, od najnowszych, 100 ostatnich).
  Logika bez DOM w `src/lib/admin-users.ts`, wyspy w `src/lib/admin-users-ui.ts`.
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
- `src/lib/site.ts` — adres produkcyjny: `link rel=canonical`, `og:url` i `og:image` (`public/og-default.png`) zawsze na produkcję.
- Komponenty `.astro`: test przez Container API (`astro/container`, `vitest.config.ts` z `getViteConfig`).
- `src/components/DictionaryList.astro` + `src/lib/dictionary*.ts` — wspólna lista słownikowa (dyscypliny, kategorie).
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
- `created_by` w `rulebooks`, `competitions`, `calendar_events` nie ma uprawnienia `select` dla `anon` ani `authenticated`
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
  - `create_on_site_order(user_id | null, product_id, 'cash'|'terminal')` — obsługa; bez konta tylko wejście jednorazowe na dziś.
  - `cancel_order(order_id, note)` — admin, tylko `paid` bez zużycia (`pass_has_usage`, do SPEC-005 z samego stanu uprawnienia);
    Tpay → `refund_pending`, na miejscu → `refunded`; wpis `order_refund` w `audit_log`.
  - `passes_valid_on(user_id, date)` — invoker (RLS), reguły ważności z §5; wyzwalacz `user_passes_before_write` liczy
    `valid_until` karnetu czasowego z `first_used_on` i ustawia `used_up` przy `entries_left = 0`.
  - `cancel_unpaid_orders()` — `pg_cron` `cancel-unpaid-orders` (`5 * * * *` UTC): `pending` starsze niż 24 h → `cancelled` (AC-11).
  Błędy (`raise`, do mapowania w UI): `forbidden`, `guest_product_not_allowed`, `invalid_on_site_method`, `order_not_paid`, `pass_used`.
- Custom Access Token Hook `public.custom_access_token_hook` (claim `app_role` = `user` / `staff` / `admin`, tylko UI) — lokalnie włączony w `config.toml`,
  w projektach Supabase włączany ręcznie w panelu (Authentication → Hooks).

## Edge Functions (`supabase/functions/`)

- Logika w `handler.ts` (zależności — `fetch`, konfiguracja — wstrzykiwane), `index.ts` tylko czyta `Deno.env` i uruchamia `Deno.serve`.
  Testy Deno obok (`*_test.ts`, `deno test supabase/functions/`), z zamockowanym `fetch`.
- `site-rebuild` (ADR-0003): rola sprawdzana przez `rpc/is_organizer` (alias `is_admin()`) z JWT wywołującego (to samo źródło co RLS), potem
  `workflow_dispatch` workflowu `rebuild-site.yml` (`ref: main`, `inputs.target` = `SITE_ENV`). Odpowiedzi: 202 — uruchomiono,
  403 — nie organizator, 500 — brak `GITHUB_DISPATCH_TOKEN` / `SITE_ENV`, 502 — błąd GitHub API. Token nie trafia do logów ani odpowiedzi.
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
| `audit_log` | dziennik zmian (`profile_update`, `role_change`, `account_delete`, `order_refund`) | tak | nie (admin) |
| `products` | produkty Oferty | nie | tylko aktywne |
| `orders` | zamówienia (+ kopia danych faktury) | tak | nie (własne; obsługa, admin) |
| `payment_notifications` | idempotencja powiadomień Tpay | nie | nie |
| `user_passes`, `pass_usages` | uprawnienia i ich zużycie | tak (powiązanie z kontem) | nie (własne; obsługa, admin) |
| `billing_details` | dane do faktury | tak | nie (własne; obsługa, admin) |
| `range_officers` | prowadzący strzelanie | tak | nie (obsługa, admin) |
| `range_log`, `range_log_annotations` | książka rejestru pobytu (tylko `insert`, retencja 1 rok) | tak | nie (admin; obsługa — dzisiejsze; osoba — własne przez funkcję) |
| `disciplines` | lista dyscyplin | nie | tak |
| `event_categories` | kategorie wydarzeń | nie | tak |
| `rulebooks` | biblioteka regulaminów PDF | `created_by` | tylko używane w opublikowanych zawodach, bez `created_by` |
| `competitions` | zawody (`draft` / `published`) | `created_by` | tylko opublikowane, bez `created_by` |
| `schedule_items` | punkty harmonogramu | nie | tylko opublikowanych zawodów |
| `calendar_events` | wydarzenia w kalendarzu (`draft` / `published`; tryb `external` / `free` / `paid` — SPEC-003) | `created_by` | tylko opublikowane, bez `created_by` |
