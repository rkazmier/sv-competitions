# SV Competitions — zasady dla agentów

Aplikacja do obsługi zawodów strzeleckich na strzelnicy Steel Valley:
kalendarz zawodów, strona zawodów z regulaminem, rejestracja, płatności (Tpay),
wyniki i ranking zbiorczy. Adres produkcyjny: https://competitions.steel-valley.pl

Właściciel produktu: @rkazmier. Odpowiada na pytania i merguje PR-y. Często z telefonu.

## Stos technologiczny

- Frontend: Astro (statyczny build) + TypeScript, interaktywne wyspy tylko tam, gdzie trzeba. Katalog `web/`.
- Hosting frontendu: GitHub Pages (produkcja), osobne repo `sv-competitions-staging` (staging).
- Backend: Supabase — PostgreSQL, Auth, Row Level Security, Edge Functions (Deno/TS), Storage. Katalog `supabase/`.
- Płatności: Tpay Open API. Środowisko testowe: sandbox (`openapi.sandbox.tpay.com`).
  Status płatności ustawia WYŁĄCZNIE Edge Function po weryfikacji podpisu JWS powiadomienia Tpay.
- Testy: Vitest (jednostkowe), Playwright (E2E, `tests/e2e/`).
- Język interfejsu: polski; teksty w plikach i18n, gotowe pod angielski.

## Źródła prawdy

1. `docs/specs/` — specyfikacje funkcji. Kod MUSI być z nimi zgodny.
2. `docs/glossary.md` — nazwy pojęć. Używaj ich w kodzie (po angielsku) i w UI (po polsku) zgodnie ze słownikiem.
3. `docs/adr/` — decyzje techniczne. Nowa decyzja = nowy ADR.
4. `docs/architecture.md` — architektura i model danych.

## Role agentów

Szczegóły w `.claude/agents/`:
- `analyst.md` — Analityk: wymagania i specyfikacje, nie pisze kodu aplikacji.
- `implementer.md` — Implementator: kod, migracje, testy zgodnie ze specyfikacją.
- `reviewer.md` — Recenzent: recenzja PR-ów, nie pisze funkcji.

## Twarde zasady (wszyscy agenci)

- NIGDY nie merguj PR-ów i nie pushuj do `main`. Merge robi wyłącznie właściciel.
- NIGDY nie zgaduj w sprawach biznesowych (ceny, zasady, dane zawodników, teksty prawne).
  Zadaj pytanie (patrz niżej) i zakończ pracę.
- NIGDY nie umieszczaj sekretów w kodzie ani w logach. Klucze tylko z GitHub Secrets / zmiennych Supabase.
- Dane osobowe: zbieraj minimum. Bez PESEL. Każda tabela z danymi osobowymi ma RLS.
- Jeden issue = jeden PR, maksymalnie ok. 400 zmienionych linii (bez plików generowanych).
  Większe zadanie → zaproponuj podział w komentarzu.
- Gałęzie: `agent/issue-<numer>-<krótki-opis>`. Gdy wznawiasz pracę, sprawdź najpierw, czy gałąź i PR już istnieją, i kontynuuj na nich.
- Commity: Conventional Commits po angielsku (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Opis PR: co i dlaczego, jak sprawdzić (kroki dla człowieka z telefonu), `Closes #<numer>`, lista zmian w bazie.

## Jak zadawać pytania właścicielowi

Pytanie = komentarz w issue lub PR + etykieta `question`:

```
@rkazmier ❓ Pytanie: <jedno zdanie>
A) <opcja> — <skutek>
B) <opcja> — <skutek>
Rekomenduję: A, bo <powód>.
Odpowiedz komentarzem zaczynającym się od @claude, np. "@claude A".
```

Pytania zamknięte, z rekomendacją. Kilka pytań — jeden komentarz, ponumerowane.
Po zadaniu pytania zakończ pracę; odpowiedź wznowi agenta.
Gdy dostaniesz odpowiedź, usuń etykietę `question`.

## Komendy

Zanim otworzysz PR, uruchom lokalnie wszystko, co istnieje:
- `cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build`
- `supabase db reset` (lokalnie, jeśli zmieniasz migracje)
- `npx playwright test` (jeśli dotyczy UI)
