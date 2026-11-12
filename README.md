# SV Competitions

Zawody strzeleckie Steel Valley — kalendarz, zapisy, płatności Tpay, wyniki i ranking.
Produkcja: https://competitions.steel-valley.pl · Staging: https://competitions-staging.steel-valley.pl

Projekt budują agenci AI na GitHubie. Właściciel zgłasza pomysły, odpowiada na pytania i merguje PR-y.
Proces: [docs/process.md](docs/process.md) · Zasady agentów: [CLAUDE.md](CLAUDE.md)

---

## Konfiguracja (jednorazowo, ok. 1–2 godziny)

### 1. Repozytorium
1. Utwórz repo `rkazmier/sv-competitions` (uwaga: GitHub Pages z **prywatnego** repo wymaga płatnego planu GitHub).
2. Wgraj te pliki:
   ```bash
   git init -b main && git add . && git commit -m "chore: project bootstrap"
   git remote add origin git@github.com:rkazmier/sv-competitions.git && git push -u origin main
   ```
3. Uruchom: `./scripts/bootstrap-github.sh rkazmier/sv-competitions`
   (etykiety, ochrona `main`, środowiska, Pages, repo stagingu).

### 2. Claude (agenci)
1. Zainstaluj aplikację Claude na repo: https://github.com/apps/claude
2. Lokalnie: `claude setup-token` → skopiuj token.
3. Settings → Secrets and variables → Actions → **New repository secret**: `CLAUDE_CODE_OAUTH_TOKEN`.
   (Albo klucz API jako `ANTHROPIC_API_KEY` i zmień linię uwierzytelnienia w workflowach `agent-*.yml`.)

### 3. Token agentów (`AGENT_GH_TOKEN`)
Akcje wykonane domyślnym tokenem GitHuba nie uruchamiają kolejnych workflowów, dlatego agenci
otwierają PR-y i nadają etykiety osobnym tokenem.
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.
2. Dostęp tylko do repo `sv-competitions` i `sv-competitions-staging`.
   Uprawnienia: Contents RW, Issues RW, Pull requests RW, Metadata R. Ważność: 1 rok (przypomnienie w kalendarzu).
3. Zapisz jako sekret repo: `AGENT_GH_TOKEN`.

> PR-y agentów będą miały Ciebie jako autora (to Twój token). Dlatego ochrona `main` wymaga zielonego CI,
> a nie zatwierdzenia recenzji — merge i tak robisz tylko Ty.

### 4. Supabase
1. Załóż dwa projekty: `sv-competitions-staging` (plan darmowy) i `sv-competitions` (plan płatny), region UE (Frankfurt).
2. Account → Access Tokens → nowy token.
3. Token z kroku 2 zapisz raz jako **sekret repozytorium** `SUPABASE_ACCESS_TOKEN`.
4. Dla środowisk **staging** i **production** (Settings → Environments) ustaw:

| Typ | Nazwa | Wartość |
| --- | --- | --- |
| Secret | `SUPABASE_DB_PASSWORD` | hasło bazy danego projektu |
| Variable | `SUPABASE_PROJECT_REF` | ID projektu (z URL panelu) |
| Variable | `SUPABASE_URL` | `https://<ref>.supabase.co` |
| Variable | `SUPABASE_ANON_KEY` | klucz publiczny `sb_publishable_…` (Settings → API Keys) |
| Variable | `APP_URL` | `https://competitions-staging.steel-valley.pl` / `https://competitions.steel-valley.pl` |

### 5. Tpay
1. Konto sandbox: https://register.sandbox.tpay.com — dane API do środowiska **staging**.
2. Konto produkcyjne (umowa) — dane API do środowiska **production**.
3. W każdym środowisku:

| Typ | Nazwa | Staging | Produkcja |
| --- | --- | --- | --- |
| Secret | `TPAY_CLIENT_ID` | z sandboxa | z produkcji |
| Secret | `TPAY_CLIENT_SECRET` | z sandboxa | z produkcji |
| Variable | `TPAY_API_URL` | `https://openapi.sandbox.tpay.com` | `https://api.tpay.com` |

Adres powiadomień ustawi Implementator w etapie płatności (Edge Function `payments-notify`).

### 6. Domena (GoDaddy → DNS dla steel-valley.pl)

| Typ | Nazwa | Wartość |
| --- | --- | --- |
| CNAME | `competitions` | `rkazmier.github.io` |
| CNAME | `competitions-staging` | `rkazmier.github.io` |

Potem: repo `sv-competitions` → Settings → Pages → zaznacz **Enforce HTTPS**.
Repo `sv-competitions-staging` → Settings → Pages → źródło: gałąź `gh-pages` (pojawi się po pierwszym wdrożeniu stagingu).
Na stronie steel-valley.pl dodaj link do https://competitions.steel-valley.pl.

### 7. Telefon
Zainstaluj **GitHub Mobile**, włącz powiadomienia dla repo (Watch → All Activity lub Participating and @mentions).

---

## Start pracy agentów

Załóż issue z szablonu **„💡 Pomysł”**, np.:

> **Pomysł: szkielet aplikacji i kalendarz zawodów**
> Postaw projekt Astro w `web/` i Supabase w `supabase/`, z logowaniem e-mail.
> Pierwsza strona: lista nadchodzących zawodów i strona pojedynczych zawodów z regulaminem.

Analityk przygotuje specyfikację i zada pytania. Dalej wszystko dzieje się w issue i PR-ach.

## Workflowy

| Plik | Kiedy | Co robi |
| --- | --- | --- |
| `agent-analyst.yml` | etykieta `idea` | Specyfikacja + zadania w `backlog` |
| `agent-next-task.yml` | merge PR `spec`/`implementation` | Najstarsze zadanie `backlog` → `ready-for-dev` |
| `agent-implement.yml` | `ready-for-dev` / `changes-requested` | Kod, testy, PR / poprawki |
| `agent-review.yml` | nowy PR z kodem | Recenzja i werdykt |
| `agent-chat.yml` | komentarz z `@claude` | Odpowiedzi na pytania, drobne polecenia |
| `agent-weekly-report.yml` | poniedziałek rano | Raport w issue |
| `ci.yml` | każdy PR | Migracje, lint, typy, testy, build, E2E |
| `deploy-staging.yml` | merge do `main` | Staging |
| `deploy-production.yml` | opublikowany Release | Produkcja (po Twoim zatwierdzeniu) |

Zgłoszony błąd (szablon „🐞 Błąd”) trafia do kolejki `backlog`; wystartuje po najbliższym merge
albo ręcznie: Actions → „Kolejka: następne zadanie” → Run workflow.
