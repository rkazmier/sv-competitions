# ADR-0001: Frontend na GitHub Pages, backend w Supabase

- Data: 2026-11-12
- Status: przyjęta

## Kontekst
Cały kod ma być na GitHubie, z hostingiem GitHuba. GitHub Pages serwuje wyłącznie pliki statyczne,
a aplikacja potrzebuje bazy danych, logowania i obsługi powiadomień o płatnościach.

## Decyzja
- Frontend: statyczny build Astro na GitHub Pages (produkcja w tym repo, staging w repo `sv-competitions-staging`).
- Backend: Supabase (PostgreSQL, Auth, RLS, Edge Functions, Storage), osobne projekty staging i produkcja.
- Schemat bazy jako migracje w repo, wdrażane przez GitHub Actions.

## Konsekwencje
- Brak własnego serwera do utrzymania.
- Logika serwerowa w Edge Functions (Deno/TypeScript).
- Produkcja na płatnym planie Supabase (darmowy usypia nieaktywne projekty).
