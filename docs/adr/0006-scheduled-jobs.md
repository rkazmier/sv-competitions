# ADR-0006: Zadania cykliczne w bazie — pg_cron

- Data: 2026-11-17
- Status: przyjęta (SPEC-002, SPEC-003, SPEC-005)

## Kontekst
Potrzebne są zadania wykonywane automatycznie: anulowanie nieopłaconych zamówień (co godzinę), usuwanie wpisów książki
rejestru pobytu i dziennika zmian starszych niż okres przechowywania wraz z plikami podpisów (codziennie), sprzątanie osieroconych podpisów.

## Decyzja
- Harmonogram: rozszerzenie `pg_cron` w Supabase (włączane migracją), czas w UTC.
- Operacje tylko na bazie (np. anulowanie zamówień) — funkcje SQL wywoływane bezpośrednio przez `pg_cron`.
- Operacje na Storage (usuwanie plików podpisów) — Edge Function `retention` wywoływana przez `pg_cron` + `pg_net`.
  Wywołanie uwierzytelnione sekretem `RETENTION_INVOKE_SECRET` (Vault Supabase po stronie bazy, zmienna funkcji po stronie Edge Function).
  Funkcja najpierw usuwa pliki przez Storage API (klucz secret), potem wiersze — nigdy odwrotnie (brak „sierot” z danymi osobowymi).
- Okresy przechowywania jako funkcje SQL zwracające `interval` (`range_log_retention()`, `audit_log_retention()`) — zmiana przez PR i migrację.

## Konsekwencje
- Lokalnie i w CI `pg_cron` działa w `supabase start`; testy wywołują funkcje SQL bezpośrednio.
- Zadania są idempotentne; nieudane uruchomienie nadrabia następne.
