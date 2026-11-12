# ADR-0002: Płatności przez Tpay

- Data: 2026-11-12
- Status: przyjęta

## Decyzja
Operator płatności: Tpay (Open API) — BLIK, szybkie przelewy, karty.

## Zasady integracji
- Transakcję tworzy Edge Function `payments-create` (OAuth client credentials, sekrety w Supabase).
- Zawodnik płaci na bramce Tpay (przekierowanie); żadne dane płatnicze nie przechodzą przez nasz serwer.
- Status płatności ustawia wyłącznie Edge Function `payments-notify` po:
  1. weryfikacji podpisu JWS powiadomienia (certyfikat z domeny Tpay),
  2. porównaniu kwoty i waluty z bazą,
  3. sprawdzeniu idempotencji (to samo powiadomienie nie zmienia stanu dwa razy).
- Środowiska: sandbox (`https://openapi.sandbox.tpay.com`) dla lokalnie i staging, produkcja (`https://api.tpay.com`).
- Zwrot pieniędzy inicjuje organizator z panelu; zwroty przelewów są asynchroniczne.

## Do ustalenia
- Faktury / paragony za wpisowe.
