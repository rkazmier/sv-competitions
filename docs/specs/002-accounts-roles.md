# SPEC-002: Konta, role i panel użytkownika

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #38 (etap 1 z 4: SPEC-002 → SPEC-003 Oferta → SPEC-004 Faktury → SPEC-005 Książka rejestru pobytu)
- Zadania: #42, #43, #44, #45, #46 (kolejność w sekcji 11); dla właściciela: #39 (teksty prawne), #40 (logowanie e-mail) (`owner-task`)
- Decyzje: ADR-0004 (role), ADR-0006 (zadania cykliczne)

## 1. Cel

Każdy klient strzelnicy (nie tylko zawodnik) ma konto, uzupełnia w nim dane wymagane do wpisu do książki rejestru pobytu
i ma stały kod QR, który obsługa skanuje na miejscu. Porządkujemy role: **użytkownik**, **obsługa strzelnicy**, **admin**
(dotychczasowy „organizator” staje się adminem). Admin nadaje role i zarządza kontami z panelu.

## 2. Zakres

**W zakresie:**
- Rejestracja i logowanie: Google oraz e-mail + hasło (Supabase Auth), reset hasła, potwierdzenie adresu e-mail.
- Klauzula informacyjna RODO przy rejestracji (tekst zastępczy do czasu dostarczenia przez właściciela — zadanie `owner-task`).
- Panel użytkownika `/konto/`: dane, status gotowości do wpisu do książki, kod QR (pełny ekran, druk, nowy kod).
- Role `user` / `staff` / `admin` zamiast `competitor` / `organizer`; migracja istniejących kont.
- Admin: lista kont z wyszukiwarką, podgląd i edycja danych użytkownika, zmiana roli, usunięcie konta (decyzja 13-B).
- Dziennik zmian (`audit_log`): każda zmiana danych użytkownika dokonana przez obsługę lub admina, zmiana roli, usunięcie konta.

**Poza zakresem (inne specyfikacje):**
- Aktywne karnety, historia płatności, przycisk „Przedłuż karnet” → SPEC-003; dane do faktury → SPEC-004;
  historia wejść, skan QR przez obsługę, wpis do książki → SPEC-005. Sekcje te dochodzą do `/konto/` w swoich zadaniach.
- Logowanie przez Facebook (#36), praca bez internetu (#37).
- Usuwanie konta przez samego użytkownika (decyzja 13-B: tylko na prośbę, wykonuje admin).
- Zmiana adresu e-mail konta (standardowy mechanizm Supabase, bez własnego ekranu).
- Własne e-maile aplikacji (decyzja 11-A: tylko e-maile Supabase Auth).

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Gość | Strony publiczne, `/logowanie/`, `/rejestracja/` | Zakłada konto |
| Użytkownik (`user`) | Własny profil, własny kod QR | Własne dane (poza rolą i kodem — kod tylko „Wygeneruj nowy”) |
| Obsługa strzelnicy (`staff`) | Panel `/panel/` bez kalendarza, dane osoby znalezionej przez kod QR lub wyszukanie (SPEC-005) | Uzupełnia dane osoby podczas wpisu do książki (SPEC-005), zawsze z wpisem w `audit_log` |
| Admin (`admin`) | Wszystko, co obsługa, oraz kalendarz (dziś „organizator”), lista wszystkich kont, dziennik zmian | Wszystko, co obsługa, oraz kalendarz, dane każdego użytkownika, role, usunięcie konta |

- Hierarchia: `admin` ⊃ `staff` ⊃ `user`. Funkcje SQL: `public.is_staff()` (staff lub admin), `public.is_admin()`.
- `public.is_organizer()` zostaje jako alias `is_admin()` (używają jej istniejące polityki i `site-rebuild`); nowy kod używa `is_admin()`.
- Obsługa **nie** zarządza kalendarzem (decyzja 2-A).

## 4. Historyjki i kryteria akceptacji

### US-1: Jako klient strzelnicy chcę założyć konto, aby kupować i szybko wchodzić na strzelnicę
- **AC-1**: Given jestem na `/rejestracja/` When podaję e-mail, hasło (min. 8 znaków), zaznaczam „Zapoznałem(-am) się z informacją o przetwarzaniu danych osobowych” i klikam „Załóż konto” Then Supabase wysyła e-mail z potwierdzeniem, a ja widzę „Sprawdź skrzynkę e-mail i kliknij link, aby potwierdzić konto.”.
- **AC-2**: Given formularz rejestracji When nie zaznaczę zgody informacyjnej Then przycisk „Załóż konto” jest nieaktywny; link „Informacja o przetwarzaniu danych” otwiera tekst klauzuli (dziś tekst zastępczy oznaczony „[TEKST DO UZUPEŁNIENIA]”).
- **AC-3**: Given jestem na `/rejestracja/` lub `/logowanie/` When klikam „Kontynuuj z Google” Then loguję się przez Google; przy pierwszym logowaniu przed przejściem dalej widzę klauzulę i przycisk „Rozumiem” (zapis `privacy_notice_ack_at`).
- **AC-4**: Given nowe konto (dowolną metodą) When powstaje wiersz w `auth.users` Then powstaje `profiles` z rolą `user`, losowym `qr_token` i pustymi danymi.
- **AC-5**: Given jestem na `/logowanie/` When podaję e-mail i hasło Then trafiam do `/konto/` (użytkownik) lub do adresu, z którego przyszłam/przyszedłem (`?next=`, tylko ścieżki tej aplikacji). Złe dane → „Nieprawidłowy e-mail lub hasło.”; niepotwierdzony e-mail → „Potwierdź adres e-mail — link wysłaliśmy w wiadomości po rejestracji.” i przycisk „Wyślij link ponownie”.
- **AC-6**: Given nie pamiętam hasła When klikam „Nie pamiętam hasła” i podaję e-mail Then widzę „Jeśli konto istnieje, wysłaliśmy link do zmiany hasła.” (bez ujawniania, czy konto istnieje); link prowadzi do `/logowanie/nowe-haslo/`.

### US-2: Jako użytkownik chcę uzupełnić dane, aby móc zostać wpisanym do książki rejestru pobytu
- **AC-7**: Given jestem w `/konto/` When klikam „Edytuj dane” Then mogę zmienić: Imię i nazwisko*, Telefon, Numer decyzji (pozwolenia na broń), Organ wydający, Adres zamieszkania; e-mail jest tylko do odczytu.
- **AC-8**: Given formularz danych When podam numer decyzji bez organu wydającego (lub odwrotnie) Then widzę „Podaj numer decyzji razem z organem wydającym.” i nic nie jest zapisywane (także `check` w bazie).
- **AC-9**: Given brakuje imienia i nazwiska lub (numeru decyzji z organem i adresu) When otwieram `/konto/` Then na górze widzę blok „Co uzupełnić, aby wejść na strzelnicę” z listą braków („Imię i nazwisko”; „Numer decyzji i organ wydający albo adres zamieszkania”) i przyciskiem „Uzupełnij dane”.
- **AC-10**: Given mam imię i nazwisko oraz (numer decyzji + organ albo adres) When otwieram `/konto/` Then zamiast bloku braków widzę status „Gotowy do wpisu do książki” (kolumna `is_range_ready` liczona w bazie — ten sam wynik widzi obsługa w SPEC-005).
- **AC-11**: Given pola formularza When przekroczę limity (sekcja 5) albo telefon nie pasuje do wzorca Then widzę komunikat przy polu i nic nie jest zapisywane.

### US-3: Jako użytkownik chcę mieć stały kod QR, aby obsługa szybko mnie znalazła
- **AC-12**: Given jestem w `/konto/` When strona się wczyta Then widzę kod QR zawierający wyłącznie `qr_token` (bez danych osobowych), wygenerowany w przeglądarce (bez zewnętrznych usług), oraz przyciski „Pełny ekran”, „Drukuj” i „Wygeneruj nowy kod”.
- **AC-13**: Given klikam „Pełny ekran” Then kod zajmuje ekran na białym tle z maksymalną jasnością kontrastu; zamknięcie przyciskiem „Zamknij” lub gestem wstecz.
- **AC-14**: Given klikam „Drukuj” Then drukuje się strona z kodem (min. 4 cm) i imieniem i nazwiskiem, bez menu i stopki (styl `@media print`).
- **AC-15**: Given klikam „Wygeneruj nowy kod” i potwierdzam („Stary kod przestanie działać, także wydrukowany. Kontynuować?”) Then powstaje nowy `qr_token`, stary od razu przestaje działać (wyszukanie po starym zwraca „Nie znaleziono”).

### US-4: Jako admin chcę nadawać role, aby obsługa mogła pracować w panelu
- **AC-16**: Given jestem adminem When otwieram `/panel/uzytkownicy/` Then widzę listę kont (imię i nazwisko, e-mail, rola, „Gotowy do wpisu”, data założenia) z wyszukiwarką po imieniu i nazwisku lub e-mailu (min. 2 znaki), po 50 na stronę.
- **AC-17**: Given karta użytkownika When zmieniam rolę (Użytkownik / Obsługa strzelnicy / Admin) i potwierdzam Then rola zmienia się od razu (RLS czyta `profiles`), a w `audit_log` powstaje wpis (kto, kiedy, stara i nowa rola).
- **AC-18**: Given jestem jedynym adminem When próbuję odebrać sobie rolę admina Then widzę „Musi zostać co najmniej jeden admin.” i rola się nie zmienia (sprawdzenie w funkcji bazy).
- **AC-19**: Given jestem obsługą lub użytkownikiem When wywołuję zmianę roli (UI lub API) Then operacja jest odrzucona (403 / błąd RLS).

### US-5: Jako admin chcę wejść w profil użytkownika, aby uzupełnić jego dane
- **AC-20**: Given karta użytkownika `/panel/uzytkownicy/profil/?id=` When edytuję dane (te same pola i walidacja co AC-7…AC-11) i zapisuję Then dane się zmieniają, a `audit_log` zapisuje: kto, kiedy, którego użytkownika, które pola (stara i nowa wartość).
- **AC-21**: Given karta użytkownika When patrzę na sekcję „Historia zmian” Then widzę wpisy `audit_log` dla tego użytkownika (data, kto, co), od najnowszych.
- **AC-22**: Given użytkownik sam zmienia swoje dane When zapisuje Then `audit_log` nie dostaje wpisu (logujemy tylko zmiany dokonane przez inne osoby).

### US-6: Jako admin chcę usunąć konto na prośbę użytkownika (decyzja 13-B)
- **AC-23**: Given karta użytkownika When klikam „Usuń konto” Then widzę ostrzeżenie: „Konto, dane profilu i kod QR zostaną usunięte. Niewykorzystane karnety przepadną. Zamówienia i dane do faktur zostają przez 5 lat, wpisy w książce rejestru pobytu — do końca okresu przechowywania.” i muszę wpisać „USUŃ”.
- **AC-24**: Given potwierdziłem When Edge Function `admin-delete-user` (klucz secret, sprawdza `is_admin()` wywołującego) usuwa konto z `auth.users` Then `profiles` znika (kaskada), w `audit_log` zostaje wpis „usunięto konto” z identyfikatorem konta (bez danych osobowych), a odwołania w innych tabelach (`created_by`, `user_id` zamówień, `profile_id` wpisów książki) dostają `null`.
- **AC-25**: Given admin próbuje usunąć własne konto When klika „Usuń konto” Then przycisk jest niedostępny z podpowiedzią „Nie możesz usunąć własnego konta.”.

### US-7: Jako obsługa chcę wejść do panelu i widzieć tylko swoje narzędzia
- **AC-26**: Given jestem obsługą When otwieram `/panel/` Then widzę menu: Książka (SPEC-005), Sprzedaż (SPEC-003), Wyloguj się — bez Kalendarza, Regulaminów, Dyscyplin, Kategorii, Użytkowników; do czasu wdrożenia tych modułów widzę „Moduły obsługi będą dostępne wkrótce.”.
- **AC-27**: Given jestem użytkownikiem When otwieram `/panel/` Then widzę „Nie masz uprawnień do panelu.” i link „Przejdź do swojego konta”.
- **AC-28**: Given dotychczasowe konto z rolą `organizer` When zostanie wykonana migracja Then ma rolę `admin` i widzi w panelu wszystko, co wcześniej; `competitor` → `user` (test pgTAP).

## 5. Model danych

Zmiany w istniejącej tabeli `profiles` i nowa tabela `audit_log`. Wszystko w `public`, RLS jawnie w migracji.

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `profiles` | `id` | `uuid` PK, FK → `auth.users` on delete cascade | tak | tak | bez zmian |
| | `role` | `text` check in (`user`, `staff`, `admin`) | tak | nie | domyślnie `user`; migracja: `competitor`→`user`, `organizer`→`admin` |
| | `full_name` | `text` | nie | tak | 2–150 znaków po `trim` |
| | `phone` | `text` | nie | tak | `^\+?[0-9 ]{9,20}$` |
| | `permit_number` | `text` | nie | tak | numer decyzji (pozwolenia na broń), 1–50 znaków |
| | `permit_authority` | `text` | nie | tak | organ wydający, 2–150 znaków; `check ((permit_number is null) = (permit_authority is null))` |
| | `address` | `text` | nie | tak | adres zamieszkania jednym polem („ulica i numer, kod, miejscowość”), 5–300 znaków |
| | `is_range_ready` | `boolean` generated always as stored | tak | nie | `full_name is not null and (permit_number is not null or address is not null)` |
| | `qr_token` | `text` unikalny | tak | nie (losowy) | 32 znaki base64url z `gen_random_bytes(24)`; domyślnie przy tworzeniu |
| | `qr_token_rotated_at` | `timestamptz` | nie | nie | |
| | `privacy_notice_ack_at` | `timestamptz` | nie | nie | potwierdzenie klauzuli informacyjnej |
| | `created_at`, `updated_at` | `timestamptz` | tak | nie | `updated_at` wyzwalaczem |
| `audit_log` | `id` | `bigint` identity PK | tak | nie | |
| | `actor_id` | `uuid` FK → `profiles.id` on delete set null | nie | tak | kto zmienił |
| | `target_user_id` | `uuid` (bez FK) | nie | tak | czyje dane; bez FK, aby wpis przetrwał usunięcie konta |
| | `action` | `text` check in (`profile_update`, `role_change`, `account_delete`, …) | tak | nie | lista rozszerzana w kolejnych specyfikacjach |
| | `changes` | `jsonb` | nie | tak | `{pole: [stara, nowa]}`; dla `account_delete` — `null` |
| | `created_at` | `timestamptz` | tak | nie | `now()` |

Puste ciągi z formularza zapisujemy jako `null`.

### Funkcje i polityki RLS

- `is_staff()`, `is_admin()` — `security definer`, `stable`, `search_path = ''`, jak dzisiejsze `is_organizer()`; `is_organizer()` = `is_admin()`.
- Custom Access Token Hook: claim `app_role` = `user` / `staff` / `admin` (tylko UI).
- `profiles`:
  - `select`: własny wiersz; `is_staff()` — wszystkie (obsługa potrzebuje ich przy wpisie; UI obsługi pobiera tylko jedną osobę naraz).
  - `update`: własny wiersz tylko kolumny `full_name`, `phone`, `permit_number`, `permit_authority`, `address`, `privacy_notice_ack_at`
    (uprawnienia kolumnowe); admin — te same kolumny dowolnego wiersza. `role` i `qr_token` — tylko przez funkcje poniżej.
  - `insert`/`delete`: brak dla klientów (wyzwalacz / `admin-delete-user`).
- Wyzwalacz `audit_profile_changes` (`after update` na `profiles`): gdy `auth.uid() <> id`, zapisuje `profile_update` ze zmienionymi polami.
- `set_user_role(user_id, role)` — `security definer`, tylko `is_admin()`, blokada odebrania roli ostatniemu adminowi, zapis `role_change`.
- `rotate_qr_token()` — `security definer`, zmienia `qr_token` wywołującego.
- `admin_list_users(search text, page int)` — `security definer`, tylko `is_admin()`, zwraca także e-mail z `auth.users` (e-mail nie jest kopiowany do `profiles`).
- `audit_log`: `select` — `is_admin()`; brak `insert/update/delete` dla klientów (tylko funkcje `security definer`).
- Edge Function `admin-delete-user` (POST `{ user_id }`): sprawdza `rpc/is_admin` z JWT wywołującego, odmawia usunięcia siebie,
  zapisuje `account_delete`, wywołuje `auth.admin.deleteUser`. Odpowiedzi: 204, 403, 404, 409 (własne konto), 500.

## 6. Interfejs użytkownika

| Adres | Zawartość |
| --- | --- |
| `/rejestracja/` | E-mail, Hasło, Powtórz hasło, zgoda informacyjna, „Załóż konto”; „Kontynuuj z Google”; link „Masz konto? Zaloguj się” |
| `/logowanie/` | E-mail, Hasło, „Zaloguj się”, „Kontynuuj z Google”, „Nie pamiętam hasła”, „Załóż konto” |
| `/logowanie/nowe-haslo/` | Nowe hasło, Powtórz hasło, „Zapisz hasło” |
| `/konto/` | Blok braków lub status gotowości; kod QR z przyciskami; „Twoje dane” (podgląd) + „Edytuj dane”; „Wyloguj się”. Później: karnety, płatności, wejścia |
| `/konto/dane/` | Formularz danych (AC-7) z podpowiedziami: „Numer decyzji i organ wydający znajdziesz w pozwoleniu na broń.”, „Adres zamieszkania jest potrzebny, jeśli nie masz pozwolenia na broń.” |
| `/panel/uzytkownicy/` | Lista kont, wyszukiwarka (tylko admin) |
| `/panel/uzytkownicy/profil/?id=` | Dane (edycja), rola, kod QR (bez możliwości zmiany), „Historia zmian”, „Usuń konto”; później: karnety, zamówienia, „Rozpocznij wpis do książki” |

- Nagłówek strony publicznej dostaje link „Zaloguj się” (gość) / „Moje konto” (zalogowany) oraz „Panel” dla obsługi i admina.
- `/konto/**` i `/panel/**` mają `noindex`. Kod QR i dane pobierane w przeglądarce, po sesji.
- Na telefonie kod QR jest pierwszym elementem `/konto/` po bloku braków / statusie (obsługa skanuje z ekranu telefonu).
- Gdy profil nie jest gotowy, kod QR nadal jest pokazywany (obsługa może uzupełnić dane na miejscu — SPEC-005).

## 7. Przypadki brzegowe

- Ta sama osoba rejestruje się e-mailem, a potem loguje Google na ten sam adres → Supabase łączy tożsamości (automatyczne łączenie dla potwierdzonych e-maili); jedno konto.
- Wyciek zrzutu ekranu z kodem QR → użytkownik generuje nowy kod (AC-15). Kod nie zawiera danych, więc samo zdjęcie niczego nie ujawnia.
- Kolizja `qr_token` (praktycznie niemożliwa) → indeks unikalny, ponowne losowanie w funkcji.
- Admin zmienia sobie rolę na `staff`, a jest jeszcze inny admin → dozwolone; od razu traci dostęp do kalendarza.
- Usunięcie konta, które ma `created_by` w zawodach → `created_by = null` (jak w SPEC-001).
- Odebranie roli obsłudze w trakcie zmiany → kolejne zapytania odrzucane od razu (RLS), interfejs pokazuje brak uprawnień po odświeżeniu.
- Użytkownik wpisuje adres w złym formacie → nie walidujemy struktury adresu (tylko długość); odpowiada za poprawność.

## 8. Integracje

- **Supabase Auth**: dostawca e-mail z potwierdzeniem adresu, Google (już włączony). Adresy przekierowań: `/logowanie/nowe-haslo/`, `/konto/` w obu środowiskach i lokalnie.
  Szablony e-maili Supabase po polsku (treść w zadaniu `owner-task` — konfiguracja w panelu Supabase).
- **Edge Function `admin-delete-user`**: sekret `SUPABASE_SECRET_KEY` (już dostępny w funkcjach), wzorzec `handler.ts` + testy Deno.
- **Biblioteka QR**: generowanie SVG w przeglądarce z pakietu npm (np. `qrcode`), bez usług zewnętrznych.

## 9. RODO

- Dane: imię i nazwisko, e-mail, telefon, numer decyzji i organ wydający, adres zamieszkania; cel — prowadzenie konta i wymogi książki rejestru pobytu
  (wpis wymaga imienia i nazwiska oraz numeru decyzji z organem albo adresu). Telefon dobrowolny. Bez PESEL i daty urodzenia.
- Dostęp: użytkownik (własne), obsługa (osoba obsługiwana przy wpisie), admin (wszyscy). Publicznie — nic.
- Przechowywanie: do usunięcia konta (na prośbę, przez admina). Kopie danych we wpisach książki i zamówieniach — wg SPEC-005 i SPEC-003/004.
- `audit_log` zawiera stare i nowe wartości danych: przechowywany 1 rok (jak książka), usuwany zadaniem cyklicznym (ADR-0006); okres w kodzie, zmiana przez PR.
- Klauzula informacyjna przy rejestracji: tekst dostarcza właściciel (`owner-task`); potwierdzenie zapisane w `privacy_notice_ack_at`.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Podział pracy | 1-A: 4 specyfikacje (SPEC-002…005), osobne PR-y | 2026-11-17 |
| Rola „organizator” | 2-A: trzy role user / staff / admin; organizator → admin; obsługa bez kalendarza | 2026-11-17 |
| Kto nadaje role | 3-A: admin w panelu, każda zmiana w dzienniku zmian | 2026-11-17 |
| Teksty prawne | 12-A: dostarcza właściciel (`owner-task`), do tego czasu teksty zastępcze; produkcja czeka na prawdziwe | 2026-11-17 |
| Usunięcie konta | 13-B: tylko na prośbę, wykonuje admin w panelu; zasady jak w AC-23 | 2026-11-17 |
| E-maile | 11-A: tylko Supabase Auth (i Tpay) | 2026-11-17 |
| Logowanie | Z issue: Google + e-mail/hasło; Facebook w #36 | 2026-11-17 |

Założenia analityka (zatwierdzane razem ze specyfikacją): adres zamieszkania jednym polem; obsługa widzi profile wszystkich
(potrzebne do wyszukania osoby bez kodu QR); `audit_log` przechowywany 1 rok.

Otwarte: brak.

## 11. Zadania

1. #42 Role user/staff/admin: migracja `profiles`, `is_staff()`/`is_admin()`, hook, panel dla obsługi (AC-19, AC-26…AC-28).
2. #43 Profil: kolumny danych, `is_range_ready`, `qr_token`, `audit_log`, RLS i funkcje (sekcja 5), testy pgTAP.
3. #44 Rejestracja i logowanie e-mail + hasło, klauzula, reset hasła (AC-1…AC-6).
4. #45 Panel użytkownika `/konto/`: dane, gotowość, kod QR (AC-7…AC-15, AC-22).
5. #46 Admin: użytkownicy, role, edycja profilu, historia zmian, usunięcie konta (AC-16…AC-18, AC-20, AC-21, AC-23…AC-25).
