# ADR-0003: Strony publiczne generowane statycznie, przebudowa po zmianach

- Data: 2026-11-13
- Status: proponowana (przyjęta po merge SPEC-001)

## Kontekst
Frontend jest statyczny (GitHub Pages, ADR-0001). Strony zawodów będą udostępniane w mediach społecznościowych,
więc podgląd linku (Open Graph) i indeksowanie wymagają gotowego HTML, a nie danych pobieranych w przeglądarce.
Wdrożenie produkcji z Release wymaga zatwierdzenia i uruchamia migracje — nie nadaje się do odświeżania treści.

## Decyzja
- Strony publiczne (`/`, `/zawody/<slug>/`) są generowane przy budowaniu z danych Supabase (klucz publishable, RLS).
- Panel organizatora (`/panel/**`) to statyczne strony z wyspami, które pobierają dane w przeglądarce.
- Osobny workflow `rebuild-site.yml` buduje i publikuje wyłącznie frontend:
  - produkcja — z najnowszego opublikowanego Release (kod zatwierdzony przez właściciela), bez migracji i Edge Functions,
  - staging — z `main`,
  - wyzwalacze: `workflow_dispatch` z Edge Function `site-rebuild` oraz codziennie w nocy (minione zawody znikają z listy),
  - `concurrency` z `cancel-in-progress: true` — wdraża się ostatnia przebudowa.
- Edge Function `site-rebuild` sprawdza rolę organizatora i wywołuje GitHub API tokenem fine-grained
  (tylko to repo, *Actions: Read and write*) z sekretu Supabase `GITHUB_DISPATCH_TOKEN`; środowisko z sekretu `SITE_ENV`.

## Konsekwencje
- Zmiany treści są widoczne publicznie po ok. 2–5 minutach; podgląd szkicu w panelu działa od razu.
- Pełny podgląd linków i dobre SEO.
- Środowisko `github-pages` musi dopuszczać wdrożenia z gałęzi `main` (workflow_dispatch działa na `main`, choć buduje kod z tagu Release).
- Dodatkowy sekret (token GitHub) w obu projektach Supabase — do odnowienia przed wygaśnięciem (właściciel).
- Build zależy od dostępności Supabase; przy błędzie pobrania danych build kończy się porażką (zostaje poprzednia wersja strony).
