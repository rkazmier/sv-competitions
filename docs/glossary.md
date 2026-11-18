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
| Zawodnik | `competitor` | Użytkownik zapisujący się na zawody (pojęcie przyszłej specyfikacji rejestracji; nie jest rolą konta) |
| Organizator | — | Dawna rola konta; od SPEC-002 = Admin (ADR-0004) |
| Opłata startowa | `entry_fee` | Kwota za start, w groszach (integer), waluta PLN |
| Płatność | `payment` | Transakcja Tpay lub wpłata oznaczona ręcznie |
| Wynik | `result` | Rezultat zawodnika w zawodach |
| Ranking | `ranking` | Klasyfikacja sezonowa dyscypliny wg zasad punktacji |
| Sezon | `season` | Okres, za który liczony jest ranking |

## Konta i role (SPEC-002)

| PL (UI) | EN (kod) | Definicja |
| --- | --- | --- |
| Użytkownik | `user` | Rola konta klienta strzelnicy: kupuje w Ofercie, uzupełnia dane, pokazuje kod QR |
| Obsługa strzelnicy | `staff` | Rola konta: skanuje kod QR, robi wpisy do książki, rejestruje sprzedaż na miejscu |
| Admin | `admin` | Rola konta: wszystko co obsługa + kalendarz, produkty i ceny, prowadzący, konta i role, przegląd książki |
| Panel użytkownika / Moje konto | `account` (`/konto/`) | Strona konta klienta: dane, kod QR, karnety, płatności, wejścia |
| Kod QR | `qr_token` | Losowy token konta zakodowany w QR; bez danych osobowych; można wygenerować nowy |
| Numer decyzji | `permit_number` | Numer decyzji (pozwolenia na broń) |
| Organ wydający | `permit_authority` | Organ, który wydał decyzję |
| Adres zamieszkania | `address` | Jedno pole tekstowe; alternatywa dla numeru decyzji przy wpisie do książki |
| Gotowy do wpisu do książki | `is_range_ready` | Ma imię i nazwisko oraz (numer decyzji + organ albo adres) |
| Dziennik zmian | `audit_log` | Zapis zmian danych użytkownika przez inne osoby, ról, usunięć kont, zwrotów, faktur, eksportów książki |

## Oferta (SPEC-003)

| PL (UI) | EN (kod) | Definicja |
| --- | --- | --- |
| Oferta | `offer` (`/oferta/`) | Sklep strzelnicy: karnety, wejścia, wejściówki |
| Produkt | `product` | Pozycja Oferty z ceną ustawianą przez admina |
| Karnet ilościowy | `entries` | Produkt na N wejść; każde wejście zmniejsza licznik o 1 |
| Karnet czasowy | `days` | Produkt na N kolejnych dni kalendarzowych liczonych od pierwszego wejścia |
| Wejście jednorazowe | `single_entry` | Jedno wejście w wariancie weekend (sob.–niedz.) lub dzień powszedni (pn–pt) |
| Wejściówka | `event_ticket` | Uprawnienie wejścia na płatne wydarzenie Steel Valley w dniach wydarzenia |
| Tryb wydarzenia | `access_mode` | `external` (zewnętrzne), `free` (otwarte, bezpłatne), `paid` (płatne przez Ofertę) |
| Zamówienie | `order` | Zakup jednego produktu lub wejściówki; płatność Tpay albo na miejscu |
| Numer zamówienia | `order_number` | Czytelny numer zamówienia `SV-RRRR-NNNNNN` (rok utworzenia, licznik ciągły; SPEC-006); nie jest numerem faktury |
| Sprzedaż na miejscu | `on_site` | Zamówienie opłacone gotówką lub terminalem, rejestrowane przez obsługę |
| Uprawnienie (karnet w koncie) | `user_pass` | To, co powstaje z opłaconego zamówienia; ważne 1 rok od zakupu |
| Zużycie | `pass_usage` | Wykorzystanie uprawnienia przy wpisie do książki (historia karnetu) |
| Zwrot | `refund` | Anulowanie niewykorzystanego uprawnienia i zwrot pieniędzy |

## Faktury (SPEC-004)

| PL (UI) | EN (kod) | Definicja |
| --- | --- | --- |
| Dane do faktury | `billing_details` | NIP, nazwa i adres firmy zapisane w profilu |
| Faktura | `invoice` | Wystawiana przez admina w e-mikrofirmie (KSeF); w aplikacji numer faktury i numer KSeF |
| Do wystawienia | `invoice requested` | Opłacone zamówienie z żądaniem faktury bez numeru faktury |
| Dane niezweryfikowane | `manual` | Dane firmy wpisane ręcznie, bez potwierdzenia w rejestrze |

## Książka rejestru pobytu (SPEC-005)

| PL (UI) | EN (kod) | Definicja |
| --- | --- | --- |
| Książka rejestru pobytu na strzelnicy | `range_log` | Elektroniczna książka wejść; wpisy niezmienne, przechowywane 1 rok |
| Wpis do książki | `range_log entry` | Data i godzina, imię i nazwisko, numer decyzji z organem lub adres, prowadzący, podpis |
| Prowadzący strzelanie | `range_officer` | Osoba z listy admina (imię i nazwisko, nr legitymacji, instytucja), przypisywana do wpisów na zmianę |
| Nr legitymacji | `license_number` | Numer legitymacji prowadzącego strzelanie |
| Instytucja | `institution` | Wydawca legitymacji prowadzącego: PZSS, LOK, PZŁ, Inne (z nazwą wpisaną ręcznie — `institution_other`) |
| Osoba towarzysząca | `companion` | Osoba wpisywana do książki bez zużycia uprawnienia |
| Podpis | `signature` | Obraz podpisu odręcznego złożonego palcem na ekranie, w prywatnym buckecie |
| Adnotacja | `range_log_annotation` | Korekta wpisu: kto, kiedy, treść; wpis pozostaje bez zmian |
| Retencja | `retention` | Automatyczne usuwanie wpisów i podpisów starszych niż okres przechowywania |
