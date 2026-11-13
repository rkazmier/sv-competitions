# Słownik pojęć

Nazwy w kodzie (EN) i w interfejsie (PL). Analityk uzupełnia słownik przy każdej specyfikacji.

| PL (UI) | EN (kod) | Definicja |
| --- | --- | --- |
| Kalendarz strzelnicy | `calendar` | Publiczna lista nadchodzących wpisów: zawodów i wydarzeń |
| Wpis w kalendarzu | `calendar_entry` | Zawody albo wydarzenie (`kind`: `competition` / `event`) |
| Wydarzenie | `calendar_event` | Wpis o czymś, co odbywa się na strzelnicy: nazwa, termin, opis, kategoria, link zewnętrzny ze szczegółami |
| Kategoria wydarzenia | `event_category` | Rodzaj wydarzenia z listy prowadzonej w panelu |
| Link do szczegółów | `external_url` | Adres strony organizatora wydarzenia (spoza aplikacji) |
| Zawody | `competition` | Wpis w kalendarzu organizowany przez Steel Valley: termin (data początku, opcjonalnie końca), dyscyplina, regulamin, matchbook, harmonogram; później także zapisy, opłata i wyniki |
| Szkic | `draft` | Stan zawodów lub wydarzenia widocznego tylko dla organizatora |
| Opublikowane | `published` | Stan zawodów lub wydarzenia widocznego publicznie |
| Regulamin | `rulebook` | Dokument PDF w bibliotece regulaminów; wybierany przy zawodach, wymagany do publikacji |
| Biblioteka regulaminów | `rulebooks` | Lista wcześniej wczytanych regulaminów |
| Matchbook | `matchbook` | Opcjonalny PDF zawodów z opisem torów/konkurencji |
| Harmonogram | `schedule` | Lista punktów zawodów |
| Punkt harmonogramu | `schedule_item` | Dzień, opcjonalna godzina i opis (np. „08:00 — rejestracja”) |
| Przebudowa strony | `site rebuild` | Ponowne wygenerowanie stron publicznych po zmianie danych |
| Dyscyplina | `discipline` | Rodzaj konkurencji z listy prowadzonej w panelu; wybrane dyscypliny mają ranking |
| Zgłoszenie | `registration` | Zapis zawodnika na konkretne zawody |
| Lista rezerwowa | `waitlist` | Zgłoszenia ponad limit miejsc, w kolejności zapisu |
| Zawodnik | `competitor` | Osoba z kontem, która się zapisuje |
| Organizator | `organizer` | Osoba zarządzająca zawodami w panelu |
| Opłata startowa | `entry_fee` | Kwota za start, w groszach (integer), waluta PLN |
| Płatność | `payment` | Transakcja Tpay lub wpłata oznaczona ręcznie |
| Wynik | `result` | Rezultat zawodnika w zawodach |
| Ranking | `ranking` | Klasyfikacja sezonowa dyscypliny wg zasad punktacji |
| Sezon | `season` | Okres, za który liczony jest ranking |
