# SPEC-007: Uprawnienia prowadzącego z konta i dyżurny Prowadzący

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #112 (rozszerza SPEC-005 US-1, US-2 i SPEC-002 „Twoje dane”)
- Zadania: #113, #114, #115, #116, #117 (kolejność w sekcji 11)

## 1. Cel

Prowadzący strzelanie, który ma konto, sam zgłasza swoje uprawnienia w `/konto/` (bez proszenia admina). Obsługa ustawia
jednego dyżurnego Prowadzącego na cały dzień dla całej strzelnicy (w bazie, nie na każdym urządzeniu), a przy wpisie może
wskazać innego Prowadzącego — w tym osobę wpisywaną, jeśli sama prowadzi. Nazwisko Prowadzącego, który wybrał „Ukryj mnie dla
innych”, nie pojawia się na listach wyboru.

## 2. Zakres

**W zakresie:**
- Zgłoszenie uprawnień prowadzącego z konta (nr legitymacji, instytucja, „Ukryj mnie dla innych”), edycja, usunięcie.
- Zatwierdzanie i odrzucanie zgłoszeń przez admina lub Obsługę w panelu.
- Dyżurny Prowadzący — jeden na dzień (Europe/Warsaw) dla całej strzelnicy, w bazie; zastępuje wybór na urządzeniu (SPEC-005 AC-3, AC-4).
- Wybór Prowadzącego przy każdym wpisie: domyślnie dyżurny; lista z osobą wpisywaną na początku; wyszukiwarka ukrytych.

**Poza zakresem:**
- Łączenie prowadzącego dodanego przez admina z kontem użytkownika (admin może ukryć dawny wiersz — §7).
- Powiadomienia (e-mail) o zgłoszeniu, zatwierdzeniu lub odrzuceniu.
- Załączanie skanu legitymacji, sprawdzanie ważności legitymacji.
- Grafik dyżurów na przyszłe dni (dyżurny ustawiany jest tylko na dziś).
- Nr legitymacji i instytucja we wpisach książki — nadal ich tam nie ma (decyzja z #104).

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Użytkownik | Własne zgłoszenie prowadzącego (status, nr legitymacji, instytucja, „Ukryj mnie dla innych”) — tylko przez funkcje | Dodaje, edytuje (→ ponowne zatwierdzenie), przełącza „Ukryj mnie dla innych”, usuwa własne zgłoszenie |
| Obsługa | Wszystkich prowadzących (jak dziś, SPEC-005 §5) z zgłoszeniami do zatwierdzenia; dzisiejszego dyżurnego | Zatwierdza / odrzuca zgłoszenia z kont; ustawia dyżurnego na dziś; wybiera Prowadzącego przy wpisie |
| Admin | Wszystko, co obsługa | Wszystko, co obsługa, + lista prowadzących dodanych przez admina (SPEC-005 AC-1, AC-1a), „Ukryj” / „Przywróć” każdego prowadzącego |

Zgłoszeń z kont nie edytuje admin ani Obsługa (dane wpisuje właściciel konta; imię i nazwisko z profilu).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako użytkownik z legitymacją chcę zgłosić uprawnienia prowadzącego z konta
- **AC-1**: Given `/konto/`, sekcja „Twoje dane”, nie mam zgłoszenia (albo je usunąłem) When patrzę na sekcję Then widzę przycisk „Dodaj uprawnienia prowadzącego”.
- **AC-2**: Given klikam „Dodaj uprawnienia prowadzącego” When widzę formularz Then ma on pola: „Nr legitymacji” (1–50 znaków), „Instytucja” (PZSS, LOK, PZŁ, Inne; przy „Inne” wymagane „Nazwa instytucji”, 2–150 znaków) — te same walidacje i komunikaty co SPEC-005 AC-1 — oraz pole wyboru „Ukryj mnie dla innych”, **domyślnie zaznaczone**, z podpowiedzią „Obsługa znajdzie Cię tylko przez wyszukiwanie. Przy Twoim własnym wpisie do książki zawsze możesz wskazać siebie.”; imię i nazwisko jest pokazane (bez edycji) z profilu.
- **AC-3**: Given profil bez imienia i nazwiska When klikam „Dodaj uprawnienia prowadzącego” Then widzę „Uzupełnij imię i nazwisko w „Twoje dane”, aby dodać uprawnienia prowadzącego.” i formularz się nie otwiera (baza też odrzuca: `full_name_required`).
- **AC-4**: Given poprawny formularz When klikam „Wyślij do zatwierdzenia” Then w `range_officers` powstaje (albo, po wcześniejszym usunięciu, wraca) jeden wiersz powiązany z kontem (`profile_id`) ze statusem `pending`; w „Twoje dane” widzę „Uprawnienia prowadzącego: czekają na zatwierdzenie”, nr legitymacji, instytucję i przyciski „Edytuj”, „Usuń”.
- **AC-5**: Given zgłoszenie `pending` lub `rejected` When ktokolwiek wybiera Prowadzącego (dyżurny, wpis, wyszukiwarka) Then tego zgłoszenia nie ma na żadnej liście ani w wynikach wyszukiwania; baza odrzuca je jako dyżurnego i we wpisie (`range_officer_inactive`).
- **AC-6**: Given jedno konto When próbuje utworzyć drugie zgłoszenie Then baza nie pozwala (`range_officers.profile_id` unikalny); formularz zawsze edytuje istniejące.

### US-2: Jako admin lub Obsługa chcę zatwierdzać zgłoszenia z kont
- **AC-7**: Given `/panel/prowadzacy/` (Obsługa i admin) When są zgłoszenia `pending` Then na górze widzę sekcję „Do zatwierdzenia (n)” z każdym zgłoszeniem: imię i nazwisko, nr legitymacji, instytucja, data zgłoszenia, przyciski „Zatwierdź” i „Odrzuć”; w menu panelu pozycja „Prowadzący (n)” pokazuje liczbę oczekujących.
- **AC-8**: Given zgłoszenie `pending` When klikam „Zatwierdź” Then status = `approved`, zapisane są `reviewed_by`, `reviewed_at`, a `audit_log` zapisuje `range_officer_review` (zgłoszenie, decyzja); użytkownik w „Twoje dane” widzi „Uprawnienia prowadzącego: zatwierdzone”.
- **AC-9**: Given zgłoszenie `pending` When klikam „Odrzuć” i potwierdzam „Odrzucić zgłoszenie <imię i nazwisko>?” Then status = `rejected` (z `audit_log` jak AC-8); użytkownik widzi „Uprawnienia prowadzącego: odrzucone. Popraw dane i wyślij ponownie albo skontaktuj się z obsługą strzelnicy.” i może edytować zgłoszenie (AC-11 → `pending`).
- **AC-10**: Given Obsługa (nie admin) na `/panel/prowadzacy/` When przegląda stronę Then widzi sekcję „Do zatwierdzenia” i listę prowadzących tylko do odczytu; dodawanie, edycja i „Ukryj” / „Przywróć” pozostają dla admina (SPEC-005 AC-1, AC-1a). Zgłoszenia z kont na liście mają oznaczenie „Z konta” i — jeśli użytkownik je ukrył — „Ukryty dla innych”; admin nie edytuje ich danych (tylko „Ukryj” / „Przywróć”).

### US-3: Jako użytkownik chcę zmieniać i usuwać swoje uprawnienia prowadzącego
- **AC-11**: Given zgłoszenie (dowolny status) When klikam „Edytuj”, zmieniam nr legitymacji lub instytucję i zapisuję Then status wraca do `pending` (od tej chwili AC-5), a „Twoje dane” pokazuje „czekają na zatwierdzenie”; zapis bez zmiany tych pól nie zmienia statusu.
- **AC-12**: Given zgłoszenie When zmieniam tylko „Ukryj mnie dla innych” Then zmiana działa od razu, bez zatwierdzenia, i nie zmienia statusu.
- **AC-13**: Given zgłoszenie When klikam „Usuń” i potwierdzam „Usunąć uprawnienia prowadzącego? Dawne wpisy w książce się nie zmienią.” Then zgłoszenie znika z list (`is_active = false`), dawne wpisy książki zachowują nazwisko (kopia, SPEC-005 AC-2), a w „Twoje dane” znów widzę „Dodaj uprawnienia prowadzącego” (ponowne dodanie → AC-4, status `pending`).
- **AC-14**: Given zmieniam imię i nazwisko w profilu (SPEC-002) When zapisuję Then `range_officers.full_name` zgłoszenia zmienia się razem z profilem (bez ponownego zatwierdzenia); dawne wpisy książki bez zmian.

### US-4: Jako Obsługa chcę ustawić dyżurnego Prowadzącego na cały dzień
- **AC-15**: Given `/panel/ksiazka/` When na dziś (Europe/Warsaw, zegar bazy) nie ma dyżurnego Then najpierw widzę „Kto prowadzi dziś strzelanie?” z listą wyboru (AC-18 bez osoby wpisywanej) i wyszukiwarką „Szukaj prowadzącego”; po wyborze dyżurny zapisuje się w bazie dla całej strzelnicy (zastępuje SPEC-005 AC-3; `localStorage` `sv-range-shift` nie jest już używany).
- **AC-16**: Given dyżurny ustawiony When otwieram `/panel/ksiazka/` na dowolnym urządzeniu (Obsługa lub admin) Then na górze widzę „Dyżurny: <imię i nazwisko>” z przyciskiem „Zmień”; zmiana obowiązuje od razu dla wszystkich urządzeń do końca dnia; następnego dnia dyżurnego trzeba wybrać ponownie.
- **AC-17**: Given dyżurny zostaje ukryty (admin „Ukryj”), usunięty przez użytkownika albo jego zgłoszenie wraca do `pending` When ktoś rozpoczyna nowy wpis Then dyżurnego na dziś nie ma (AC-15 — ponowny wybór); wpisy już zapisane bez zmian.

### US-5: Jako Obsługa chcę wybrać Prowadzącego przy każdym wpisie
- **AC-18**: Given wpis (osoba z kontem, osoba bez konta, osoba towarzysząca) When dochodzę do kroku podpisu Then nad danymi wpisu widzę „Prowadzący: <dyżurny>” z przyciskiem „Zmień”, domyślnie ustawionego dyżurnego; po „Zmień” lista wyboru ma kolejność: (1) osoba wpisywana — jeśli ma zatwierdzone, aktywne uprawnienia prowadzącego, także ukryta — z dopiskiem „(osoba wpisywana)”; (2) aktywni prowadzący dodani przez admina oraz zatwierdzeni użytkownicy bez „Ukryj mnie dla innych”, alfabetycznie po imieniu i nazwisku; ukrytych użytkowników (poza osobą wpisywaną) na liście nie ma.
- **AC-19**: Given lista wyboru (AC-15 lub AC-18) When wpisuję w „Szukaj prowadzącego” min. 3 znaki imienia lub nazwiska Then widzę maks. 10 pasujących zatwierdzonych, aktywnych prowadzących, także ukrytych; bez wyników — „Nie znaleziono prowadzącego.”. Wyniki zawierają tylko identyfikator i imię i nazwisko.
- **AC-20**: Given wybrałem innego Prowadzącego niż dyżurny When zapisuję wpis Then wpis ma wybranego Prowadzącego (kopia nazwiska, SPEC-005 AC-2); dyżurny się nie zmienia, a kolejny wpis znów domyślnie dostaje dyżurnego.
- **AC-21**: Given osoba wpisywana jest zatwierdzonym prowadzącym When jej wpis się zapisuje Then wybór Prowadzącego nie jest automatyczny — domyślnie nadal dyżurny; osoba wpisywana jest tylko pierwsza na liście (AC-18).

## 5. Model danych

Zmiany w `range_officers` (SPEC-005 §5):

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `range_officers` | `profile_id` | `uuid` FK → `profiles.id` on delete cascade, `unique` | nie | tak (powiązanie z kontem) | `null` = dodany przez admina |
| | `status` | `text` check in (`pending`, `approved`, `rejected`) | tak | nie | domyślnie `approved` (dotychczasowe i dodane przez admina); zgłoszenie z konta — `pending` |
| | `hide_from_others` | `boolean` | tak | nie | „Ukryj mnie dla innych”; domyślnie `false`, zgłoszenie z konta — `true`; `check (profile_id is not null or not hide_from_others)` |
| | `submitted_at` | `timestamptz` | nie | nie | ostatnie wysłanie do zatwierdzenia (AC-4, AC-11) |
| | `reviewed_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | kto zatwierdził / odrzucił |
| | `reviewed_at` | `timestamptz` | nie | nie | |

Dla zgłoszeń z kont `license_number` i `institution` są wymagane (`check (profile_id is null or license_number is not null)`),
`full_name` = kopia `profiles.full_name` synchronizowana wyzwalaczem (AC-14).

„Na liście” (dyżurny, wpis, wyszukiwarka) = `is_active and status = 'approved'`.

Nowa tabela:

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `range_duty` | `day` | `date` PK | tak | nie | dzień Europe/Warsaw (`range_today()`) |
| | `range_officer_id` | `uuid` FK → `range_officers.id` on delete cascade | tak | nie | |
| | `set_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | kto ustawił |
| | `set_at` | `timestamptz` | tak | nie | |

Stany zgłoszenia z konta:
`(brak) → pending` (AC-4), `pending → approved | rejected` (AC-8, AC-9), `approved | rejected → pending` (AC-11, zmiana nr legitymacji / instytucji),
`* → is_active = false` (AC-13 „Usuń” albo admin „Ukryj”), `is_active = false → pending, is_active = true` (ponowne dodanie przez użytkownika; admin „Przywróć” — bez zmiany statusu).

### RLS i funkcje
- `range_officers`: `select` — `is_staff()` (bez zmian); `insert`/`update` bezpośrednio — `is_admin()` tylko dla `profile_id is null`
  (polityka) oraz `is_active` dla wszystkich (AC-10). Użytkownik **nie** ma uprawnień do tabeli — tylko funkcje:
  - `my_range_officer()` — własne zgłoszenie (status, nr legitymacji, instytucja, `hide_from_others`, `is_active`) albo brak.
  - `save_my_range_officer(license_number, institution, institution_other, hide_from_others)` — `security definer`; tworzy
    / przywraca / edytuje; `pending` przy nowym, przywróconym lub zmianie nr legitymacji / instytucji (`submitted_at = now()`).
    Błędy: `full_name_required`, walidacja jak `check` (`range_officers_license_pair`, `range_officers_institution_other`).
  - `set_my_range_officer_hidden(hidden)` — tylko `hide_from_others` (AC-12).
  - `remove_my_range_officer()` — `is_active = false` (AC-13).
- `review_range_officer(id, decision)` — `security definer`, `is_staff()`; tylko `pending` z `profile_id`; `decision` in
  (`approved`, `rejected`); `audit_log` `range_officer_review`. Błędy: `forbidden`, `not_pending`, `invalid_decision`.
- `range_officer_choices(person_id?)` — `is_staff()`; lista z AC-18 (osoba wpisywana pierwsza z `is_person = true`, potem widoczni).
- `staff_search_range_officers(query)` — `is_staff()`; AC-19 (od 3 znaków, maks. 10, `ilike` ze znakami wzorca dosłownie).
- `range_duty`: `select` — `is_staff()`; zapis tylko przez `set_range_duty(officer_id)` (`is_staff()`, upsert dla `range_today()`,
  prowadzący „na liście”, inaczej `range_officer_inactive`) i `current_range_duty()` — dzisiejszy dyżurny, o ile nadal „na liście”, inaczej brak (AC-17).
- `create_range_log_entry` — warunek prowadzącego zmienia się z „aktywny” na „na liście” (`range_officer_inactive`).
- Nocne zadanie (ADR-0006): `purge_range_duty()` usuwa wiersze `range_duty` sprzed dzisiaj (wpisy mają kopię nazwiska).

## 6. Interfejs użytkownika

| Adres | Zawartość |
| --- | --- |
| `/konto/` — „Twoje dane” | „Dodaj uprawnienia prowadzącego” albo status („czekają na zatwierdzenie” / „zatwierdzone” / „odrzucone…”), nr legitymacji, instytucja, przełącznik „Ukryj mnie dla innych”, „Edytuj”, „Usuń” |
| `/konto/dane/` lub okno `<dialog>` w `/konto/` | Formularz AC-2 (implementator wybiera wariant spójny z „Edytuj dane”) |
| `/panel/prowadzacy/` | + „Do zatwierdzenia (n)” (Obsługa i admin), oznaczenia „Z konta”, „Ukryty dla innych”; Obsługa — odczyt |
| `/panel/ksiazka/` | „Dyżurny: …” + „Zmień” (zamiast prowadzącego zapamiętanego na urządzeniu); w kroku podpisu „Prowadzący: …” + „Zmień” z listą i wyszukiwarką |
| Menu panelu | „Prowadzący (n)” widoczne także dla Obsługi |

Komunikaty: „Wyślij do zatwierdzenia”, „Zapisano. Uprawnienia czekają na zatwierdzenie.”, „Zatwierdzono.”, „Odrzucono.”,
„Nie udało się zapisać. Spróbuj ponownie.”, „Ten prowadzący nie jest już dostępny — wybierz innego.” (`range_officer_inactive`).
Teksty w plikach i18n.

## 7. Przypadki brzegowe

- Dwie osoby z Obsługi ustawiają dyżurnego jednocześnie → wygrywa ostatni zapis (upsert); urządzenie pobiera dyżurnego przy rozpoczęciu każdego wpisu.
- Prowadzący wybrany przy wpisie zostaje w międzyczasie ukryty / wraca do `pending` → zapis wpisu odrzucony (`range_officer_inactive`), podpis zostaje na ekranie, trzeba wybrać innego.
- Dyżurny ustawiony przed północą → po północy (Europe/Warsaw) nie obowiązuje; trzeba wybrać ponownie.
- Ten sam człowiek jest na liście admina i ma zgłoszenie z konta → dwa wiersze; admin może ukryć wiersz dodany ręcznie.
- Usunięcie konta (SPEC-002 AC-24) → zgłoszenie znika (kaskada), `range_log.range_officer_id = null`, nazwisko we wpisach zostaje (kopia); dyżur z tym prowadzącym znika.
- Użytkownik zgłasza się, będąc Obsługą lub adminem → może zatwierdzić własne zgłoszenie (założenie: brak wyjątku od reguły „zatwierdza admin lub Obsługa”) — zapis w `audit_log`.
- Ukryty Prowadzący poprowadził strzelanie innej osobie → jego nazwisko jest w tym wpisie książki i w „Historii wejść” tej osoby (kolumna książki wymagana prawem); „Ukryj” dotyczy tylko list wyboru.

## 8. Integracje

Brak (bez e-maili, Storage i Tpay). Nocne zadanie — istniejący `pg_cron` (ADR-0006).

## 9. RODO

- Nowe dane: powiązanie prowadzącego z kontem, nr legitymacji i instytucja podane przez użytkownika, wybór „Ukryj mnie dla innych”.
- Cel: wskazanie prowadzącego strzelanie w książce rejestru pobytu.
- Dostęp: użytkownik — własne zgłoszenie przez funkcje; Obsługa i admin — wszystkie (zatwierdzanie, wybór); wyszukiwarka zwraca tylko imię i nazwisko.
- „Ukryj mnie dla innych” domyślnie włączone (minimum widoczności); zmiana wymaga działania użytkownika.
- Przechowywanie: do usunięcia konta (kaskada); „Usuń” wyłącza z list, ale wiersz zostaje, bo `range_log.range_officer_id` służy filtrowaniu książki (SPEC-005 AC-26). `range_duty` — tylko dzień bieżący.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Weryfikacja zgłoszeń z kont | Zatwierdza admin lub Obsługa w panelu; przed zatwierdzeniem nie ma go na listach ani w wyszukiwarce | 2026-11-19 (#112) |
| Widoczność | „Ukryj mnie dla innych” domyślnie włączone, zmiana w „Twoje dane” bez zatwierdzenia; ukryty tylko w wyszukiwarce, przy własnym wpisie pierwszy | 2026-11-19 (#112) |
| Dyżurny | Jeden dla strzelnicy, w bazie, do końca dnia Europe/Warsaw; ukrytego można wyszukać i wybrać | 2026-11-19 (#112) |
| Edycja i usunięcie | Zmiana nr legitymacji / instytucji → ponowne zatwierdzenie; „Usuń” ukrywa, dawne wpisy bez zmian | 2026-11-19 (#112) |

Założenia analityka (zatwierdzane razem ze specyfikacją): odrzucenie bez uzasadnienia (użytkownik może poprawić i wysłać ponownie);
Obsługa zatwierdza, ale nie edytuje listy admina; imię i nazwisko zgłoszenia synchronizowane z profilem bez ponownego zatwierdzenia;
dyżurny tylko na dziś (bez grafiku); osoba wpisywana nie jest wybierana automatycznie — tylko pierwsza na liście;
usunięcie konta usuwa zgłoszenie; Obsługa lub admin może zatwierdzić własne zgłoszenie.

Otwarte: brak.

## 11. Zadania

1. #113 Schemat: kolumny `range_officers`, funkcje użytkownika i `review_range_officer`, synchronizacja nazwiska, warunek „na liście” w `create_range_log_entry`, pgTAP (AC-4…AC-6, AC-8, AC-9, AC-11…AC-14 po stronie bazy).
2. #114 `/konto/` — „Twoje dane”: zgłoszenie, status, edycja, „Ukryj mnie dla innych”, usunięcie (AC-1…AC-4, AC-11…AC-13).
3. #115 `/panel/prowadzacy/` — zatwierdzanie przez Obsługę i admina, licznik w menu, oznaczenia (AC-7…AC-10).
4. #116 Dyżurny Prowadzący: `range_duty`, funkcje, `staff_search_range_officers` (AC-19), nocne czyszczenie, UI w `/panel/ksiazka/` zamiast `localStorage` (AC-15…AC-17).
5. #117 Wybór Prowadzącego przy wpisie: `range_officer_choices`, UI w kroku podpisu (AC-18…AC-21).
