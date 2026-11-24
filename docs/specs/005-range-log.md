# SPEC-005: Książka rejestru pobytu na strzelnicy

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #38 (etap 4 z 4; wymaga SPEC-002 i SPEC-003)
- Zadania: #58, #59, #60, #61, #62, #63, #64 (kolejność w sekcji 11); dla właściciela: #39 (regulamin strzelnicy, klauzula) (`owner-task`)
- Decyzje: ADR-0006 (zadania cykliczne, retencja)

## 1. Cel

Elektroniczna książka rejestru pobytu zastępuje papierową. Obsługa skanuje kod QR klienta (albo wpisuje osobę bez konta),
sprawdza dane, wybiera uprawnienie, osoba wpisywana podpisuje się palcem na ekranie — wpis i zużycie karnetu zapisują się razem.
Admin przegląda książkę i eksportuje ją do PDF i CSV.

## 2. Zakres

**W zakresie:**
- Lista prowadzących strzelanie (admin), wybór prowadzącego na zmianę.
- Przebieg wpisu: osoba z kontem (kod QR / wyszukanie / admin z profilu), osoba bez konta, osoba towarzysząca.
- Uzupełnienie brakujących danych na miejscu, kolejność i wybór uprawnienia, sprzedaż przy braku uprawnienia (SPEC-003).
- Podpis odręczny na ekranie, obraz w prywatnym buckecie.
- Wpisy niezmienne, korekta przez adnotację; kopia danych osoby we wpisie.
- Historia wejść w `/konto/`, historia zużycia w karnecie.
- Widok admina z filtrami, eksport PDF i CSV; retencja 1 rok (zadanie automatyczne).
- Klauzula informacyjna przy wpisie osoby bez konta i regulamin strzelnicy przed podpisem (teksty od właściciela — 12-A).

**Poza zakresem:**
- Praca bez internetu (#37). Wydruk książki na papierze inaczej niż przez eksport PDF.
- Wpis bez uprawnienia z innego powodu (np. bezpłatne wydarzenie) — wpis wymaga uprawnienia albo jest wpisem osoby towarzyszącej.
- Rozliczanie czasu pobytu (wyjście ze strzelnicy), przydział stanowisk.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Użytkownik | Własne wejścia (data, godzina, prowadzący) bez podpisu | — |
| Obsługa | Dzisiejsze wpisy (bez podpisów), dane i uprawnienia obsługiwanej osoby | Tworzy wpisy, uzupełnia dane osoby (z `audit_log`), dodaje adnotacje do dzisiejszych wpisów |
| Admin | Całą książkę z podpisami (krótkotrwałe linki), filtry, eksport | Wszystko, co obsługa, + lista prowadzących, adnotacje do dowolnego wpisu |

Nikt nie może edytować ani usuwać wpisów (brak `update`/`delete` dla wszystkich ról); usuwa wyłącznie zadanie retencji.
Podpis zawsze składa osobiście osoba wpisywana.

> Od SPEC-008 (#128) wpisy jak Obsługa (bez sprzedaży na miejscu) prowadzi też dyżurny Prowadzący z konta w dniu dyżuru.

## 4. Historyjki i kryteria akceptacji

### US-1: Jako admin chcę prowadzić listę prowadzących strzelanie
- **AC-1**: Given `/panel/prowadzacy/` When dodaję imię i nazwisko (2–150 znaków), nr legitymacji (1–50 znaków) i instytucję (lista: PZSS, LOK, PZŁ, Inne; przy „Inne” pojawia się wymagane pole „Nazwa instytucji”, 2–150 znaków) Then prowadzący pojawia się na liście jako aktywny, z nr legitymacji i instytucją; bez któregokolwiek pola zapis jest odrzucony („Podaj nr legitymacji.”, „Wybierz instytucję.”, „Podaj nazwę instytucji.”); „Ukryj” / „Przywróć”, bez usuwania.
- **AC-1a**: Given prowadzący na liście When klikam „Edytuj” Then zmieniam imię i nazwisko, nr legitymacji i instytucję (wszystkie wymagane); prowadzący dodani przed #104 mają przy nazwisku „Brak nr legitymacji” do uzupełnienia. Nr legitymacji i instytucja nie trafiają do wpisów książki.
- **AC-2**: Given zmieniam imię i nazwisko prowadzącego When zapisuję Then wcześniejsze wpisy zachowują dawną wartość (kopia we wpisie).

### US-2: Jako obsługa chcę ustawić prowadzącego na zmianę
> Od SPEC-007 (#112) AC-3 i AC-4 zastępuje dyżurny Prowadzący zapisany w bazie (SPEC-007 AC-15…AC-21); prowadzący mogą też zgłaszać się z konta (SPEC-007 US-1).

- **AC-3**: Given otwieram `/panel/ksiazka/` When na tym urządzeniu nie wybrano dziś prowadzącego Then najpierw widzę „Kto prowadzi strzelanie?” z listą aktywnych prowadzących; wybór zapamiętuje urządzenie do końca dnia (Europe/Warsaw).
- **AC-4**: Given wybrany prowadzący When tworzę kolejne wpisy Then każdy dziedziczy prowadzącego; nazwisko widać na górze ekranu z przyciskiem „Zmień”.

### US-3: Jako obsługa chcę wpisać osobę z kontem
- **AC-5**: Given `/panel/ksiazka/` When klikam „Skanuj kod QR” i kamera odczyta kod Then funkcja `staff_find_by_qr(token)` zwraca osobę: imię i nazwisko, status („Gotowy do wpisu do książki” / lista braków), uprawnienia ważne dziś; nieznany lub stary kod → „Nie znaleziono konta dla tego kodu.”.
- **AC-6**: Given brak kamery lub kod nieczytelny When wpisuję min. 3 znaki imienia i nazwiska lub e-maila Then widzę maks. 10 pasujących osób (imię i nazwisko, część e-maila) do wyboru.
- **AC-7**: Given osoba ma braki w danych When klikam „Uzupełnij dane” Then w tym samym ekranie wpisuję brakujące pola (walidacja SPEC-002 AC-8, AC-11); zapis aktualizuje profil i `audit_log`; bez kompletu danych przycisk „Dalej” jest nieaktywny.
- **AC-8**: Given admin w karcie użytkownika (SPEC-002) When klika „Rozpocznij wpis do książki” Then przechodzi ten sam przebieg od kroku wyboru uprawnienia.
- **AC-9**: Given osoba ma już dziś wpis When ją wybieram Then widzę ostrzeżenie „Ta osoba ma dziś wpis o 10:32. Kontynuować?” (nowy wpis dozwolony, zużywa kolejne uprawnienie — chyba że wejściówka obejmuje dziś).

### US-4: Jako obsługa chcę, żeby system sam wybrał właściwe uprawnienie
> Od SPEC-012: w dniach zawodów i wydarzeń z blokadą karnetów ważne są tylko wejściówki (SPEC-012 AC-41…AC-44).

- **AC-10**: Given osoba ma uprawnienia ważne dziś (SPEC-003 `passes_valid_on`) When przechodzę do wyboru Then lista jest w kolejności: (0) wejściówka na dzisiejsze wydarzenie, (1) karnet ilościowy, (2) wejście jednorazowe pasujące do dnia tygodnia; w każdej grupie wg najwcześniejszego `expires_on`. Domyślnie zaznaczona pierwsza pozycja; mogę wybrać inną.
- **AC-11**: Given każda pozycja listy When ją widzę Then ma opis skutku: „Puchar SV — obejmuje dziś (bez zmian)”, „Karnet 10 wejść — zostanie 6”, „Wejście weekendowe — zostanie wykorzystane”.
- **AC-12**: Given osoba nie ma uprawnienia ważnego dziś When przechodzę do wyboru Then widzę „Brak ważnego karnetu lub wejścia na dziś.” i przycisk „Sprzedaj na miejscu” (SPEC-003 AC-21, po sprzedaży wracam do wpisu z nowym uprawnieniem) oraz „Wpisz jako osobę towarzyszącą”.

### US-5: Jako osoba wpisywana chcę podpisać się na ekranie
- **AC-13**: Given wybrane uprawnienie When przechodzę do podpisu Then widzę dane wpisu (data i godzina, imię i nazwisko, decyzja i organ albo adres, prowadzący), regulamin strzelnicy (przewijany; treść od właściciela z #39 — „Regulamin użytkowania strzelnicy w miejscowości Morawy Wielkie”, rozdziały 1–4; ramka na samym dole ekranu, pod przyciskami, żeby pole podpisu i „Zapisz wpis” były widoczne bez przewijania) i pole podpisu z tekstem „Podpisując, potwierdzasz zapoznanie się z regulaminem strzelnicy.”.
- **AC-14**: Given pole podpisu When podpis jest pusty lub za krótki (< 20 punktów ścieżki) Then „Zapisz wpis” jest nieaktywny; „Wyczyść” czyści pole.
- **AC-15**: Given podpis When klikam „Zapisz wpis” Then podpis (PNG, białe tło, maks. 200 KB) trafia do prywatnego bucketu `signatures`, a funkcja `create_range_log_entry` w jednej transakcji: tworzy wpis z kopią danych osoby i prowadzącego, zapisuje zużycie w `pass_usages` (zgodnie z wyborem: licznik −1, `used_up`), sprawdza ponownie ważność uprawnienia z blokadą wiersza.
- **AC-16**: Given zapis się nie udał (sieć, uprawnienie zużyte w międzyczasie) When wraca błąd Then wpis i zużycie nie powstają (transakcja), widzę „Nie udało się zapisać wpisu. Spróbuj ponownie.” lub „Uprawnienie zostało właśnie wykorzystane — wybierz inne.”, a podpis pozostaje na ekranie do ponowienia.
- **AC-17**: Given wpis zapisany When widzę potwierdzenie „Wpisano do książki: <imię i nazwisko>, <godzina>.” Then mam przyciski „Dodaj osobę towarzyszącą” i „Następna osoba”.

### US-6: Jako obsługa chcę wpisać osobę bez konta i osobę towarzyszącą
- **AC-18**: Given `/panel/ksiazka/` When klikam „Osoba bez konta” Then wpisuję Imię i nazwisko* oraz (Numer decyzji + Organ wydający) albo Adres zamieszkania; przed podpisem osoba widzi klauzulę informacyjną RODO (tekst zastępczy do czasu dostarczenia).
- **AC-19**: Given osoba bez konta (nie towarzysząca) When przechodzę do uprawnień Then muszę zarejestrować sprzedaż na miejscu wejścia jednorazowego lub wejściówki (SPEC-003 AC-22); powstałe uprawnienie bez właściciela zużywa się tym wpisem.
- **AC-20**: Given po wpisie klikam „Dodaj osobę towarzyszącą” When wybieram osobę (kod QR, wyszukanie lub bez konta) Then wpis przebiega bez kroku uprawnienia (nie zużywa karnetu), z własnym podpisem; wpis nie jest powiązany z żadnym innym wpisem ani kontem korzystającego.

### US-7: Jako obsługa / admin chcę poprawić błąd we wpisie
- **AC-21**: Given wpis When klikam „Dodaj adnotację” i wpisuję treść (5–500 znaków) Then pod wpisem widać adnotację (kto, kiedy, treść); wpisu nie da się zmienić ani usunąć (brak `update`/`delete`, test pgTAP dla wszystkich ról).
- **AC-22**: Given obsługa When próbuje dodać adnotację do wpisu z innego dnia niż dziś Then operacja jest odrzucona (tylko admin).
- **AC-23**: Given zużycie karnetu wpisane omyłkowo When admin klika „Cofnij zużycie” przy wpisie (w szczegółach karnetu) Then zużycie jest wycofane (licznik +1 / wejście jednorazowe znów aktywne), powstaje adnotacja do wpisu „Cofnięto zużycie karnetu” i `audit_log` `pass_usage_revert`; sam wpis pozostaje.

### US-8: Jako użytkownik chcę widzieć swoje wejścia
- **AC-24**: Given `/konto/` When patrzę na „Historia wejść” Then widzę swoje wpisy (data i godzina, prowadzący, wykorzystane uprawnienie), od najnowszych, bez podpisów; wpisy jako osoba towarzysząca też (bez uprawnienia).
- **AC-25**: Given karnet w „Twoje karnety” When go rozwijam Then widzę historię zużycia (data, godzina).

### US-9: Jako admin chcę przeglądać i eksportować książkę
- **AC-26**: Given `/panel/ksiazka/przeglad/` When filtruję (data od–do, imię i nazwisko, prowadzący) Then widzę wpisy w kolumnach: Data i godzina, Imię i nazwisko, Nr decyzji i organ wydający / Adres zamieszkania, Prowadzący strzelanie, Podpis (miniatura ładowana podpisanym linkiem ważnym 60 s), + adnotacje; tylko te kolumny.
- **AC-27**: Given filtr dzień lub zakres dat When klikam „Eksport PDF” Then w przeglądarce powstaje PDF w układzie książki (A4 poziomo, nagłówek „Książka rejestru pobytu na strzelnicy Steel Valley”, zakres dat, kolumny z AC-26 z obrazami podpisów, adnotacje pod wpisem, numer strony).
- **AC-28**: Given filtr When klikam „Eksport CSV” Then pobieram plik (UTF-8 z BOM, `;`) z kolumnami z AC-26, przy czym podpis = „tak”, data i godzina w Europe/Warsaw `RRRR-MM-DD GG:MM`.
- **AC-29**: Given każdy eksport i każde wyświetlenie podpisów When zostanie wykonane Then `audit_log` zapisuje `range_log_export` (zakres, format) — eksport to przetwarzanie danych wielu osób.

### US-10: Jako właściciel chcę, by stare wpisy znikały automatycznie
- **AC-30**: Given wpis starszy niż okres retencji (`public.range_log_retention()` = `interval '1 year'`, zmiana przez PR) When działa nocne zadanie (ADR-0006) Then wpis, jego adnotacje i plik podpisu są usuwane; `pass_usages` zostaje z `range_log_entry_id = null` (historia karnetu).
- **AC-31**: Given pliki podpisów bez wpisu (zapis wpisu nie doszedł do skutku) When są starsze niż 24 h Then to samo zadanie je usuwa.

## 5. Model danych

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `range_officers` | `id` | `uuid` PK | tak | nie | |
| | `full_name` | `text` | tak | tak | 2–150 znaków |
| | `license_number` | `text` | nie* | tak | nr legitymacji, 1–50 znaków; *wymagany w formularzu (puste tylko u prowadzących sprzed #104); parą z `institution` |
| | `institution` | `text` | nie* | nie | `PZSS` / `LOK` / `PZL` (PZŁ) / `OTHER` (Inne) |
| | `institution_other` | `text` | gdy `OTHER` | nie | nazwa instytucji przy „Inne”, 2–150 znaków; tylko przy `OTHER` |
| | `is_active` | `boolean` | tak | nie | |
| | `created_at` | `timestamptz` | tak | nie | |
| `range_log` | `id` | `uuid` PK | tak | nie | nadawany przez klienta przed wysłaniem podpisu (ścieżka pliku) |
| | `entered_at` | `timestamptz` | tak | nie | `now()` w bazie (nie z urządzenia) |
| | `full_name` | `text` | tak | tak | kopia |
| | `permit_number`, `permit_authority` | `text` | nie | tak | kopia; parą |
| | `address` | `text` | nie | tak | kopia; `check (permit_number is not null or address is not null)` |
| | `range_officer_name` | `text` | tak | tak | kopia |
| | `range_officer_id` | `uuid` FK → `range_officers.id` on delete set null | nie | nie | |
| | `signature_path` | `text` | tak | nie (ścieżka) | `signatures/<RRRR>/<MM>/<id>.png` |
| | `profile_id` | `uuid` FK → `profiles.id` on delete set null | nie | tak | techniczne — historia wejść; nie w widoku książki ani eksporcie |
| | `is_companion` | `boolean` | tak | nie | techniczne — nie w widoku książki; brak zużycia |
| | `created_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | techniczne — kto wpisał |
| `range_log_annotations` | `id`, `entry_id` (FK on delete cascade), `body` (5–500), `created_by`, `created_at` | | tak | tak | |
| `pass_usages` | `id` | `uuid` PK | tak | nie | |
| | `user_pass_id` | `uuid` FK → `user_passes.id` on delete cascade | tak | nie | |
| | `range_log_entry_id` | `uuid` FK → `range_log.id` on delete set null, unikalny | nie | nie | |
| | `used_on` | `date` | tak | nie | dzień Europe/Warsaw |
| | `effect` | `text` check in (`covered`, `decremented`, `consumed`) | tak | nie | dzień wejściówki / licznik −1 / jednorazowe (`activated` — usunięte z karnetami czasowymi, SPEC-012 US-10) |
| | `reverted_at`, `reverted_by` | | nie | | AC-23 |
| | `created_at` | `timestamptz` | tak | nie | |

Książka (widok i eksport) = kolumny: `entered_at`, `full_name`, `permit_number`+`permit_authority` lub `address`, `range_officer_name`, podpis.
Nie zawiera rodzaju osoby, wersji regulaminu ani informacji rozliczeniowych — te są w `pass_usages`.

### RLS i funkcje
- `range_officers`: `select` — `is_staff()`; zapis — `is_admin()`.
- `range_log`: `select` — `is_admin()` wszystkie; `is_staff()` tylko z dzisiaj; użytkownik — przez funkcję `my_range_entries()` (bez podpisu i kolumn technicznych).
  `insert` wyłącznie przez `create_range_log_entry(...)` (`security definer`, `is_staff()`); **brak** `update` i `delete` dla wszystkich ról, także admina.
- `range_log_annotations`: `select` jak wpis; `insert` — admin dowolny, obsługa do dzisiejszych; brak `update`/`delete`.
- `pass_usages`: `select` własnych (przez `user_passes`) i `is_staff()`; zapis tylko funkcjami.
- `staff_find_by_qr(token)`, `staff_search_people(query)` — `security definer`, `is_staff()`, zwracają minimum danych.
- Storage: bucket `signatures` **prywatny**, PNG, maks. 200 KB; `insert` — `is_staff()`; `select` — `is_admin()` (podpisane linki 60 s); brak `update`/`delete` dla klientów.
- `create_range_log_entry`: sprawdza istnienie pliku podpisu, kompletność danych, ważność uprawnienia (z `for update`), tworzy wpis i zużycie atomowo.

## 6. Interfejs użytkownika

| Adres | Zawartość |
| --- | --- |
| `/panel/ksiazka/` | Prowadzący zmiany; „Skanuj kod QR”, wyszukiwarka, „Osoba bez konta”; przebieg: osoba → dane → uprawnienie → podpis → potwierdzenie; lista dzisiejszych wpisów (godzina, imię i nazwisko) |
| `/panel/ksiazka/przeglad/` | Widok admina z filtrami i eksportem (AC-26…AC-28) |
| `/panel/prowadzacy/` | Lista prowadzących (admin) |
| `/konto/` | + „Historia wejść”, historia zużycia w karnecie |

- Ekran wpisu projektowany na tablet i telefon w pionie; pole podpisu na całą szerokość, min. 200 px wysokości; podczas podpisu strona się nie przewija.
- Skan QR: `BarcodeDetector`, a gdy niedostępny — biblioteka JS odczytu QR (bez usług zewnętrznych); kamera tylna domyślnie.
- Osoba wpisywana widzi ekran podpisu bez przycisków nawigacji panelu (tryb „podaj urządzenie”); powrót do panelu przyciskiem po zapisie.

## 7. Przypadki brzegowe

- Dwa urządzenia zużywają jednocześnie ostatnie wejście karnetu → druga transakcja dostaje błąd (AC-16), blokada `for update`.
- Wpis około północy → dzień zużycia i ważności liczony z `now()` bazy w Europe/Warsaw, nie z zegara urządzenia.
- Zmiana danych w profilu lub usunięcie konta → wpis bez zmian (kopia), `profile_id = null`.
- Prowadzący ukryty w trakcie zmiany → kolejne wpisy na urządzeniu wymagają ponownego wyboru.
- Podpis wysłany, wpis nieudany → plik osierocony usuwany po 24 h (AC-31).
- Ta sama osoba jako korzystający i jako towarzysząca tego samego dnia → dwa wpisy, dozwolone.
- Retencja usuwa wpis z adnotacją → adnotacja usuwana razem z wpisem.

## 8. Integracje

- **Storage** — bucket `signatures` (prywatny), podpisane linki do odczytu.
- **Edge Function `retention`** (ADR-0006) — uruchamiana codziennie przez `pg_cron` + `pg_net` z sekretem wywołania; usuwa pliki podpisów wpisów starszych niż retencja i osierocone, potem wiersze (funkcja SQL `purge_range_log()`), wynik (liczby) do logu bez danych osobowych.
- **PDF** — generowany w przeglądarce (biblioteka npm, np. `pdf-lib`), polskie znaki przez osadzony font Inter.

## 9. RODO

- Dane we wpisie: imię i nazwisko, numer decyzji i organ albo adres, podpis (obraz); cel — obowiązek prowadzenia książki rejestru pobytu na strzelnicy.
- Dostęp: admin (całość), obsługa (dzisiejsze, bez podpisów), osoba (własne wejścia bez podpisu).
- Przechowywanie: 1 rok od wpisu, potem automatyczne usunięcie wpisu i podpisu (decyzja z issue; okres w kodzie, zmiana PR-em).
- Podpisy tylko w prywatnym buckecie, odczyt przez linki ważne 60 s; eksporty i przeglądanie podpisów logowane (AC-29).
- Osoba bez konta: klauzula informacyjna przed podpisem; jej dane nie trafiają nigdzie poza wpis.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Kolumny książki, niezmienność, adnotacje, kopia danych, retencja 1 rok, eksport | Z issue #38 (zatwierdzony wzór książki) | 2026-11-17 |
| Kolejność zużycia uprawnień | Z issue #38; wejściówka przed karnetami (7-A) | 2026-11-17 |
| Karnet imienny, osoby towarzyszące nie zużywają karnetu | 8-A | 2026-11-17 |
| Osoba bez konta płaci na miejscu, dane tylko w książce | 10-A | 2026-11-17 |
| Regulamin strzelnicy i klauzula informacyjna | 12-A: teksty od właściciela, do tego czasu zastępcze; oba dostarczone w #39 (regulamin 2026-11-21) — klauzula RODO pozostaje osobnym tekstem (`privacy.body`) | 2026-11-17 |
| Nr legitymacji i instytucja prowadzącego | #104: obowiązkowe; tylko na liście prowadzących (nie we wpisach); „Inne” z polem na nazwę instytucji | 2026-11-18 |

Założenia analityka (zatwierdzane razem ze specyfikacją): prowadzący zapamiętywany na urządzeniu do końca dnia; obsługa widzi tylko dzisiejsze wpisy
i dodaje adnotacje tylko do nich; admin może cofnąć omyłkowe zużycie karnetu (wpis zostaje); eksport i podgląd podpisów zapisywane w dzienniku zmian.

Otwarte: brak.

## 11. Zadania

1. #58 Schemat książki: `range_officers`, `range_log`, adnotacje, `pass_usages`, bucket `signatures`, funkcje i RLS, testy pgTAP (niezmienność, kolejność uprawnień, współbieżność).
2. #59 Prowadzący strzelanie: panel i wybór na zmianę (AC-1…AC-4).
3. #60 Wpis osoby z kontem: skan QR, wyszukiwanie, uzupełnianie danych, wybór uprawnienia (AC-5…AC-12).
4. #61 Podpis i zapis wpisu, osoba bez konta, osoba towarzysząca (AC-13…AC-20).
5. #62 Adnotacje, cofnięcie zużycia, historia wejść w `/konto/` (AC-21…AC-25).
6. #63 Przegląd i eksport PDF/CSV (AC-26…AC-29).
7. #64 Retencja: Edge Function `retention`, `pg_cron` (AC-30, AC-31).
