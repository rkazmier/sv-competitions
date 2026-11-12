#!/usr/bin/env bash
# Jednorazowa konfiguracja repozytorium na GitHubie.
# Wymaga: gh (zalogowany: gh auth login), uprawnienia admina do repo.
# Użycie (z katalogu repo):  ./scripts/bootstrap-github.sh rkazmier/sv-competitions
set -euo pipefail

REPO="${1:?Podaj repozytorium, np. rkazmier/sv-competitions}"
OWNER="${REPO%%/*}"
STAGING_REPO="${OWNER}/sv-competitions-staging"

echo "==> Etykiety"
label() { gh label create "$1" -R "$REPO" --color "$2" --description "$3" --force >/dev/null; echo "   $1"; }
label idea              "a2eeef" "Pomysł do analizy — uruchamia Analityka"
label spec              "5319e7" "PR ze specyfikacją"
label backlog           "c5def5" "Zadanie w kolejce"
label ready-for-dev     "0e8a16" "Następne do realizacji — uruchamia Implementatora"
label in-progress       "fbca04" "W realizacji"
label implementation    "1d76db" "PR z kodem"
label changes-requested "d93f0b" "Recenzent chce poprawek — uruchamia Implementatora"
label question          "e99695" "Agent czeka na odpowiedź właściciela"
label blocked           "b60205" "Zablokowane"
label bug               "d73a4a" "Błąd"
label report            "ededed" "Raport tygodniowy"

echo "==> Ochrona gałęzi main (ruleset): tylko przez PR, zielone CI, bez force-push"
gh api -X POST "repos/${REPO}/rulesets" --input - >/dev/null <<'JSON' || echo "   (ruleset już istnieje lub brak uprawnień — sprawdź Settings → Rules)"
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      } },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "checks" } ]
      } }
  ]
}
JSON

echo "==> Środowiska: staging, production (z Twoim zatwierdzeniem)"
MY_ID=$(gh api user -q .id)
gh api -X PUT "repos/${REPO}/environments/staging" >/dev/null
gh api -X PUT "repos/${REPO}/environments/production" --input - >/dev/null <<JSON
{ "reviewers": [ { "type": "User", "id": ${MY_ID} } ] }
JSON

echo "==> GitHub Pages (źródło: GitHub Actions, domena competitions.steel-valley.pl)"
gh api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 || echo "   (Pages już włączone)"
gh api -X PUT "repos/${REPO}/pages" -f cname=competitions.steel-valley.pl >/dev/null 2>&1 || echo "   (ustaw domenę ręcznie: Settings → Pages)"
gh api -X PUT "repos/${REPO}/environments/github-pages" --input - >/dev/null <<'JSON' || true
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST "repos/${REPO}/environments/github-pages/deployment-branch-policies" -f name='v*' -f type=tag >/dev/null 2>&1 || true
gh api -X POST "repos/${REPO}/environments/github-pages/deployment-branch-policies" -f name='main' -f type=branch >/dev/null 2>&1 || true

echo "==> Repozytorium stagingu: ${STAGING_REPO}"
gh repo view "$STAGING_REPO" >/dev/null 2>&1 || gh repo create "$STAGING_REPO" --public \
  --description "Staging SV Competitions (generowane automatycznie, nie edytować)"

echo
echo "Gotowe. Dalsze kroki ręczne opisane w README.md (sekcja 'Konfiguracja')."
