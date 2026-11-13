# SPEC-001: Szkielet aplikacji — kalendarz strzelnicy, zawody, regulaminy, strona publiczna

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #4
- Zadania: #5, #6, #7, #8, #9, #10, #11, #15 (podział w sekcji 11); dla właściciela: #12, #13 (`owner-task`)
- Zmiana zakresu 2026-11-13: aplikacja jest **kalendarzem strzelnicy** — wpisami są wydarzenia i zawody.
  Decyzje dotyczące kalendarza (P1–P6) w sekcji 10.

## 1. Cel

Postawić fundament aplikacji: projekt Astro w `web/`, Supabase w `supabase/`, logowanie organizatora
przez Google i panel, w którym organizator prowadzi **kalendarz strzelnicy**. Wpis w kalendarzu to:

- **wydarzenie** — coś, co odbywa się na strzelnicy: nazwa, termin, krótki opis, kategoria i link zewnętrzny,
  pod którym organizator wydarzenia podaje wszystkie szczegóły;
- **zawody** — organizowane przez Steel Valley, z regulaminem, matchbookiem i harmonogramem
  (w kolejnych specyfikacjach także z zapisami, płatnościami i wynikami).

Goście widzą kalendarz nadchodzących wpisów: wydarzenie jako kartę z opisem i linkiem, zawody z pełną stroną.

## 2. Zakres

**W zakresie:**
- Projekt Astro (statyczny build, TypeScript, i18n — na razie tylko `pl`), wygląd z rodziny
  [landing-page](https://rkazmier.github.io/landing-page/) w jaśniejszej, stalowej szarości.
- Projekt Supabase: migracje, RLS, Storage, jedna Edge Function (`site-rebuild`).
- Logowanie przez Google (Supabase Auth), rola organizatora nadawana ręcznie w bazie.
- Panel organizatora: dyscypliny, kategorie wydarzeń, biblioteka regulaminów, zawody (szkic → opublikowane),
  harmonogram, matchbook, wydarzenia (szkic → opublikowane).
- Strona publiczna: kalendarz nadchodzących wpisów (zawody i wydarzenia) i strona zawodów; strony generowane
  przy budowaniu i automatycznie przebudowywane po zmianach (ADR-0003).

**Poza zakresem:**
- Rejestracja zawodników, limity miejsc, opłaty, płatności, wyniki, ranking.
- Sekcja „Minione zawody” / archiwum (dojdzie z wynikami). Minione wpisy znikają z kalendarza, strona zawodów działa dalej.
- Wydarzenia: zapisy, płatności, pliki, harmonogram, powtarzanie (np. „co wtorek”) — każde wydarzenie dodaje się osobno.
- Własna strona wydarzenia, filtrowanie kalendarza po kategorii, widok siatki miesiąca,
  import/eksport kalendarza (iCal, Google Calendar).
- Logowanie zawodników (sposób ustali specyfikacja rejestracji), rola administratora i zarządzanie organizatorami.
- Wersja angielska (teksty w plikach i18n są gotowe pod nią, tłumaczenia — później).
- Miejsce wpisu (zawsze strzelnica Steel Valley), komunikaty dla zawodników, galeria.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Gość (niezalogowany) | Opublikowane zawody (z harmonogramem, regulaminem, matchbookiem) i opublikowane wydarzenia; dyscypliny i kategorie | Nic |
| Zalogowany bez roli organizatora (`competitor`) | To samo co gość + własny profil; w panelu komunikat o braku uprawnień | Nic |
| Organizator (`organizer`) | Wszystkie zawody i wydarzenia (także szkice), wszystkie regulaminy, dyscypliny i kategorie | Dyscypliny, kategorie, regulaminy, zawody, harmonogram, matchbook, wydarzenia; publikacja; przebudowa strony |

Rolę `organizer` nadaje właściciel ręcznie poleceniem SQL w panelu Supabase (kroki w zadaniu `owner-task`).
W kodzie nie ma żadnych adresów e-mail.

## 4. Historyjki i kryteria akceptacji

Numeracja AC jest stała (zadania się do niej odwołują); nowe kryteria kalendarza mają numery od AC-42.

### US-1: Jako gość chcę zobaczyć stronę w stylu Steel Valley, aby wiedzieć, że to oficjalna aplikacja strzelnicy
- **AC-1**: Given dowolna strona publiczna When otwieram ją na ekranie 320–1920 px Then układ (nagłówek, `main`, stopka),
  typografia, odstępy i promienie odpowiadają landing-page, a paleta to jaśniejsza szarość stali (tokeny w jednym pliku, sekcja 6.1); brak poziomego przewijania.
- **AC-2**: Given strona publiczna When sprawdzam dostępność Then elementy dotykowe mają ≥ 44 × 44 px, focus jest widoczny, kontrast spełnia WCAG AA,
  fonty są hostowane lokalnie (brak zasobów z zewnętrznych domen poza Supabase).
- **AC-3**: Given kod frontendu When szukam tekstów widocznych dla użytkownika Then wszystkie pochodzą z pliku i18n `pl`.

### US-2: Jako organizator chcę zalogować się przez Google, aby prowadzić kalendarz
- **AC-4**: Given jestem niezalogowany When otwieram `/panel/` Then widzę przycisk „Zaloguj się przez Google”, a po zalogowaniu wracam do `/panel/`.
- **AC-5**: Given jestem zalogowany bez roli `organizer` When otwieram `/panel/` Then widzę „Nie masz uprawnień organizatora. Skontaktuj się z administratorem strzelnicy.” i przycisk „Wyloguj się”; żadne dane szkiców nie są pobierane (RLS zwraca pustą listę).
- **AC-6**: Given jestem organizatorem When otwieram `/panel/` Then widzę listę wszystkich wpisów kalendarza — zawodów i wydarzeń, szkiców i opublikowanych, od najbliższych —
  z rodzajem („Zawody” / „Wydarzenie”), nazwą, datą, dyscypliną (zawody) lub kategorią (wydarzenie) i stanem („Szkic” / „Opublikowane”),
  przyciski „Nowe zawody” i „Nowe wydarzenie” oraz menu: Kalendarz, Regulaminy, Dyscypliny, Kategorie, Wyloguj się.
- **AC-7**: Given pierwsze logowanie nowego konta When konto powstaje w `auth.users` Then automatycznie powstaje wiersz w `profiles` z rolą `competitor`.

### US-3: Jako organizator chcę prowadzić listę dyscyplin, aby zawody i przyszły ranking używały tych samych nazw
- **AC-8**: Given jestem na `/panel/dyscypliny/` When dodaję dyscyplinę o nazwie, której nie ma na liście Then pojawia się ona na liście jako aktywna.
- **AC-9**: Given istnieje dyscyplina „Long Range” When dodaję „long range” (inna wielkość liter, spacje na końcach) Then widzę błąd „Taka dyscyplina już istnieje.” i nic nie jest zapisywane.
- **AC-10**: Given dyscyplina When zmieniam jej nazwę Then nowa nazwa jest widoczna we wszystkich zawodach tej dyscypliny (po przebudowie strony — US-7).
- **AC-11**: Given dyscyplina When klikam „Ukryj” Then nie da się jej wybrać przy nowych zawodach, ale zawody, które już jej używają, zachowują ją. Dyscyplin nie da się usunąć (tylko ukryć / przywrócić).

### US-4: Jako organizator chcę wczytać regulaminy do biblioteki, aby wybierać je przy zawodach
- **AC-12**: Given jestem na `/panel/regulaminy/` When podaję tytuł i wybieram plik PDF do 20 MB Then plik trafia do Storage, a regulamin pojawia się na liście (tytuł, data wczytania, link „Pobierz PDF”, liczba zawodów, które go używają).
- **AC-13**: Given wybieram plik, który nie jest PDF lub ma > 20 MB When zapisuję Then widzę odpowiednio „Dozwolony jest tylko plik PDF.” lub „Plik jest za duży (maks. 20 MB).” i nic nie jest zapisywane.
- **AC-14**: Given regulamin When klikam „Archiwizuj” Then nie da się go wybrać przy zawodach, ale zawody, które już go używają, nadal go pokazują i link działa. Można go przywrócić („Przywróć”).
- **AC-15**: Given regulamin nieużywany przez żadne zawody When klikam „Usuń” i potwierdzam Then znika z listy i z Storage. Given regulamin używany przez zawody Then przycisku „Usuń” nie ma (jest tylko „Archiwizuj”).
- **AC-16**: Given wczytany regulamin When chcę zmienić jego treść Then muszę wczytać nowy regulamin (plik w bibliotece jest niezmienny); tytuł można poprawić.

### US-5: Jako organizator chcę przygotować zawody jako szkic
- **AC-17**: Given jestem na `/panel/zawody/nowe/` When podaję nazwę, dyscyplinę (z aktywnych), datę początku i zapisuję Then powstają zawody w stanie „Szkic”, niewidoczne publicznie. Pozostałe pola są opcjonalne w szkicu.
- **AC-18**: Given formularz zawodów When podaję datę końca wcześniejszą niż data początku Then widzę „Data końca nie może być wcześniejsza niż data początku.” i nic nie jest zapisywane (walidacja także w bazie — `check`).
- **AC-19**: Given formularz zawodów When wybieram regulamin Then lista zawiera tylko niezarchiwizowane regulaminy, od najnowszych, z datą wczytania.
- **AC-20**: Given formularz zawodów When wczytuję matchbook (PDF ≤ 20 MB) Then jest on przypisany do tych zawodów; mogę go podmienić nowym plikiem lub usunąć (stary plik jest usuwany ze Storage).
- **AC-21**: Given formularz zawodów When dodaję punkt harmonogramu (dzień z zakresu dat zawodów, opcjonalna godzina, opis) Then punkt pojawia się w tabeli posortowanej po dniu i godzinie (punkty bez godziny na początku dnia, potem w kolejności dodania); mogę go edytować i usunąć.
- **AC-22**: Given punkt harmonogramu When dzień jest poza zakresem dat zawodów Then widzę „Dzień musi mieścić się w terminie zawodów.” Given zmieniam daty zawodów tak, że istniejące punkty wypadają poza zakres Then zapis jest blokowany z tym samym komunikatem przy tych punktach.
- **AC-23**: Given szkic When klikam „Usuń zawody” i potwierdzam Then zawody, ich harmonogram i matchbook (plik) są usuwane. Opublikowanych zawodów nie da się usunąć (najpierw „Cofnij publikację”).
- **AC-24**: Given szkic When klikam „Podgląd” Then widzę zawody tak, jak będą wyglądać publicznie, z paskiem „Podgląd — zawody nie są opublikowane”.

### US-6: Jako organizator chcę opublikować zawody, aby goście je widzieli
- **AC-25**: Given szkic z nazwą, dyscypliną, datą początku i regulaminem When klikam „Opublikuj” Then stan zmienia się na „Opublikowane”, zapisuje się `published_at`, a ja widzę „Opublikowano. Strona publiczna odświeży się w ciągu kilku minut.”
- **AC-26**: Given szkic bez regulaminu When klikam „Opublikuj” Then widzę „Aby opublikować zawody, wybierz regulamin.” i stan się nie zmienia (wymuszone także w bazie — `check`: opublikowane ⇒ `rulebook_id` niepuste).
- **AC-27**: Given opublikowane zawody When klikam „Cofnij publikację” i potwierdzam Then wracają do stanu „Szkic”, a po przebudowie ich strona publiczna przestaje istnieć (404).
- **AC-28**: Given opublikowane zawody When zmieniam dane i zapisuję Then zmiany są zapisane i uruchamia się przebudowa strony (US-7). Adres strony zawodów (`slug`) po pierwszej publikacji się nie zmienia.

### US-7: Jako organizator chcę, żeby strona publiczna sama się odświeżała po zmianach
- **AC-29**: Given organizator When publikuje lub cofa publikację zawodów albo wydarzenia, zapisuje opublikowane zawody lub wydarzenie, usuwa opublikowane wydarzenie,
  zmienia nazwę lub ukrywa dyscyplinę albo kategorię, zmienia tytuł regulaminu Then panel wywołuje Edge Function `site-rebuild`, która uruchamia workflow przebudowy strony dla swojego środowiska (staging / produkcja).
- **AC-30**: Given wywołanie `site-rebuild` When wywołujący nie jest zalogowanym organizatorem Then funkcja zwraca 403 i nic nie uruchamia.
- **AC-31**: Given kilka zmian w krótkim czasie When uruchamia się kilka przebudów Then wdraża się ostatnia (wcześniejsze są anulowane — `concurrency` z `cancel-in-progress`).
- **AC-32**: Given przebudowa produkcji When się wykonuje Then buduje kod z najnowszego opublikowanego Release (nie z `main`) i nie uruchamia migracji ani wdrożenia funkcji; staging buduje `main`.
- **AC-33**: Given codziennie o 00:30 czasu polskiego When uruchamia się przebudowa z harmonogramu Then minione wpisy (zawody i wydarzenia) znikają z kalendarza.
- **AC-34**: Given panel When klikam „Odśwież stronę publiczną” Then uruchamia się przebudowa (ręczny wyzwalacz na wypadek błędu); w panelu widać komunikat z AC-25.

### US-8: Jako gość chcę zobaczyć kalendarz nadchodzących wpisów na strzelnicy
- **AC-35**: Given opublikowane zawody i wydarzenia, których data końca (lub początku, gdy brak końca) jest dziś lub później (Europe/Warsaw, w chwili budowania)
  When otwieram `/` Then widzę kalendarz: wpisy pogrupowane po miesiącach (nagłówek np. „Czerwiec 2027”), w miesiącu od najbliższych;
  wpis wielodniowy jest w miesiącu swojej daty początku (lub bieżącym, jeśli zaczął się wcześniej i trwa). Kolejność w tym samym dniu: najpierw zawody,
  potem wydarzenia, w obu grupach wg nazwy.
- **AC-36**: Given brak nadchodzących wpisów When otwieram `/` Then widzę „Brak zaplanowanych wydarzeń. Zajrzyj wkrótce.”
- **AC-37**: Given szkic zawodów lub wydarzenia When otwieram `/` lub zgaduję adres zawodów Then nic o nim nie widać (strona nie jest generowana, RLS nie zwraca szkiców gościom).
- **AC-42**: Given nadchodzące zawody When oglądam kalendarz Then karta zawodów ma etykietę „Zawody Steel Valley”, termin (np. „14 czerwca 2027” lub „14–15 czerwca 2027”), nazwę, dyscyplinę
  i link „Szczegóły zawodów” do `/zawody/<slug>/`.
- **AC-43**: Given nadchodzące wydarzenie When oglądam kalendarz Then karta wydarzenia ma etykietę z nazwą kategorii, termin (np. „14 czerwca 2027” lub „14–15 czerwca 2027”, bez godziny),
  nazwę, opis (akapity, bez HTML) i przycisk „Szczegóły u organizatora” otwierający link zewnętrzny w nowej karcie (`target="_blank" rel="noopener noreferrer"`)
  z ikoną/tekstem dla czytników ekranu „(otwiera się w nowej karcie)”. Wydarzenie nie ma własnej strony.
- **AC-44**: Given karty w kalendarzu When patrzę na nie Then rodzaj wpisu jest rozpoznawalny nie tylko kolorem (etykieta tekstowa), a zawody są wizualnie wyróżnione (np. akcent `--color-highlight`).

### US-9: Jako gość chcę zobaczyć stronę zawodów z regulaminem i matchbookiem
- **AC-38**: Given opublikowane zawody When otwieram `/zawody/<slug>/` Then widzę nazwę, termin, dyscyplinę, opis (akapity), harmonogram (tabela pogrupowana po dniach: godzina, opis) oraz przyciski „Regulamin (PDF)” i „Matchbook (PDF)”.
- **AC-39**: Given zawody bez matchbooka When otwieram ich stronę Then w miejscu przycisku widzę „Matchbook wkrótce”. Given brak punktów harmonogramu Then widzę „Harmonogram wkrótce”.
- **AC-40**: Given minione opublikowane zawody When otwieram ich adres Then strona nadal działa (nie ma ich tylko w kalendarzu nadchodzących).
- **AC-41**: Given link do strony zawodów (lub do kalendarza `/`) wklejony na Facebooku/Messengerze When serwis pobiera podgląd Then strona ma `<title>`, `meta description` (zawody: początek opisu, maks. 160 znaków; kalendarz: stały tekst z i18n), znaczniki Open Graph (`og:title`, `og:description`, `og:url`, `og:type=website`, `og:image` — domyślny obraz serwisu) i `link rel=canonical` na adres produkcyjny.

### US-10: Jako organizator chcę prowadzić listę kategorii wydarzeń
- **AC-45**: Given jestem na `/panel/kategorie/` When dodaję kategorię o nazwie, której nie ma na liście Then pojawia się ona jako aktywna. Lista startowa jest pusta (nazwy wpisuje organizator).
- **AC-46**: Given istnieje kategoria „Szkolenie” When dodaję „szkolenie ” Then widzę „Taka kategoria już istnieje.” i nic nie jest zapisywane.
- **AC-47**: Given kategoria When zmieniam jej nazwę lub klikam „Ukryj” / „Przywróć” Then działa to jak dla dyscyplin (AC-10, AC-11): ukrytej nie da się wybrać przy nowych wydarzeniach, istniejące ją zachowują; kategorii nie da się usunąć.

### US-11: Jako organizator chcę dodać do kalendarza wydarzenie odbywające się na strzelnicy
- **AC-48**: Given jestem na `/panel/wydarzenia/nowe/` When podaję nazwę, kategorię (z aktywnych), datę początku i zapisuję Then powstaje wydarzenie w stanie „Szkic”, niewidoczne publicznie.
  Pola: Nazwa* (1–150 znaków), Kategoria*, Data początku*, Data końca (opcjonalnie), Opis (maks. 2000 znaków), Link zewnętrzny.
- **AC-49**: Given formularz wydarzenia When data końca jest wcześniejsza niż data początku Then widzę „Data końca nie może być wcześniejsza niż data początku.” (także `check` w bazie).
- **AC-50**: Given formularz wydarzenia When link nie zaczyna się od `https://` lub `http://` albo ma > 2000 znaków Then widzę „Podaj pełny adres strony, np. https://…” i nic nie jest zapisywane (także `check` w bazie).
- **AC-51**: Given szkic wydarzenia z nazwą, kategorią, datą początku i linkiem When klikam „Opublikuj” Then stan zmienia się na „Opublikowane”, zapisuje się `published_at`, widzę komunikat z AC-25 i uruchamia się przebudowa.
  Given szkic bez linku Then widzę „Aby opublikować wydarzenie, podaj link do szczegółów.” i stan się nie zmienia (`check`: opublikowane ⇒ `external_url` niepuste).
- **AC-52**: Given opublikowane wydarzenie When klikam „Cofnij publikację” Then wraca do szkicu i po przebudowie znika z kalendarza. Given wydarzenie (w dowolnym stanie) When klikam „Usuń wydarzenie” i potwierdzam Then jest usuwane
  („Czy na pewno usunąć wydarzenie „<nazwa>”? Tej operacji nie można cofnąć.”); jeśli było opublikowane, uruchamia się przebudowa.
- **AC-53**: Given formularz wydarzenia When patrzę na pole linku Then widzę podpowiedź „Strona organizatora wydarzenia ze szczegółami, np. wydarzenie na Facebooku.”; podgląd karty wydarzenia jest widoczny pod formularzem (ten sam komponent co w kalendarzu).

## 5. Model danych

Wszystkie tabele w schemacie `public`, RLS włączone jawnie w migracji. Czas zapisu w `timestamptz` (UTC).
Daty wpisów i godziny w harmonogramie zawodów to **czas lokalny strzelnicy** (`date` / `time` bez strefy) — tak jak na plakacie, bez przeliczeń.

Zawody i wydarzenia to **osobne tabele** (zawody dostaną zgłoszenia, płatności i wyniki; wydarzenie pozostaje prostym wpisem).
Kalendarz to połączenie obu list w kodzie frontendu (`web/src/lib/calendar.ts`, typ `CalendarEntry = { kind: 'competition' | 'event', … }`, test Vitest sortowania i grupowania).
W kodzie TypeScript używamy nazwy `CalendarEvent` (nie `Event`, które koliduje z typem DOM).

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `profiles` | `id` | `uuid` PK, FK → `auth.users.id` on delete cascade | tak | tak (powiązanie z kontem) | tworzony wyzwalaczem po rejestracji konta |
| | `role` | `text` check in (`competitor`, `organizer`) | tak | nie | domyślnie `competitor`; lista ról rozszerzalna w kolejnych specyfikacjach |
| | `created_at` | `timestamptz` | tak | nie | `now()` |
| `disciplines` | `id` | `uuid` PK | tak | nie | |
| | `name` | `text` | tak | nie | 1–80 znaków po `trim`; unikalny indeks na `lower(trim(name))` |
| | `is_active` | `boolean` | tak | nie | domyślnie `true`; `false` = ukryta |
| | `created_at` | `timestamptz` | tak | nie | |
| `event_categories` | `id`, `name`, `is_active`, `created_at` | jak `disciplines` | | nie | kategorie wydarzeń; brak danych startowych |
| `rulebooks` | `id` | `uuid` PK | tak | nie | |
| | `title` | `text` | tak | nie | 1–200 znaków |
| | `file_path` | `text` | tak | nie | ścieżka w Storage, niezmienna |
| | `file_size` | `integer` | tak | nie | bajty, ≤ 20 971 520 |
| | `is_archived` | `boolean` | tak | nie | domyślnie `false` |
| | `created_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak (kto wczytał) | niewidoczne publicznie |
| | `created_at` | `timestamptz` | tak | nie | „data wczytania” |
| `competitions` | `id` | `uuid` PK | tak | nie | |
| | `slug` | `text` unikalny | tak | nie | `<starts_on>-<nazwa-bez-polskich-znaków>`, np. `2027-06-14-puchar-steel-valley`; przeliczany przy zapisie szkicu, zamrożony od pierwszej publikacji; przy kolizji sufiks `-2`, `-3`… |
| | `name` | `text` | tak | nie | 1–150 znaków |
| | `discipline_id` | `uuid` FK → `disciplines.id` on delete restrict | tak | nie | przy nowych zawodach tylko aktywne |
| | `starts_on` | `date` | tak | nie | |
| | `ends_on` | `date` | nie | nie | `check (ends_on is null or ends_on >= starts_on)` |
| | `description` | `text` | nie | nie | zwykły tekst, maks. 10 000 znaków; puste linie = akapity; renderowany bez HTML (escapowany) |
| | `rulebook_id` | `uuid` FK → `rulebooks.id` on delete restrict | nie | nie | wymagany do publikacji |
| | `matchbook_path` | `text` | nie | nie | ścieżka w Storage |
| | `status` | `text` check in (`draft`, `published`) | tak | nie | domyślnie `draft`; `check (status = 'draft' or rulebook_id is not null)` |
| | `published_at` | `timestamptz` | nie | nie | ustawiany przy pierwszej publikacji |
| | `created_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | niewidoczne publicznie |
| | `created_at`, `updated_at` | `timestamptz` | tak | nie | `updated_at` wyzwalaczem |
| `schedule_items` | `id` | `uuid` PK | tak | nie | |
| | `competition_id` | `uuid` FK → `competitions.id` on delete cascade | tak | nie | |
| | `day` | `date` | tak | nie | w zakresie `starts_on`…`coalesce(ends_on, starts_on)` (wyzwalacz) |
| | `time` | `time` | nie | nie | np. `08:00` |
| | `description` | `text` | tak | nie | 1–300 znaków, np. „Rejestracja zawodników” |
| | `position` | `integer` | tak | nie | kolejność dodania, do sortowania remisów |
| `calendar_events` | `id` | `uuid` PK | tak | nie | wydarzenie w kalendarzu |
| | `name` | `text` | tak | nie | 1–150 znaków |
| | `category_id` | `uuid` FK → `event_categories.id` on delete restrict | tak | nie | przy nowych wydarzeniach tylko aktywne |
| | `starts_on` | `date` | tak | nie | |
| | `ends_on` | `date` | nie | nie | `check (ends_on is null or ends_on >= starts_on)` |
| | `description` | `text` | nie | nie | zwykły tekst, maks. 2000 znaków; renderowany bez HTML |
| | `external_url` | `text` | nie | nie | `check (external_url ~ '^https?://' and length(external_url) <= 2000)`; wymagany do publikacji |
| | `status` | `text` check in (`draft`, `published`) | tak | nie | domyślnie `draft`; `check (status = 'draft' or external_url is not null)` |
| | `published_at` | `timestamptz` | nie | nie | ustawiany przy pierwszej publikacji |
| | `created_by` | `uuid` FK → `profiles.id` on delete set null | nie | tak | niewidoczne publicznie |
| | `created_at`, `updated_at` | `timestamptz` | tak | nie | `updated_at` wyzwalaczem |

Stany zawodów: `draft → published` (warunek: regulamin), `published → draft` („Cofnij publikację”).
Usuwanie zawodów: tylko `draft`. `slug` zamrożony, gdy `published_at` niepuste.
Stany wydarzenia: `draft → published` (warunek: link), `published → draft`. Usuwanie wydarzenia: w każdym stanie (nie ma powiązanych danych).

### Funkcje i polityki RLS

- `public.is_organizer()` — `security definer`, `stable`, `search_path = ''`: czy `auth.uid()` ma w `profiles` rolę `organizer`.
  Polityki używają tej funkcji (a nie claimu z JWT), więc odebranie roli działa od razu.
- Custom Access Token Hook dodaje do JWT claim `app_role` (z `profiles.role`) — tylko na potrzeby UI.
- `profiles`: `select` własnego wiersza; brak `insert/update/delete` dla klientów (rolę zmienia właściciel SQL-em).
- `disciplines`, `event_categories`: `select` dla wszystkich (`anon`, `authenticated`); `insert/update` — organizator; brak `delete`.
- `rulebooks`: `select` dla wszystkich tylko tych, które są używane przez opublikowane zawody; organizator — wszystkie;
  `insert/update/delete` — organizator; kolumna `created_by` nie jest udostępniana publicznie (widok publiczny lub `select` kolumn w zapytaniach — Implementator wybiera; test sprawdza, że `anon` jej nie dostaje).
- `competitions`: `select` dla wszystkich, gdy `status = 'published'`; organizator — wszystkie;
  `insert/update` — organizator; `delete` — organizator i tylko `status = 'draft'`. To samo zastrzeżenie dla `created_by`.
- `schedule_items`: `select`, gdy zawody nadrzędne są opublikowane, lub organizator; zapis — organizator.
- `calendar_events`: `select` dla wszystkich, gdy `status = 'published'`; organizator — wszystkie; `insert/update/delete` — organizator.
  To samo zastrzeżenie dla `created_by`.

### Storage

Bucket `documents`, publiczny do odczytu (pliki PDF to dokumenty publiczne, bez danych osobowych), limit 20 MB, typ `application/pdf`.
Ścieżki: `rulebooks/<uuid>.pdf`, `matchbooks/<competition_id>/<uuid>.pdf` (losowe UUID — nazwy oryginalnych plików nie są zapisywane).
Zapis i usuwanie — tylko organizator (polityki na `storage.objects` z `is_organizer()`).
Matchbook szkicu jest technicznie dostępny pod nieodgadywalnym adresem — akceptowalne (dokument i tak ma zostać opublikowany).
Wydarzenia nie mają plików.

## 6. Interfejs użytkownika

### 6.1 Wygląd

Ta sama rodzina co landing-page: te same nazwy tokenów (`src/styles/tokens.css`), fonty Inter / Inter Display hostowane lokalnie,
promienie 4/8/16 px, `--tap-target: 44px`, kontener 72rem, nagłówek 4rem, mobile-first od 320 px.
Różnica — paleta jaśniejszej stali zamiast ciepłego beżu. Propozycja startowa (do akceptacji na zrzutach w PR zadania):

| Token | Landing-page | SV Competitions |
| --- | --- | --- |
| `--color-bg` | `#f7f5f1` | `#f3f5f7` |
| `--color-surface` | `#ffffff` | `#ffffff` |
| `--color-surface-alt` | `#eeebe5` | `#e8ecf0` |
| `--color-border` | `#d9d3c9` | `#cdd4db` |
| `--color-text` | `#1a1d21` | `#1b2026` |
| `--color-text-muted` | `#51575e` | `#4e5864` |
| `--color-accent` | `#23465d` | `#3e5568` |
| `--color-accent-hover` | `#16303f` | `#2c3f4f` |
| `--color-dark` | `#1b2329` | `#252d34` |
| `--color-highlight` | `#a57a2c` | `#a57a2c` (wspólny akcent marki; wyróżnienie kart zawodów) |

Nagłówek: logotyp tekstowy „Steel Valley Competitions”, link „Kalendarz” (`/`). Stopka: link do https://steel-valley.pl.
Panel ma ten sam układ, z menu panelu zamiast nawigacji publicznej.

### 6.2 Ekrany

| Adres | Generowanie | Zawartość |
| --- | --- | --- |
| `/` | statycznie przy budowaniu | Nagłówek „Kalendarz strzelnicy”, wpisy po miesiącach, karty zawodów i wydarzeń (AC-35…37, AC-42…44) |
| `/zawody/<slug>/` | statycznie, `getStaticPaths` z opublikowanych | AC-38…41 |
| `/panel/` | statyczna strona + wyspa (dane w przeglądarce) | logowanie / brak uprawnień / lista wpisów kalendarza (AC-6), „Nowe zawody”, „Nowe wydarzenie”, „Odśwież stronę publiczną” |
| `/panel/zawody/nowe/`, `/panel/zawody/edytuj/?id=<uuid>` | wyspa | formularz zawodów + harmonogram + matchbook; przyciski „Zapisz”, „Opublikuj” / „Cofnij publikację”, „Podgląd”, „Usuń zawody” (tylko szkic) |
| `/panel/zawody/podglad/?id=<uuid>` | wyspa | ten sam komponent co strona zawodów + pasek podglądu (AC-24) |
| `/panel/wydarzenia/nowe/`, `/panel/wydarzenia/edytuj/?id=<uuid>` | wyspa | formularz wydarzenia + podgląd karty (AC-48…53); „Zapisz”, „Opublikuj” / „Cofnij publikację”, „Usuń wydarzenie” |
| `/panel/regulaminy/` | wyspa | formularz wczytania + lista (AC-12…16) |
| `/panel/dyscypliny/` | wyspa | formularz dodania + lista z edycją nazwy i „Ukryj”/„Przywróć” |
| `/panel/kategorie/` | wyspa | jak dyscypliny (AC-45…47); wspólny komponent „lista słownikowa” |

Strony `/panel/**` mają `<meta name="robots" content="noindex">`. Po zapisie formularza: komunikat „Zapisano.”;
błąd sieci/serwera: „Nie udało się zapisać. Spróbuj ponownie.”. Usuwanie i cofanie publikacji wymagają potwierdzenia
(„Czy na pewno usunąć zawody „<nazwa>”? Tej operacji nie można cofnąć.”).

Formularz zawodów — pola: Nazwa*, Dyscyplina* (lista), Data początku*, Data końca (opcjonalnie, „dla zawodów wielodniowych”),
Opis, Regulamin (lista z biblioteki, „— wybierz —”), Matchbook (PDF, opcjonalnie), Harmonogram (tabela: Dzień, Godzina, Opis, + „Dodaj punkt”).
Na telefonie harmonogram jako lista kart; dzień domyślnie = data początku.

Formularz wydarzenia — pola: Nazwa*, Kategoria* (lista), Data początku*, Data końca, Opis, Link do szczegółów (wymagany do publikacji).

Format dat w UI: `14 czerwca 2027`, zakres w tym samym miesiącu `14–15 czerwca 2027`, różne miesiące `30 czerwca – 1 lipca 2027` (`Intl`, `pl-PL`).
Wydarzenia nie mają godziny (decyzja P3-A). Nagłówek miesiąca: `Czerwiec 2027`.

## 7. Przypadki brzegowe

- Dwa szkice zawodów o tej samej nazwie i dacie → różne `slug` (sufiks `-2`).
- Zmiana nazwy opublikowanych zawodów → `slug` bez zmian (linki w mediach społecznościowych działają).
- Regulamin używany przez zawody → nie da się go usunąć (FK `restrict` + brak przycisku).
- Zarchiwizowany regulamin w opublikowanych zawodach → nadal widoczny publicznie.
- Ukryta dyscyplina / kategoria w istniejących wpisach → nadal pokazywana; przy edycji lista zawiera aktywne + bieżącą.
- Wydarzenie wielodniowe, które zaczęło się wczoraj i trwa → widoczne w kalendarzu (w bieżącym miesiącu) do dnia końca.
- Zawody i wydarzenie tego samego dnia → oba w kalendarzu, zawody pierwsze (AC-35).
- Link zewnętrzny przestał działać → odpowiedzialność organizatora; aplikacja nie sprawdza linków.
- Link `javascript:` lub inny schemat → odrzucony (AC-50, `check` w bazie); w HTML zawsze jako atrybut `href` po escapowaniu.
- Przebudowa nie powiodła się (błąd workflowu / brak tokenu) → dane w bazie są poprawne, panel pokazuje „Nie udało się uruchomić odświeżenia strony. Spróbuj „Odśwież stronę publiczną” za chwilę.”; przebudowa nocna i tak to naprawi.
- Budowanie przy niedostępnym Supabase → build kończy się błędem (nie publikujemy pustego kalendarza zamiast prawdziwego).
- Wpis „dziś” → widoczny w kalendarzu przez cały dzień (porównanie dat w Europe/Warsaw).
- Usunięcie konta organizatora → `created_by` = `null`, wpisy zostają.

## 8. Integracje

- **Supabase Auth — Google**: dostawca OAuth Google włączony w obu projektach; adresy przekierowań: produkcja, staging, `http://localhost:4321`. Konfiguruje właściciel (owner-task).
- **Storage**: sekcja 5.
- **Edge Function `site-rebuild`** (ADR-0003): weryfikuje JWT i `is_organizer()`, wywołuje GitHub API
  `POST /repos/rkazmier/sv-competitions/actions/workflows/rebuild-site.yml/dispatches` z `ref: main` i `inputs.target` = wartość sekretu `SITE_ENV` (`staging` / `production`).
  Sekrety Supabase: `GITHUB_DISPATCH_TOKEN` (fine-grained PAT, tylko to repo, uprawnienie *Actions: Read and write*), `SITE_ENV`. Token nigdy nie trafia do logów ani odpowiedzi.
- **Workflow `rebuild-site.yml`**: wyzwalacze `workflow_dispatch` (input `target`) i `schedule` (codziennie 22:30 UTC i 23:30 UTC — jeden z nich wypada o 00:30 czasu polskiego niezależnie od czasu letniego; drugi jest nieszkodliwy). Bez migracji i funkcji, tylko build + publikacja frontendu. `concurrency: rebuild-site-<target>`, `cancel-in-progress: true`.
- **Build Astro**: pobiera dane kluczem publishable (RLS gwarantuje, że widzi tylko opublikowane).
- **Linki zewnętrzne wydarzeń**: tylko zwykłe odnośniki; aplikacja nie pobiera z nich danych ani podglądów.

## 9. RODO

- Dane osobowe: adres e-mail i identyfikator konta Google w `auth.users` (zarządza Supabase Auth), powiązanie `profiles.id`, `created_by` w zawodach, wydarzeniach i regulaminach.
- Cel: uwierzytelnienie organizatora i rozliczalność zmian. Dostęp: właściciel konta (własny profil), właściciel projektu (panel Supabase).
- Publicznie nie jest widoczna żadna dana osobowa (`created_by` wyłączone z odczytu publicznego; nazwy plików PDF losowe).
- Opis wydarzenia to tekst publiczny — podpowiedź w formularzu: „Nie wpisuj danych kontaktowych osób prywatnych; szczegóły podaje strona organizatora.”
- Konta osób, które zalogowały się bez roli organizatora, nie mają w szkielecie żadnej funkcji; przechowywane do czasu usunięcia na prośbę (procedura usuwania kont — w specyfikacji rejestracji).
- Pliki PDF nie zawierają danych osobowych (odpowiedzialność organizatora przy wczytywaniu — tekst pomocniczy w formularzu: „Nie wczytuj plików z danymi osobowymi zawodników.”).

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| Skąd dyscyplina? | 1-A: stała lista w bazie, wybór z listy. Listę prowadzi organizator w panelu (`/panel/dyscypliny/`), więc nazwy nie są wpisane w kod | 2026-11-13 |
| Data zawodów | 2-B: data początku + opcjonalna data końca | 2026-11-13 |
| Harmonogram | 3-A: lista punktów (dzień, godzina, opis) | 2026-11-13 |
| Regulamin i matchbook | Regulamin wybierany z listy wcześniej wczytanych regulaminów (biblioteka); matchbook opcjonalny. Interpretacja: regulamin wymagany do publikacji, szkic może go nie mieć | 2026-11-13 |
| Publikacja | 5-A: szkic → „Opublikuj” | 2026-11-13 |
| Generowanie stron | 6-B: strony statyczne + automatyczna przebudowa (ADR-0003) | 2026-11-13 |
| Minione zawody | 7-A: znikają z listy, strona działa; archiwum później | 2026-11-13 |
| Zakres aplikacji | Kalendarz strzelnicy: wydarzenia (nazwa, data, opis, kategoria, link zewnętrzny) + zawody jako jeden z rodzajów wpisów | 2026-11-13 |

| P1 Kategorie wydarzeń | A: lista prowadzona w panelu (`/panel/kategorie/`) jak dyscypliny, start pusty | 2026-11-13 |
| P2 Nazwa „event” w interfejsie | A: „Wydarzenie” (w kodzie `calendar_event`) | 2026-11-13 |
| P3 Termin wydarzenia | A: data początku + opcjonalna data końca, bez godziny | 2026-11-13 |
| P4 Prezentacja wydarzenia | A: tylko karta w kalendarzu z linkiem zewnętrznym, bez własnej strony | 2026-11-13 |
| P5 Publikacja wydarzenia | A: szkic → „Opublikuj”, link wymagany do publikacji | 2026-11-13 |
| P6 Filtr kategorii | A: nie teraz, kategoria tylko jako etykieta na karcie | 2026-11-13 |

Otwarte: brak.

## 11. Zadania (po zmianie zakresu)

| Zadanie | Zmiana |
| --- | --- |
| #5 Szkielet Astro | link „Kalendarz” w nagłówku zamiast „Zawody” |
| #6 Supabase: schemat, RLS, Storage | + `event_categories`, `calendar_events` z `check` i RLS, testy RLS dla `anon` |
| #7 Panel: logowanie Google i dyscypliny | + kategorie (wspólny komponent listy słownikowej, AC-45…47); lista w `/panel/` obejmuje wydarzenia (AC-6) |
| #8 Panel: biblioteka regulaminów | bez zmian |
| #9 Panel: formularz zawodów | bez zmian |
| #10 Strona publiczna | `/` jako kalendarz: `calendar.ts` (łączenie, sortowanie, grupowanie po miesiącach), karty zawodów i wydarzeń (AC-35…37, AC-42…44); dane wydarzeń z `seed.sql` |
| #11 Publikacja i przebudowa | wyzwalacze przebudowy także dla kategorii (AC-29); minione wydarzenia znikają przy nocnej przebudowie (AC-33) |
| #15 Panel: wydarzenia | formularz wydarzenia, publikacja, usuwanie, podgląd karty (AC-48…53); po #11, bo korzysta z `site-rebuild` |
