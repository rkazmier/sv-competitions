# SPEC-001: Szkielet aplikacji — zawody, regulaminy, strona publiczna

- Status: szkic (merge = zatwierdzenie)
- Issue z pomysłem: #4
- Zadania: uzupełnione w opisie PR ze specyfikacją

## 1. Cel

Postawić fundament aplikacji: projekt Astro w `web/`, Supabase w `supabase/`, logowanie organizatora
przez Google i panel, w którym organizator przygotowuje i publikuje zawody. Goście widzą listę
nadchodzących zawodów i stronę pojedynczych zawodów z regulaminem, matchbookiem i harmonogramem.

## 2. Zakres

**W zakresie:**
- Projekt Astro (statyczny build, TypeScript, i18n — na razie tylko `pl`), wygląd z rodziny
  [landing-page](https://rkazmier.github.io/landing-page/) w jaśniejszej, stalowej szarości.
- Projekt Supabase: migracje, RLS, Storage, jedna Edge Function (`site-rebuild`).
- Logowanie przez Google (Supabase Auth), rola organizatora nadawana ręcznie w bazie.
- Panel organizatora: dyscypliny, biblioteka regulaminów, zawody (szkic → opublikowane), harmonogram, matchbook.
- Strona publiczna: lista nadchodzących zawodów, strona zawodów; strony generowane przy budowaniu
  i automatycznie przebudowywane po zmianach (ADR-0003).

**Poza zakresem:**
- Rejestracja zawodników, limity miejsc, opłaty, płatności, wyniki, ranking.
- Sekcja „Minione zawody” / archiwum (dojdzie z wynikami). Minione zawody znikają z listy, ich strona działa dalej.
- Logowanie zawodników (sposób ustali specyfikacja rejestracji), rola administratora i zarządzanie organizatorami.
- Wersja angielska (teksty w plikach i18n są gotowe pod nią, tłumaczenia — później).
- Miejsce zawodów (zawsze strzelnica Steel Valley), komunikaty dla zawodników, galeria.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Gość (niezalogowany) | Opublikowane zawody, ich harmonogram, regulamin i matchbook; aktywne dyscypliny | Nic |
| Zalogowany bez roli organizatora (`competitor`) | To samo co gość + własny profil; w panelu komunikat o braku uprawnień | Nic |
| Organizator (`organizer`) | Wszystkie zawody (także szkice), wszystkie regulaminy i dyscypliny | Dyscypliny, regulaminy, zawody, harmonogram, matchbook; publikacja; przebudowa strony |

Rolę `organizer` nadaje właściciel ręcznie poleceniem SQL w panelu Supabase (kroki w zadaniu `owner-task`).
W kodzie nie ma żadnych adresów e-mail.

## 4. Historyjki i kryteria akceptacji

### US-1: Jako gość chcę zobaczyć stronę w stylu Steel Valley, aby wiedzieć, że to oficjalna aplikacja strzelnicy
- **AC-1**: Given dowolna strona publiczna When otwieram ją na ekranie 320–1920 px Then układ (nagłówek, `main`, stopka),
  typografia, odstępy i promienie odpowiadają landing-page, a paleta to jaśniejsza szarość stali (tokeny w jednym pliku, sekcja 6.1); brak poziomego przewijania.
- **AC-2**: Given strona publiczna When sprawdzam dostępność Then elementy dotykowe mają ≥ 44 × 44 px, focus jest widoczny, kontrast spełnia WCAG AA,
  fonty są hostowane lokalnie (brak zasobów z zewnętrznych domen poza Supabase).
- **AC-3**: Given kod frontendu When szukam tekstów widocznych dla użytkownika Then wszystkie pochodzą z pliku i18n `pl`.

### US-2: Jako organizator chcę zalogować się przez Google, aby zarządzać zawodami
- **AC-4**: Given jestem niezalogowany When otwieram `/panel/` Then widzę przycisk „Zaloguj się przez Google”, a po zalogowaniu wracam do `/panel/`.
- **AC-5**: Given jestem zalogowany bez roli `organizer` When otwieram `/panel/` Then widzę „Nie masz uprawnień organizatora. Skontaktuj się z administratorem strzelnicy.” i przycisk „Wyloguj się”; żadne dane szkiców nie są pobierane (RLS zwraca pustą listę).
- **AC-6**: Given jestem organizatorem When otwieram `/panel/` Then widzę listę wszystkich zawodów (szkice i opublikowane, od najbliższych), z nazwą, datą, dyscypliną i stanem („Szkic” / „Opublikowane”), oraz menu: Zawody, Regulaminy, Dyscypliny, Wyloguj się.
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
- **AC-29**: Given organizator When publikuje, cofa publikację, zapisuje opublikowane zawody, zmienia nazwę lub ukrywa dyscyplinę, zmienia tytuł regulaminu Then panel wywołuje Edge Function `site-rebuild`, która uruchamia workflow przebudowy strony dla swojego środowiska (staging / produkcja).
- **AC-30**: Given wywołanie `site-rebuild` When wywołujący nie jest zalogowanym organizatorem Then funkcja zwraca 403 i nic nie uruchamia.
- **AC-31**: Given kilka zmian w krótkim czasie When uruchamia się kilka przebudów Then wdraża się ostatnia (wcześniejsze są anulowane — `concurrency` z `cancel-in-progress`).
- **AC-32**: Given przebudowa produkcji When się wykonuje Then buduje kod z najnowszego opublikowanego Release (nie z `main`) i nie uruchamia migracji ani wdrożenia funkcji; staging buduje `main`.
- **AC-33**: Given codziennie o 00:30 czasu polskiego When uruchamia się przebudowa z harmonogramu Then minione zawody znikają z listy nadchodzących.
- **AC-34**: Given panel When klikam „Odśwież stronę publiczną” Then uruchamia się przebudowa (ręczny wyzwalacz na wypadek błędu); w panelu widać komunikat z AC-25.

### US-8: Jako gość chcę zobaczyć listę nadchodzących zawodów
- **AC-35**: Given opublikowane zawody, których data końca (lub początku, gdy brak końca) jest dziś lub później (Europe/Warsaw, w chwili budowania) When otwieram `/` Then widzę je posortowane od najbliższych: data (np. „14 czerwca 2027” lub „14–15 czerwca 2027”), nazwa, dyscyplina, link do strony zawodów.
- **AC-36**: Given brak nadchodzących zawodów When otwieram `/` Then widzę „Brak zaplanowanych zawodów. Zajrzyj wkrótce.”
- **AC-37**: Given szkic When otwieram `/` lub zgaduję jego adres Then nic o nim nie widać (strona nie jest generowana, RLS nie zwraca szkiców gościom).

### US-9: Jako gość chcę zobaczyć stronę zawodów z regulaminem i matchbookiem
- **AC-38**: Given opublikowane zawody When otwieram `/zawody/<slug>/` Then widzę nazwę, termin, dyscyplinę, opis (akapity), harmonogram (tabela pogrupowana po dniach: godzina, opis) oraz przyciski „Regulamin (PDF)” i „Matchbook (PDF)”.
- **AC-39**: Given zawody bez matchbooka When otwieram ich stronę Then w miejscu przycisku widzę „Matchbook wkrótce”. Given brak punktów harmonogramu Then widzę „Harmonogram wkrótce”.
- **AC-40**: Given minione opublikowane zawody When otwieram ich adres Then strona nadal działa (nie ma ich tylko na liście nadchodzących).
- **AC-41**: Given link do strony zawodów wklejony na Facebooku/Messengerze When serwis pobiera podgląd Then strona ma `<title>`, `meta description` (początek opisu, maks. 160 znaków), znaczniki Open Graph (`og:title`, `og:description`, `og:url`, `og:type=website`, `og:image` — domyślny obraz serwisu) i `link rel=canonical` na adres produkcyjny.

## 5. Model danych

Wszystkie tabele w schemacie `public`, RLS włączone jawnie w migracji. Czas zapisu w `timestamptz` (UTC).
Daty zawodów i harmonogram to **czas lokalny strzelnicy** (`date` / `time` bez strefy) — tak jak na plakacie, bez przeliczeń.

| Tabela | Kolumna | Typ | Wymagane | Dane osobowe | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `profiles` | `id` | `uuid` PK, FK → `auth.users.id` on delete cascade | tak | tak (powiązanie z kontem) | tworzony wyzwalaczem po rejestracji konta |
| | `role` | `text` check in (`competitor`, `organizer`) | tak | nie | domyślnie `competitor`; lista ról rozszerzalna w kolejnych specyfikacjach |
| | `created_at` | `timestamptz` | tak | nie | `now()` |
| `disciplines` | `id` | `uuid` PK | tak | nie | |
| | `name` | `text` | tak | nie | 1–80 znaków po `trim`; unikalny indeks na `lower(trim(name))` |
| | `is_active` | `boolean` | tak | nie | domyślnie `true`; `false` = ukryta |
| | `created_at` | `timestamptz` | tak | nie | |
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

Stany zawodów: `draft → published` (warunek: regulamin), `published → draft` („Cofnij publikację”).
Usuwanie: tylko `draft`. `slug` zamrożony, gdy `published_at` niepuste.

### Funkcje i polityki RLS

- `public.is_organizer()` — `security definer`, `stable`, `search_path = ''`: czy `auth.uid()` ma w `profiles` rolę `organizer`.
  Polityki używają tej funkcji (a nie claimu z JWT), więc odebranie roli działa od razu.
- Custom Access Token Hook dodaje do JWT claim `app_role` (z `profiles.role`) — tylko na potrzeby UI.
- `profiles`: `select` własnego wiersza; brak `insert/update/delete` dla klientów (rolę zmienia właściciel SQL-em).
- `disciplines`: `select` dla wszystkich (`anon`, `authenticated`); `insert/update` — organizator; brak `delete`.
- `rulebooks`: `select` dla wszystkich tylko tych, które są używane przez opublikowane zawody; organizator — wszystkie;
  `insert/update/delete` — organizator; kolumna `created_by` nie jest udostępniana publicznie (widok publiczny lub `select` kolumn w zapytaniach — Implementator wybiera; test sprawdza, że `anon` jej nie dostaje).
- `competitions`: `select` dla wszystkich, gdy `status = 'published'`; organizator — wszystkie;
  `insert/update` — organizator; `delete` — organizator i tylko `status = 'draft'`. To samo zastrzeżenie dla `created_by`.
- `schedule_items`: `select`, gdy zawody nadrzędne są opublikowane, lub organizator; zapis — organizator.

### Storage

Bucket `documents`, publiczny do odczytu (pliki PDF to dokumenty publiczne, bez danych osobowych), limit 20 MB, typ `application/pdf`.
Ścieżki: `rulebooks/<uuid>.pdf`, `matchbooks/<competition_id>/<uuid>.pdf` (losowe UUID — nazwy oryginalnych plików nie są zapisywane).
Zapis i usuwanie — tylko organizator (polityki na `storage.objects` z `is_organizer()`).
Matchbook szkicu jest technicznie dostępny pod nieodgadywalnym adresem — akceptowalne (dokument i tak ma zostać opublikowany).

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
| `--color-highlight` | `#a57a2c` | `#a57a2c` (wspólny akcent marki) |

Nagłówek: logotyp tekstowy „Steel Valley Competitions”, link „Zawody” (`/`). Stopka: link do https://steel-valley.pl.
Panel ma ten sam układ, z menu panelu zamiast nawigacji publicznej.

### 6.2 Ekrany

| Adres | Generowanie | Zawartość |
| --- | --- | --- |
| `/` | statycznie przy budowaniu | Nagłówek „Nadchodzące zawody”, karty (AC-35/36) |
| `/zawody/<slug>/` | statycznie, `getStaticPaths` z opublikowanych | AC-38…41 |
| `/panel/` | statyczna strona + wyspa (dane w przeglądarce) | logowanie / brak uprawnień / lista zawodów, przycisk „Nowe zawody”, „Odśwież stronę publiczną” |
| `/panel/zawody/nowe/`, `/panel/zawody/edytuj/?id=<uuid>` | wyspa | formularz zawodów + harmonogram + matchbook; przyciski „Zapisz”, „Opublikuj” / „Cofnij publikację”, „Podgląd”, „Usuń zawody” (tylko szkic) |
| `/panel/zawody/podglad/?id=<uuid>` | wyspa | ten sam komponent co strona zawodów + pasek podglądu (AC-24) |
| `/panel/regulaminy/` | wyspa | formularz wczytania + lista (AC-12…16) |
| `/panel/dyscypliny/` | wyspa | formularz dodania + lista z edycją nazwy i „Ukryj”/„Przywróć” |

Strony `/panel/**` mają `<meta name="robots" content="noindex">`. Po zapisie formularza: komunikat „Zapisano.”;
błąd sieci/serwera: „Nie udało się zapisać. Spróbuj ponownie.”. Usuwanie i cofanie publikacji wymagają potwierdzenia
(„Czy na pewno usunąć zawody „<nazwa>”? Tej operacji nie można cofnąć.”).

Formularz zawodów — pola: Nazwa*, Dyscyplina* (lista), Data początku*, Data końca (opcjonalnie, „dla zawodów wielodniowych”),
Opis, Regulamin (lista z biblioteki, „— wybierz —”), Matchbook (PDF, opcjonalnie), Harmonogram (tabela: Dzień, Godzina, Opis, + „Dodaj punkt”).
Na telefonie harmonogram jako lista kart; dzień domyślnie = data początku.

Format dat w UI: `14 czerwca 2027`, zakres w tym samym miesiącu `14–15 czerwca 2027`, różne miesiące `30 czerwca – 1 lipca 2027` (`Intl`, `pl-PL`).

## 7. Przypadki brzegowe

- Dwa szkice o tej samej nazwie i dacie → różne `slug` (sufiks `-2`).
- Zmiana nazwy opublikowanych zawodów → `slug` bez zmian (linki w mediach społecznościowych działają).
- Regulamin używany przez zawody → nie da się go usunąć (FK `restrict` + brak przycisku).
- Zarchiwizowany regulamin w opublikowanych zawodach → nadal widoczny publicznie.
- Ukryta dyscyplina w istniejących zawodach → nadal pokazywana; przy edycji takich zawodów lista zawiera aktywne + bieżącą.
- Przebudowa nie powiodła się (błąd workflowu / brak tokenu) → dane w bazie są poprawne, panel pokazuje „Nie udało się uruchomić odświeżenia strony. Spróbuj „Odśwież stronę publiczną” za chwilę.”; przebudowa nocna i tak to naprawi.
- Budowanie przy niedostępnym Supabase → build kończy się błędem (nie publikujemy pustej listy zawodów zamiast prawdziwej).
- Zawody „dziś” → widoczne na liście przez cały dzień (porównanie dat w Europe/Warsaw).
- Usunięcie konta organizatora → `created_by` = `null`, zawody zostają.

## 8. Integracje

- **Supabase Auth — Google**: dostawca OAuth Google włączony w obu projektach; adresy przekierowań: produkcja, staging, `http://localhost:4321`. Konfiguruje właściciel (owner-task).
- **Storage**: sekcja 5.
- **Edge Function `site-rebuild`** (ADR-0003): weryfikuje JWT i `is_organizer()`, wywołuje GitHub API
  `POST /repos/rkazmier/sv-competitions/actions/workflows/rebuild-site.yml/dispatches` z `ref: main` i `inputs.target` = wartość sekretu `SITE_ENV` (`staging` / `production`).
  Sekrety Supabase: `GITHUB_DISPATCH_TOKEN` (fine-grained PAT, tylko to repo, uprawnienie *Actions: Read and write*), `SITE_ENV`. Token nigdy nie trafia do logów ani odpowiedzi.
- **Workflow `rebuild-site.yml`**: wyzwalacze `workflow_dispatch` (input `target`) i `schedule` (codziennie 22:30 UTC i 23:30 UTC — jeden z nich wypada o 00:30 czasu polskiego niezależnie od czasu letniego; drugi jest nieszkodliwy). Bez migracji i funkcji, tylko build + publikacja frontendu. `concurrency: rebuild-site-<target>`, `cancel-in-progress: true`.
- **Build Astro**: pobiera dane kluczem publishable (RLS gwarantuje, że widzi tylko opublikowane).

## 9. RODO

- Dane osobowe: adres e-mail i identyfikator konta Google w `auth.users` (zarządza Supabase Auth), powiązanie `profiles.id`, `created_by` w zawodach i regulaminach.
- Cel: uwierzytelnienie organizatora i rozliczalność zmian. Dostęp: właściciel konta (własny profil), właściciel projektu (panel Supabase).
- Publicznie nie jest widoczna żadna dana osobowa (`created_by` wyłączone z odczytu publicznego; nazwy plików PDF losowe).
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
