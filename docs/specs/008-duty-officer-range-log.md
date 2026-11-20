# SPEC-008: Dyżurny Prowadzący prowadzi książkę rejestru pobytu

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #128 (rozszerza SPEC-005 i SPEC-007)
- Decyzje: ADR-0007 (dostęp do książki wynikający z dyżuru, nie z roli)
- Zadania: #129, #130 (kolejność w sekcji 11)

## 1. Cel

Dyżurny Prowadzący z konta (SPEC-007) sam prowadzi wpisy w książce rejestru pobytu w dniu swojego dyżuru — bez nadawania mu
roli Obsługi. Nie może zmienić dyżurnego ani grafiku: dyżurnego ustala Obsługa / admin (grafik, zawody, wydarzenia, „Zmień”
w książce).

## 2. Zakres

**W zakresie:**
- Dostęp użytkownika (rola `user`) do `/panel/ksiazka/`, gdy **teraz** jest dyżurnym Prowadzącym (`range_duty_for(range_today())`).
- Wpisy jak Obsługa: osoba z kontem (QR, wyszukiwarka), uzupełnienie brakujących danych osoby, wybór uprawnienia, podpis,
  osoba towarzysząca; wybór innego Prowadzącego przy wpisie (SPEC-007 AC-18…AC-21).
- Lista dzisiejszych wpisów (bez podpisów) i adnotacje do dzisiejszych wpisów (SPEC-005 AC-21, AC-22).
- Sprawdzanie uprawnień w bazie (RLS, funkcje `security definer`), nie tylko w UI.
- Wejście do książki z `/konto/` („Twoje dane”).

**Poza zakresem:**
- Zmiana dyżurnego: „Zmień” przy „Prowadzący strzelanie: …”, ekran „Kto prowadzi dziś strzelanie?”, grafik `/panel/dyzury/`, dyżurny zawodów i wydarzeń.
- Sprzedaż na miejscu (`/panel/sprzedaz/`, „Sprzedaj na miejscu” w książce), zamówienia, zwroty, anulowanie.
- Zatwierdzanie zgłoszeń prowadzących (`/panel/prowadzacy/`), przegląd całej książki i eksport (`/panel/ksiazka/przeglad/` — admin).
- Cofanie zużycia karnetu (SPEC-005 AC-23 — admin).
- Dostęp prowadzącego dodanego przez admina (bez konta) i dostęp w innym dniu niż dzień dyżuru.
- Link do książki w nagłówku strony (claim `app_role` w JWT się nie zmienia — wejście przez `/konto/` lub `/panel/ksiazka/`). **Zmienione przez SPEC-009 (#134):** link „Książka” w nagłówku dla dyżurnego.

## 3. Role i uprawnienia

„Dyżurny z konta” = zalogowany użytkownik, którego zgłoszenie prowadzącego (`range_officers.profile_id = auth.uid()`) jest
„na liście” (`is_active and status = 'approved'`) i jest dziś dyżurnym (`range_duty_for(range_today())`). Status sprawdzany
przy każdym wywołaniu — nie ma osobnej roli ani zapisu uprawnienia.

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Dyżurny z konta (rola `user`) | `/panel/ksiazka/`: „Dyżurny: <on sam>” (bez „Zmień”), dzisiejsze wpisy (bez podpisów) z adnotacjami; przy wpisie — dane i ważne dziś uprawnienia obsługiwanej osoby (jak Obsługa, przez funkcje); lista Prowadzących do wyboru i wyszukiwarka (SPEC-007 AC-18, AC-19) | Tworzy wpisy (osoba z kontem z ważnym uprawnieniem, osoba towarzysząca z kontem lub bez), uzupełnia brakujące dane osoby (z `audit_log`), wybiera Prowadzącego wpisu, dodaje adnotacje do dzisiejszych wpisów |
| Obsługa, admin | Bez zmian (SPEC-005, SPEC-007) | Bez zmian; nadal jedyni, którzy ustawiają dyżurnego i sprzedają na miejscu |

Dyżurny z konta **nie** dostaje odczytu tabel `profiles`, `range_officers`, `range_duty`, `orders`, `user_passes`, `pass_usages` —
tylko funkcje zwracające minimum danych (jak dla Obsługi) oraz dzisiejsze wiersze `range_log` / `range_log_annotations`.
Użytkownik z rolą `staff` / `admin` będący dyżurnym korzysta z uprawnień swojej roli (bez ograniczeń z tej specyfikacji).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako dyżurny Prowadzący chcę wejść do książki
- **AC-1**: Given jestem zalogowany, moje zgłoszenie prowadzącego jest „na liście” i dziś jestem dyżurnym (dowolne źródło: zmiana w książce, zawody / wydarzenie, grafik) When otwieram `/konto/` Then w „Twoje dane” przy uprawnieniach prowadzącego widzę „Dziś jesteś dyżurnym Prowadzącym.” i przycisk „Otwórz książkę rejestru pobytu” (→ `/panel/ksiazka/`).
- **AC-2**: Given warunki AC-1 When otwieram `/panel/ksiazka/` Then widzę książkę; menu panelu zawiera tylko „Książka”; na górze „Dyżurny: <moje imię i nazwisko>” z dopiskiem źródła jak w SPEC-007 AC-16, **bez** przycisku „Zmień”.
- **AC-3**: Given nie jestem dziś dyżurnym (inny dyżurny, brak dyżurnego, zgłoszenie `pending` / `rejected` / usunięte / ukryte przez admina) When otwieram `/panel/ksiazka/` lub inną stronę panelu Then widzę „Nie masz uprawnień do panelu.” (stan `forbidden` jak dziś) — na `/panel/ksiazka/` z dopiskiem „Książkę może prowadzić dyżurny Prowadzący w dniu dyżuru albo Obsługa strzelnicy.”; nigdy nie widzę ekranu „Kto prowadzi dziś strzelanie?”. W `/konto/` nie ma AC-1.
- **AC-4**: Given dyżurny z konta When otwiera `/panel/dyzury/`, `/panel/prowadzacy/`, `/panel/sprzedaz/` albo `/panel/ksiazka/przeglad/` Then widzi „Nie masz uprawnień do panelu.”, a funkcje bazy `set_range_duty`, `set_scheduled_range_duty`, `clear_scheduled_range_duty`, `range_duty_schedule`, `review_range_officer`, `create_on_site_order`, `staff_on_site_sales_today`, `admin_range_log` odrzucają go (`forbidden`).

### US-2: Jako dyżurny Prowadzący chcę wpisywać osoby do książki
- **AC-5**: Given dyżurny z konta w `/panel/ksiazka/` When wpisuje osobę z kontem (skan QR, wyszukiwarka — SPEC-005 AC-5, AC-6, AC-9) Then przebieg i komunikaty są takie jak dla Obsługi.
- **AC-6**: Given osoba ma braki w danych When dyżurny klika „Uzupełnij dane” (SPEC-005 AC-7) Then uzupełnia brakujące pola; zmiana zapisuje się w profilu i w `audit_log` (kto zmienił = dyżurny).
- **AC-7**: Given osoba ma uprawnienia ważne dziś When dyżurny przechodzi do wyboru Then lista, kolejność i opisy skutku jak SPEC-005 AC-10, AC-11.
- **AC-8**: Given osoba (z kontem albo bez konta) nie ma uprawnienia ważnego dziś When dyżurny przechodzi do wyboru Then widzi „Brak ważnego karnetu lub wejścia na dziś. Sprzedaż na miejscu prowadzi Obsługa.” i tylko przycisk „Wpisz jako osobę towarzyszącą” — **bez** „Sprzedaj na miejscu” (zastępuje dla dyżurnego SPEC-005 AC-12 i AC-19).
- **AC-9**: Given krok podpisu When dyżurny widzi „Prowadzący: <dyżurny>” Then może użyć „Zmień” przy wpisie (lista i wyszukiwarka jak SPEC-007 AC-18, AC-19); zapisany wpis ma wybranego Prowadzącego, `created_by` = dyżurny, a dyżurny dnia się nie zmienia (SPEC-007 AC-20).
- **AC-10**: Given podpis When dyżurny klika „Zapisz wpis” Then plik podpisu trafia do bucketu `signatures`, a `create_range_log_entry` tworzy wpis i zużycie jak dla Obsługi (SPEC-005 AC-15…AC-17, AC-20).

### US-3: Jako dyżurny Prowadzący chcę widzieć dzisiejsze wpisy i je poprawiać
- **AC-11**: Given `/panel/ksiazka/` When dyżurny patrzy na listę dzisiejszych wpisów Then widzi wszystkie dzisiejsze wpisy (także zrobione przez Obsługę) z adnotacjami, bez podpisów — jak Obsługa.
- **AC-12**: Given dzisiejszy wpis When dyżurny dodaje adnotację (5–500 znaków) Then adnotacja zapisuje się (kto, kiedy, treść); adnotacji do wpisu z innego dnia baza nie przyjmuje (jak SPEC-005 AC-22).
- **AC-13**: Given dyżurny z konta When czyta przez API wpisy z innych dni, `range_officers`, `range_duty`, `profiles`, `orders`, `user_passes` lub `pass_usages` Then RLS nie zwraca żadnych wierszy (poza własnymi danymi użytkownika jak dotąd).

### US-4: Jako Obsługa chcę, żeby dostęp dyżurnego wynikał wyłącznie z dyżuru
- **AC-14**: Given dyżurny z konta ma otwartą książkę When Obsługa klika „Zmień” i ustawia innego dyżurnego (albo admin zmienia dyżurnego zawodów / wydarzenia, grafik, ukrywa prowadzącego, zgłoszenie wraca do `pending`) Then od tej chwili każde wywołanie bazy przez dawnego dyżurnego jest odrzucane (`forbidden`); w UI widzi „Nie jesteś już dyżurnym Prowadzącym — wpis nie został zapisany. Książkę prowadzi teraz Obsługa lub nowy dyżurny.” (podpis nie zostaje zapisany jako wpis; plik usuwa zadanie z SPEC-005 AC-31), a przycisk „Odśwież” prowadzi do stanu z AC-3.
- **AC-15**: Given dyżurny z konta When mija północ (Europe/Warsaw, zegar bazy) Then dostęp obowiązuje według dyżurnego nowego dnia (ten sam człowiek ma dostęp tylko, jeśli znów jest dyżurnym).
- **AC-16**: Given dyżurny z konta When wywołuje `set_range_duty` (np. spreparowanym żądaniem) Then baza odrzuca (`forbidden`) — nie może zmienić dyżurnego ani siebie potwierdzić na kolejne dni.

## 5. Model danych

Bez nowych tabel i kolumn. Zmieniają się funkcje i polityki RLS.

### Nowe funkcje
- `is_range_duty_officer()` → `boolean` — `security definer`, `stable`, `set search_path = ''`; `true`, gdy
  `range_duty_for(range_today())` zwraca prowadzącego z `profile_id = auth.uid()` (prowadzący „na liście” — sprawdza to już
  `range_duty_for`). `execute` dla `authenticated` (UI pyta o własny stan; zwraca tylko informację o wywołującym).
- `can_keep_range_log()` → `boolean` — `is_staff() or is_range_duty_officer()`; `security definer`, `stable`. Używana w RLS jako
  `(select public.can_keep_range_log())`.

### Zmiana warunku `is_staff()` → `can_keep_range_log()`
| Obiekt | Zmiana |
| --- | --- |
| `staff_find_by_qr`, `staff_search_people`, `staff_person_by_id`, `staff_person_entry_data`, `staff_complete_profile` | warunek dostępu (`forbidden` dla pozostałych) |
| `passes_for_range_entry(user_id)` | z `security invoker` na `security definer` z warunkiem `can_keep_range_log()` (dziś działa dzięki RLS `orders` / `user_passes` dla `is_staff()`; dyżurny nie dostaje odczytu tych tabel) |
| `create_range_log_entry` | warunek dostępu; `created_by = auth.uid()` jak dotąd |
| `current_range_duty`, `range_officer_choices`, `staff_search_range_officers` | warunek dostępu (odczyt) |
| `range_log` — polityka `select` | `is_admin()` wszystkie; `can_keep_range_log()` tylko dzisiejsze |
| `range_log_annotations` — `select` i `insert` | „staff” → `can_keep_range_log()` (insert nadal tylko do dzisiejszych, admin — dowolne) |
| `storage.objects` — „signatures: staff insert” | `can_keep_range_log()` (odczyt nadal tylko admin) |

Bez zmian (nadal `is_staff()` / `is_admin()`): `set_range_duty`, `set_scheduled_range_duty`, `clear_scheduled_range_duty`,
`range_duty_schedule`, `review_range_officer`, `create_on_site_order`, `staff_on_site_sales_today`, `revert_pass_usage`,
`admin_range_log`, polityki `select` na `profiles`, `range_officers`, `range_duty`, `orders`, `user_passes`, `pass_usages`.

`audit_log` przy `staff_complete_profile` zapisuje wywołującego (dyżurnego) jak przy Obsłudze — bez nowej akcji.

## 6. Interfejs użytkownika

| Adres | Zmiana |
| --- | --- |
| `/konto/` — „Twoje dane” | Przy zatwierdzonych uprawnieniach prowadzącego, gdy `rpc/is_range_duty_officer` = `true`: „Dziś jesteś dyżurnym Prowadzącym.” + „Otwórz książkę rejestru pobytu” |
| Bramka panelu (`web/src/lib/panel.ts`) | Nowy stan `duty`: rola `user` + `rpc/is_range_duty_officer` = `true`; dostęp tylko do stron oznaczonych jako dostępne dla dyżurnego (`/panel/ksiazka/`); pozostałe — `forbidden`; `/panel/` przekierowuje dyżurnego do `/panel/ksiazka/` |
| Menu panelu (stan `duty`) | Tylko „Książka” |
| `/panel/ksiazka/` (stan `duty`) | „Prowadzący strzelanie: …” bez „Zmień”; bez ekranu „Kto prowadzi dziś strzelanie?”; bez „Sprzedaj na miejscu” (AC-8); reszta jak Obsługa |

Komunikaty (i18n):
- „Dziś jesteś dyżurnym Prowadzącym.”
- „Otwórz książkę rejestru pobytu”
- „Książkę może prowadzić dyżurny Prowadzący w dniu dyżuru albo Obsługa strzelnicy.”
- „Brak ważnego karnetu lub wejścia na dziś. Sprzedaż na miejscu prowadzi Obsługa.”
- „Nie jesteś już dyżurnym Prowadzącym — wpis nie został zapisany. Książkę prowadzi teraz Obsługa lub nowy dyżurny.”
- „Odśwież”

## 7. Przypadki brzegowe

- Dyżurny traci dyżur w trakcie wpisu (AC-14) → zapis odrzucony; plik podpisu osierocony — usuwa go zadanie retencji po 24 h (SPEC-005 AC-31).
- Dyżurny traci dyżur między skanem a wyborem uprawnienia → kolejne wywołanie zwraca `forbidden` → komunikat z AC-14.
- Dyżurny wskazany tylko w grafiku na jutro → dziś brak dostępu (AC-15, decyzja 1-A).
- Dyżurny = prowadzący dodany przez admina (bez konta) → nikt nie ma dostępu z tego tytułu; książkę prowadzi Obsługa.
- Dyżurny wpisuje sam siebie (np. sam też strzela) → dozwolone jak u Obsługi; podpis składa osobiście.
- Ten sam człowiek ma rolę Obsługi i jest dyżurnym → obowiązują uprawnienia Obsługi (z „Zmień”, sprzedażą).
- Dyżurny z ukrytym zgłoszeniem („Ukryj mnie dla innych”) → dostęp bez zmian; ukrycie dotyczy tylko list wyboru.
- Osoba bez konta bez uprawnienia → dyżurny może ją wpisać tylko jako osobę towarzyszącą (AC-8); wejście płatne — przez Obsługę.
- Sesja otwarta po północy → pierwsze wywołanie po północy sprawdza dyżurnego nowego dnia (AC-15).

## 8. Integracje

Brak nowych. Storage `signatures` — zmiana polityki `insert` (§5).

## 9. RODO

- Nowy krąg odbiorców danych: dyżurny Prowadzący z konta w dniu dyżuru — ten sam zakres co Obsługa przy wpisie
  (imię i nazwisko, numer decyzji z organem albo adres, ważne dziś uprawnienia obsługiwanej osoby, dzisiejsze wpisy bez podpisów).
- Cel: prowadzenie książki rejestru pobytu (jak SPEC-005).
- Dostęp czasowy: wyłącznie gdy wywołujący jest **teraz** dyżurnym; utrata dyżuru odcina dostęp od razu (każde zapytanie sprawdza dyżur).
- Bez odczytu tabel (profile, zamówienia, karnety, zużycia, lista prowadzących) — tylko funkcje z minimum danych; podpisów nie widzi.
- Zmiany danych osoby przez dyżurnego — w `audit_log`; wpisy — `created_by`.
- Przechowywanie bez zmian (SPEC-005 §9, SPEC-007 §9).

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Kiedy dyżurny ma dostęp do książki | 1-A: tylko gdy teraz jest dyżurnym wg `range_duty_for(range_today())`; po zmianie dyżurnego lub o północy traci dostęp | 2026-11-20 (#128) |
| Jakie wpisy widzi i co z nimi robi | 2-A: jak Obsługa — dzisiejsze wpisy bez podpisów, adnotacje tylko do dzisiejszych; bez historii i eksportu | 2026-11-20 (#128) |
| Inny Prowadzący przy wpisie | 3-A: tak, jak Obsługa; dyżurny się nie zmienia, `created_by` = dyżurny | 2026-11-20 (#128) |
| Sprzedaż na miejscu | 4-B: nie; bez uprawnienia — komunikat i tylko osoba towarzysząca | 2026-11-20 (#128) |
| Uzupełnianie danych osoby | 5-A: tak, jak Obsługa, z `audit_log` | 2026-11-20 (#128) |

Założenia analityka (zatwierdzane razem ze specyfikacją): dyżurny widzi w panelu tylko „Książka”; nie ma „Zmień” przy
„Prowadzący strzelanie: …”, ekranu „Kto prowadzi dziś strzelanie?”, `/panel/dyzury/`, `/panel/prowadzacy/`; uprawnienia sprawdza baza
(nowe funkcje w RLS i `security definer`); wejście z `/konto/` (bez linku w nagłówku); dostęp tylko dla prowadzących z kontem.

Otwarte: brak.

## 11. Zadania

1. #129 Baza: `is_range_duty_officer()`, `can_keep_range_log()`, zmiana warunków funkcji i polityk z §5, `passes_for_range_entry`
   jako `security definer`, testy pgTAP (dostęp dyżurnego dziś, brak dostępu po zmianie dyżurnego / jutro / bez konta,
   odmowa `set_range_duty` i sprzedaży, brak odczytu tabel) — AC-4 (baza), AC-5…AC-7, AC-9…AC-16 po stronie bazy.
2. #130 UI: stan `duty` w bramce panelu i menu, `/panel/ksiazka/` bez „Zmień”, bez wyboru dyżurnego i bez sprzedaży, komunikaty
   AC-3, AC-8, AC-14, przycisk w `/konto/` (AC-1…AC-4, AC-8, AC-14), testy Vitest i E2E.
