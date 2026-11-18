# SPEC-004: Faktury — dane z NIP i lista do wystawienia w e-mikrofirmie

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #38 (etap 3 z 4; wymaga SPEC-003)
- Zadania: #54, #55, #56, #57 (kolejność w sekcji 11); dla właściciela: #41 (klucz GUS, opcjonalnie) (`owner-task`)
- Decyzje: ADR-0005 (faktury w e-mikrofirmie)

## 1. Cel

Klient firmowy zaznacza „Potrzebuję faktury” i podaje NIP; aplikacja pobiera dane firmy z publicznego rejestru,
zapisuje je przy zamówieniu i w profilu. Faktury wystawia admin w **e-mikrofirmie** (aplikacja Ministerstwa Finansów,
zintegrowana z KSeF — decyzja 4-A). e-mikrofirma nie ma API dla innych aplikacji (ADR-0005), więc aplikacja przygotowuje
kompletną listę „Do wystawienia” z danymi do skopiowania, a admin zapisuje numer wystawionej faktury i numer KSeF.

## 2. Zakres

**W zakresie:**
- Checkbox „Potrzebuję faktury” przy zakupie online i przy sprzedaży na miejscu.
- Walidacja NIP (suma kontrolna), pobranie danych firmy: Biała lista MF, a gdy brak — GUS REGON (BIR), jeśli skonfigurowano klucz.
- Ręczne wpisanie danych, gdy firmy nie ma w rejestrach lub rejestr nie odpowiada — oznaczenie „Dane niezweryfikowane” (decyzja 5-A).
- Zapamiętanie danych do faktury w profilu (`billing_details`) i podpowiedź przy kolejnym zakupie; edycja w `/konto/dane/`.
- Panel admina `/panel/faktury/`: lista do wystawienia, dane do skopiowania, oznaczenie jako wystawionej (nr faktury, nr KSeF), eksport CSV.
- Dodanie danych do faktury do opłaconego zamówienia przez admina (prośba klienta po zakupie).

**Poza zakresem:**
- Automatyczne wystawianie faktur i wysyłka do KSeF z aplikacji (ADR-0005 — możliwy kolejny etap przez API KSeF).
- Numeracja, stawki VAT, korekty faktur, przechowywanie plików faktur — prowadzi e-mikrofirma.
- Wysyłanie faktury klientowi e-mailem z aplikacji (11-A); faktura trafia do nabywcy przez KSeF / od strzelnicy.
- Paragony fiskalne, faktury dla osób prywatnych bez NIP.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Użytkownik | Własne `billing_details`, dane faktury i status faktury przy swoich zamówieniach | Własne `billing_details`; dane faktury przy tworzeniu zamówienia |
| Obsługa | Dane faktury przy sprzedaży, którą rejestruje | Dane faktury przy zamówieniu „na miejscu” |
| Admin | Wszystkie dane faktur, listę do wystawienia | Oznaczenie wystawienia, dodanie/poprawa danych faktury przy zamówieniu przed wystawieniem |

## 4. Historyjki i kryteria akceptacji

### US-1: Jako klient firmowy chcę zamówić fakturę na NIP
- **AC-1**: Given podsumowanie zamówienia (SPEC-003 AC-7) When zaznaczam „Potrzebuję faktury” Then widzę pole „NIP” i przycisk „Pobierz dane firmy”; jeśli mam zapisane `billing_details`, NIP wypełnia się sam i dane firmy pobierają się automatycznie z rejestru (jak AC-3, bez klikania); gdy rejestr nie zwróci danych, używane są zapisane `billing_details`. W obu przypadkach dane są od razu gotowe (AC-6 spełnione), a „Zmień dane do faktury” pozwala wpisać inny NIP.
- **AC-2**: Given wpisuję NIP (cyfry, dopuszczalne myślniki/spacje, opcjonalny prefiks `PL`) When suma kontrolna jest błędna Then widzę „Nieprawidłowy NIP.” i rejestr nie jest odpytywany.
- **AC-3**: Given poprawny NIP When klikam „Pobierz dane firmy” Then Edge Function `company-lookup` zwraca nazwę i adres siedziby z Białej listy MF (a gdy brak — z GUS BIR, jeśli jest klucz) i dane są od razu przyjęte bez ręcznego potwierdzenia: widzę „Nazwa”, „Adres”, źródło („Biała lista VAT” / „REGON”) i przycisk „Zmień dane do faktury”. Przycisk „Dane są poprawne” dotyczy tylko danych wpisanych ręcznie (AC-4).
- **AC-4**: Given firmy nie ma w rejestrach albo rejestr nie odpowiada (limit 5 s) When wynik wraca Then widzę „Nie znaleźliśmy firmy w rejestrze. Wpisz dane ręcznie.” i pola Nazwa* (2–250 znaków), Adres* (5–300 znaków); zamówienie dostaje źródło `manual` („Dane niezweryfikowane” u admina).
- **AC-5**: Given dane do faktury są gotowe (z rejestru — AC-1, AC-3 — albo potwierdzone ręcznie — AC-4) When klikam „Zapłać” Then zamówienie zapisuje kopię: NIP, nazwę, adres, źródło, datę pobrania; dane zapisują się też w `billing_details` (nadpisując poprzednie).
- **AC-6**: Given zaznaczony checkbox faktury When dane nie są gotowe (trwa pobieranie z rejestru, NIP bez pobranych danych albo niepotwierdzony wpis ręczny) Then „Zapłać” jest nieaktywny z podpowiedzią „Potwierdź dane do faktury.”.
- **AC-7**: Given `/konto/` When zamówienie ma fakturę Then w „Historia płatności” widzę „Faktura: w przygotowaniu” albo „Faktura: <numer>” (bez pliku — e-mikrofirma/KSeF).
- **AC-8**: Given `/konto/dane/` When edytuję sekcję „Dane do faktury” Then mogę zmienić lub usunąć zapisane dane (te same kroki NIP → rejestr / ręcznie); nie wpływa to na złożone zamówienia.

### US-2: Jako obsługa chcę dodać fakturę do sprzedaży na miejscu
- **AC-9**: Given `/panel/sprzedaz/` (SPEC-003 AC-21) When zaznaczam „Potrzebuję faktury” Then przechodzę te same kroki (AC-2…AC-4); dla osoby z kontem podpowiadają się jej `billing_details`; dla osoby bez konta dane firmy zapisują się tylko w zamówieniu (dane firmy, nie osoby).

### US-3: Jako admin chcę wystawić faktury w e-mikrofirmie
- **AC-10**: Given `/panel/faktury/` When otwieram „Do wystawienia” Then widzę opłacone zamówienia z żądaniem faktury bez numeru faktury, od najstarszej płatności: data zapłaty, NIP, nazwa, kwota, oznaczenie „Dane niezweryfikowane” (gdy `manual`).
- **AC-11**: Given pozycja na liście When ją rozwijam Then widzę dane potrzebne do faktury w e-mikrofirmie, każde z przyciskiem „Kopiuj”: NIP, nazwa nabywcy, adres, nazwa pozycji (`item_name`), kwota brutto (`120,00`), data sprzedaży (= data zapłaty, Europe/Warsaw), sposób zapłaty („przelew/płatność online — Tpay” / „gotówka” / „karta — terminal”), numer zamówienia (`order_number`, SPEC-006).
- **AC-12**: Given wystawiłem fakturę w e-mikrofirmie When wpisuję „Numer faktury”* (1–50 znaków) i opcjonalnie „Numer KSeF” (wzorzec numeru KSeF, do 50 znaków) i klikam „Oznacz jako wystawioną” Then pozycja przechodzi do zakładki „Wystawione” (z datą i kto oznaczył), a klient widzi numer (AC-7); `audit_log`: `invoice_issued`.
- **AC-13**: Given pozycja oznaczona omyłkowo When klikam „Cofnij oznaczenie” Then wraca do „Do wystawienia”; `audit_log`: `invoice_unmarked`.
- **AC-14**: Given opłacone zamówienie bez faktury When klient poprosi o fakturę później i admin w szczegółach zamówienia klika „Dodaj dane do faktury” Then przechodzi kroki AC-2…AC-5 (bez nadpisywania `billing_details` klienta) i zamówienie trafia na listę „Do wystawienia”.
- **AC-15**: Given zakładka „Wystawione” lub „Do wystawienia” When klikam „Eksport CSV” (zakres dat zapłaty) Then pobieram plik z kolumnami z AC-11 + numer faktury, numer KSeF (UTF-8 z BOM, separator `;` — otwiera się w Excelu).
- **AC-16**: Given zamówienie z fakturą zostało zwrócone (SPEC-003 AC-25) When patrzę na pozycję Then widzę „Zwrot — sprawdź, czy potrzebna jest korekta w e-mikrofirmie.”; zwrócone niewystawione znikają z „Do wystawienia”.

## 5. Model danych

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `billing_details` | `user_id` | `uuid` PK, FK → `profiles.id` on delete cascade | tak | tak | jedne dane na konto |
| | `nip` | `text` | tak | tak (JDG = osoba) | 10 cyfr, suma kontrolna (`check` + funkcja `is_valid_nip`) |
| | `company_name` | `text` | tak | tak | 2–250 znaków |
| | `company_address` | `text` | tak | tak | 5–300 znaków |
| | `data_source` | `text` check in (`vat_whitelist`, `regon`, `manual`) | tak | nie | |
| | `fetched_at` | `timestamptz` | nie | nie | data pobrania z rejestru |
| | `updated_at` | `timestamptz` | tak | nie | |
| `orders` (zmiana) | `invoice_requested` | `boolean` | tak | nie | domyślnie `false` |
| | `invoice_nip`, `invoice_company_name`, `invoice_company_address` | `text` | gdy `invoice_requested` | tak | kopia z chwili zamówienia |
| | `invoice_data_source` | `text` | gdy `invoice_requested` | nie | jak wyżej |
| | `invoice_number` | `text` | nie | nie | numer z e-mikrofirmy |
| | `ksef_number` | `text` | nie | nie | numer KSeF |
| | `invoice_issued_at` | `timestamptz` | nie | nie | kiedy oznaczono |
| | `invoice_issued_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | |

Stany faktury (pochodne kolumn): brak → `requested` (`invoice_requested` i brak numeru) → `issued` (numer niepusty); `issued → requested` (cofnięcie).
Dane faktury można zmienić tylko przed oznaczeniem jako wystawionej.

RLS: `billing_details` — `select/insert/update/delete` własnego wiersza; `select` dla `is_staff()`; zapis innych — `is_admin()`.
Kolumny faktury w `orders` ustawiają tylko funkcje `security definer` (`set_order_invoice_details`, `mark_invoice_issued`, `unmark_invoice`) i `payments-create`.

## 6. Interfejs użytkownika

| Adres | Zmiana |
| --- | --- |
| `/oferta/zamowienie/` | Sekcja „Faktura” (AC-1…AC-6) |
| `/konto/` | Status faktury w historii płatności (AC-7) |
| `/konto/dane/` | Sekcja „Dane do faktury” (AC-8) |
| `/panel/sprzedaz/` | Checkbox „Potrzebuję faktury” (AC-9) |
| `/panel/faktury/` | Zakładki „Do wystawienia” / „Wystawione”, rozwijane pozycje, „Kopiuj”, eksport (AC-10…AC-16) |
| `/panel/zamowienia/` | „Dodaj dane do faktury” w szczegółach (AC-14) |

Menu panelu admina: + „Faktury” z liczbą pozycji do wystawienia. Na telefonie przycisk „Kopiuj” ≥ 44 px, kopiowanie przez Clipboard API z komunikatem „Skopiowano”.

## 7. Przypadki brzegowe

- Firma wykreślona z rejestru VAT, ale jest w REGON → dane z REGON (źródło `regon`).
- Biała lista zwraca kilka podmiotów (rzadkie) → bierzemy pierwszy o statusie „Czynny”, inaczej pierwszy; użytkownik potwierdza.
- Limit zapytań Białej listy (dzienny) przekroczony → jak brak odpowiedzi (AC-4).
- NIP z prefiksem `PL` lub z myślnikami → normalizacja do 10 cyfr przed walidacją i zapisem.
- NIP zagraniczny (UE) → poza zakresem; komunikat „Faktury dla firm zagranicznych — skontaktuj się ze strzelnicą.” dla prefiksu innego niż `PL`.
- Użytkownik zmienia `billing_details` po zakupie → zamówienie ma swoją kopię, faktura bez zmian.
- Usunięcie konta → `billing_details` usuwane (kaskada); kopie w zamówieniach zostają 5 lat (SPEC-003 §9).

## 8. Integracje

- **Biała lista podatników VAT (MF)** — `GET https://wl-api.mf.gov.pl/api/search/nip/{nip}?date=YYYY-MM-DD`, bez klucza, limit dzienny zapytań.
  Pola: `name`, `workingAddress` lub `residenceAddress`, `statusVat`.
- **GUS REGON BIR1.1** (SOAP) — tylko jeśli ustawiony sekret `GUS_BIR_KEY` (klucz bezpłatny na wniosek do GUS — zadanie `owner-task`, opcjonalne). Bez klucza: krok pomijany.
- **Edge Function `company-lookup`** (POST `{ nip }`, wymaga zalogowania): walidacja, zapytania z limitem 5 s, odpowiedź `{ found, name, address, source }`; nie zapisuje niczego w bazie; nie loguje NIP-ów w treści błędów. Limit 20 zapytań na konto na godzinę.
- **e-mikrofirma** — bez integracji technicznej (ADR-0005); admin wystawia faktury ręcznie.

## 9. RODO

- NIP, nazwa i adres firmy jednoosobowej to dane osobowe przedsiębiorcy; cel — wystawienie faktury (obowiązek prawny).
- Dostęp: właściciel konta, obsługa (przy sprzedaży), admin. Publicznie — nic.
- `billing_details` do usunięcia przez użytkownika lub usunięcia konta; dane w zamówieniach — 5 lat od końca roku podatkowego (SPEC-003 §9).
- Do rejestrów publicznych wysyłamy wyłącznie NIP.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Jak wystawiać faktury w KSeF | 4-A: przez serwis używany przez firmę — e-mikrofirma (mf.gov.pl). Ponieważ e-mikrofirma nie ma API, aplikacja przygotowuje listę „Do wystawienia”, a admin wystawia ręcznie (ADR-0005) | 2026-11-17 |
| Firma spoza rejestru / rejestr nie odpowiada | 5-A: wpis ręczny z oznaczeniem „Dane niezweryfikowane” | 2026-11-17 |
| Faktura na NIP, dane z publicznego rejestru, zapis w zamówieniu i profilu | Z issue #38 | 2026-11-17 |

Założenia analityka (zatwierdzane razem ze specyfikacją): fakturę można dodać do zamówienia po zakupie tylko przez admina;
tylko NIP polski; GUS BIR opcjonalny (zależy od klucza).

Otwarte: brak.

## 11. Zadania

1. #54 Dane do faktury: `billing_details`, kolumny `orders`, funkcje i RLS, `is_valid_nip`, testy pgTAP.
2. #55 `company-lookup` (Biała lista + opcjonalnie BIR), testy Deno z zamockowanym `fetch`.
3. #56 Faktura przy zakupie i w profilu, sprzedaż na miejscu (AC-1…AC-9).
4. #57 Panel faktur: lista, kopiowanie, oznaczanie, eksport, dodanie po zakupie (AC-10…AC-16).
