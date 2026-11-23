# ADR-0009: E-maile aplikacji przez SMTP skrzynki sprzedawcy, z kolejką w bazie

- Data: 2026-11-23
- Status: przyjęta (SPEC-012)

## Kontekst
Regulamin sprzedaży i art. 21 ustawy o prawach konsumenta wymagają potwierdzenia zamówienia na trwałym nośniku
(e-mail z regulaminem w PDF). Dotąd e-maile wysyłał tylko Supabase Auth, a potwierdzenie płatności — Tpay (SPEC-003 11-A).
Edge Functions blokują wychodzące połączenia na portach 25 i 587. Właściciel wybrał skrzynkę w domenie steel-valley.pl
zamiast zewnętrznej usługi (#152, 2-A) — bez nowego odbiorcy danych w klauzuli RODO.

## Decyzja
- Wysyłka: Edge Function `mail-send`, SMTP z TLS na porcie 465. Konfiguracja wyłącznie w sekretach Supabase:
  `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_INVOKE_SECRET`, `SITE_URL`.
- Kolejka: tabela `email_outbox` (rodzaj, zamówienie, stan, liczba prób, kod błędu) — wpis powstaje w tej samej transakcji
  co zdarzenie biznesowe (np. `fulfil_order`), więc e-mail nie zginie przy błędzie SMTP i nie zdubluje się przy powtórzonym
  powiadomieniu Tpay (unikalne `(kind, order_id)`).
- Wywołanie: zaraz po zdarzeniu (Edge Function albo `pg_net`) oraz `pg_cron` co 10 min (ponowienia, maks. 5 prób) —
  jak `retention` w ADR-0006 (sekret w Vault, porównanie w stałym czasie).
- Kolejka nie przechowuje adresu ani treści: adres z `auth.users` i treść z szablonu i18n w chwili wysyłki.
- Załączniki (PDF regulaminu) pobierane z `SITE_URL` (pliki w `web/public/`); bez załącznika e-mail nie wychodzi.

## Konsekwencje
- Brak konfiguracji SMTP (lokalnie, CI, staging bez sekretów) → `503 mail_not_configured`, wpisy czekają; testy Deno
  używają podstawionego klienta SMTP.
- Limit wysyłki zależy od hostingu skrzynki; przy odwołaniu dużego wydarzenia e-maile rozkładają się na kolejne uruchomienia.
- Zmiana dostawcy (np. usługa API) wymaga tylko zmiany `mail-send` i nowego ADR (oraz klauzuli RODO).
