# Architektura

```
 przeglądarka ──► competitions.steel-valley.pl (GitHub Pages, Astro, statyczny)
       │
       ├──► Supabase Auth            (logowanie: magic link e-mail)
       ├──► Supabase PostgreSQL      (dane, dostęp przez RLS, klucz anon)
       ├──► Supabase Storage         (regulaminy PDF, załączniki)
       └──► Supabase Edge Functions  (logika z kluczem service_role)
                 ├── payments-create  ──► Tpay Open API (utworzenie transakcji)
                 ├── payments-notify  ◄── Tpay (powiadomienie JWS) → status płatności
                 └── emails           ──► dostawca e-mail
```

## Środowiska

| Środowisko | Frontend | Supabase | Tpay |
| --- | --- | --- | --- |
| Lokalnie | `npm run dev` | `supabase start` | sandbox |
| Staging | competitions-staging.steel-valley.pl (repo `sv-competitions-staging`) | projekt „staging” | sandbox |
| Produkcja | competitions.steel-valley.pl (Pages tego repo) | projekt „production” | produkcja |

## Zasady

- Frontend nie zna żadnych sekretów; ma tylko URL Supabase i klucz `anon`.
- Każda tabela z danymi osobowymi: RLS włączone, polityki per rola (`competitor`, `organizer`, `admin`).
- Role trzymane w tabeli `profiles` + claim w JWT (szczegóły w pierwszej specyfikacji).
- Kwoty w groszach (`integer`), czas w UTC (`timestamptz`), prezentacja w strefie Europe/Warsaw.
- Status płatności zmienia wyłącznie `payments-notify` po weryfikacji podpisu JWS, sprawdzeniu kwoty i idempotencji.

## Model danych

Uzupełnia Analityk w kolejnych specyfikacjach.
