# Architektura

```
 przeglądarka ──► competitions.steel-valley.pl (GitHub Pages, Astro, statyczny)
       │
       ├──► Supabase Auth            (logowanie organizatora: Google; zawodnicy — w specyfikacji rejestracji)
       ├──► Supabase PostgreSQL      (dane, dostęp przez RLS, klucz publishable)
       ├──► Supabase Storage         (regulaminy PDF, załączniki)
       └──► Supabase Edge Functions  (logika z kluczem secret)
                 ├── site-rebuild     ──► GitHub Actions (rebuild-site.yml, ADR-0003)
                 ├── payments-create  ──► Tpay Open API (utworzenie transakcji)
                 ├── payments-notify  ◄── Tpay (powiadomienie JWS) → status płatności
                 └── emails           ──► dostawca e-mail
```

## Środowiska

| Środowisko | Frontend | Supabase | Tpay |
| --- | --- | --- | --- |
| Lokalnie | `npm run dev` | `supabase start` | sandbox |
| Staging | competitions-staging.steel-valley.pl (repo `sv-competitions-staging`) | `sv-competitions-staging` (ref `xvqlralvzgmaztugghry`, Frankfurt) | sandbox |
| Produkcja | competitions.steel-valley.pl (Pages tego repo) | `sv-competitions` (ref `kicftecnawfkfpjbtejg`, Frankfurt) | produkcja |

## Zasady

- Frontend nie zna żadnych sekretów; ma tylko URL Supabase i klucz publiczny (publishable, `sb_publishable_…`)
  ze zmiennej `PUBLIC_SUPABASE_ANON_KEY`. Nie używaj starych kluczy `anon`/`service_role` (JWT) — Supabase wycofuje je na początku 2027.
  Po stronie serwera (Edge Functions) używaj klucza secret (`sb_secret_…`), nigdy we frontendzie.
- W obu projektach Supabase włączone jest automatyczne RLS dla nowych tabel w schemacie `public`.
  Migracja i tak musi jawnie zawierać `enable row level security` i polityki — nie polegaj na wyzwalaczu.
- Każda tabela z danymi osobowymi: RLS włączone, polityki per rola (`competitor`, `organizer`, `admin`).
- Role trzymane w tabeli `profiles`. RLS sprawdza rolę funkcją `public.is_organizer()` (odczyt z `profiles`),
  claim `app_role` w JWT (Custom Access Token Hook) służy tylko interfejsowi (SPEC-001).
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
- `src/lib/panel.ts` — bramka panelu: `requireOrganizer()` pokazuje logowanie Google / brak uprawnień / treść
  i zwraca klienta tylko organizatorowi (rola z `profiles`, jak w RLS). Skrypty stron panelu pobierają dane dopiero po niej.
- `src/lib/calendar.ts` — typ `CalendarEntry` (zawody + wydarzenia), kolejność wpisów, „dziś” w Europe/Warsaw
  i grupowanie nadchodzących po miesiącach (`upcomingByMonth`).
- Strony publiczne (`/`, `/zawody/<slug>/`) pobierają dane **przy budowaniu** w `src/lib/public-data.ts` (klucz publishable,
  tylko opublikowane, jedno pobranie na build). Błąd Supabase = błąd buildu. Brak zmiennych Supabase jest dozwolony tylko
  bez `PUBLIC_APP_ENV` (lint/test/build w CI) — wtedy strony są puste; wdrożenia (staging, produkcja) ustawiają `PUBLIC_APP_ENV`
  i bez zmiennych build się nie uda.
- `src/lib/competition-page.ts` — widok strony zawodów i wiersze → `CalendarEntry`; `src/components/CalendarCard.astro` (karta wpisu),
  `CompetitionDetails.astro` (strona zawodów; bez `view` — pusty wzór wypełniany w podglądzie panelu przez
  `src/lib/competition-view-ui.ts`, `/panel/zawody/podglad/?id=`). Opisy: `src/lib/text.ts` (akapity, `meta description`).
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
  `schedule_item_day_out_of_range` (AC-22), `rulebook_file_immutable` (AC-16).
- Custom Access Token Hook `public.custom_access_token_hook` — lokalnie włączony w `config.toml`,
  w projektach Supabase włączany ręcznie w panelu (Authentication → Hooks).

## Edge Functions (`supabase/functions/`)

- Logika w `handler.ts` (zależności — `fetch`, konfiguracja — wstrzykiwane), `index.ts` tylko czyta `Deno.env` i uruchamia `Deno.serve`.
  Testy Deno obok (`*_test.ts`, `deno test supabase/functions/`), z zamockowanym `fetch`.
- `site-rebuild` (ADR-0003): rola sprawdzana przez `rpc/is_organizer` z JWT wywołującego (to samo źródło co RLS), potem
  `workflow_dispatch` workflowu `rebuild-site.yml` (`ref: main`, `inputs.target` = `SITE_ENV`). Odpowiedzi: 202 — uruchomiono,
  403 — nie organizator, 500 — brak `GITHUB_DISPATCH_TOKEN` / `SITE_ENV`, 502 — błąd GitHub API. Token nie trafia do logów ani odpowiedzi.
- Workflow `rebuild-site.yml`: staging z `main` (repo `sv-competitions-staging`), produkcja z najnowszego Release (Pages);
  osobne `concurrency` z `cancel-in-progress` dla każdego środowiska; nocny harmonogram przebudowuje oba.

## Model danych

Szczegóły kolumn i polityk RLS — w specyfikacjach (źródło: SPEC-001).

```
auth.users 1──1 profiles (role: competitor | organizer)
disciplines 1──* competitions *──0..1 rulebooks
competitions 1──* schedule_items
event_categories 1──* calendar_events
Storage bucket documents: rulebooks/<uuid>.pdf, matchbooks/<competition_id>/<uuid>.pdf
```

| Tabela | Zawiera | Dane osobowe | Odczyt publiczny |
| --- | --- | --- | --- |
| `profiles` | rola konta | tak (powiązanie z kontem) | nie (tylko własny wiersz) |
| `disciplines` | lista dyscyplin | nie | tak |
| `event_categories` | kategorie wydarzeń | nie | tak |
| `rulebooks` | biblioteka regulaminów PDF | `created_by` | tylko używane w opublikowanych zawodach, bez `created_by` |
| `competitions` | zawody (`draft` / `published`) | `created_by` | tylko opublikowane, bez `created_by` |
| `schedule_items` | punkty harmonogramu | nie | tylko opublikowanych zawodów |
| `calendar_events` | wydarzenia w kalendarzu (`draft` / `published`) | `created_by` | tylko opublikowane, bez `created_by` |
