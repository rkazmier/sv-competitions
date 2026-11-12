# Proces wytwórczy

```
Ty: issue z pomysłem (etykieta idea)
  └─► Analityk: specyfikacja (PR, etykieta spec) + zadania w kolejce (etykieta backlog)
        └─► Ty: merge specyfikacji
              └─► Kolejka: najstarsze zadanie backlog → ready-for-dev
                    └─► Implementator: kod + testy (PR, etykieta implementation)
                          └─► CI + Recenzent  ──(changes-requested)──► Implementator poprawia
                                └─► Ty: merge do main
                                      ├─► automatycznie: staging
                                      └─► Kolejka: następne zadanie
Ty: sprawdzasz staging → publikujesz Release → zatwierdzasz wdrożenie → produkcja
```

## Etykiety

| Etykieta | Znaczenie | Kto nadaje |
| --- | --- | --- |
| `idea` | Pomysł do analizy — uruchamia Analityka | Ty (szablon issue) |
| `spec` | PR ze specyfikacją | Analityk |
| `backlog` | Zadanie w kolejce | Analityk, szablon błędu |
| `ready-for-dev` | Następne do realizacji — uruchamia Implementatora | Automat kolejki |
| `in-progress` | W realizacji | Implementator |
| `implementation` | PR z kodem | Implementator |
| `changes-requested` | Recenzent chce poprawek — uruchamia Implementatora | Recenzent |
| `question` | Agent czeka na Twoją odpowiedź | Agenci |
| `blocked` | Zablokowane czymś zewnętrznym | Ty / agenci |
| `bug` | Błąd | Ty (szablon) |
| `report` | Raport tygodniowy | Agent raportu |

## Bramki jakości

**Definition of Ready** — zanim Implementator zacznie:
- specyfikacja zmergowana, kryteria akceptacji Given/When/Then (AC-x), model danych opisany, brak otwartych pytań.

**Definition of Done** — zanim poprosisz o merge:
- CI zielone, każde AC ma test, migracja działa na czystej bazie, Recenzent: ✅, dokumentacja aktualna.

**Wydanie**:
- staging sprawdzony, Release z notatką, automatyczna kopia bazy przed migracją, zatwierdzenie environment `production`.

## Odpowiadanie agentom

Zawsze komentarzem zaczynającym się od `@claude`, np. `@claude A` albo `@claude 1-B, 2-A`.
Możesz też zlecić drobną zmianę bezpośrednio w PR: `@claude zmień tekst przycisku na „Zapisz się”`.

## Gdy coś utknie

- Kolejka stoi: sprawdź issue z `question` lub `in-progress`. Ręczny start: Actions → „Kolejka: następne zadanie” → Run workflow.
- Agent zrobił coś źle: zamknij PR z komentarzem dlaczego i dodaj z powrotem `ready-for-dev` do issue.
