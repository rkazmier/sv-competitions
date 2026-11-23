# SPEC-011: Publiczna strona polityki prywatności

- Status: szkic (merge = zatwierdzenie, **także zatwierdzenie treści polityki z sekcji 12**)
- Issue z pomysłem: #153
- Powiązane: #39 (teksty prawne), #154 (regulamin sprzedaży), SPEC-002 (klauzula), SPEC-003, SPEC-004, SPEC-005, SPEC-009
- Zadania: #155, #156 (sekcja 11)

## 1. Cel

Serwis events.steel-valley.pl ma stały, publiczny adres z polityką prywatności: `/polityka-prywatnosci/`.
Odsyła do niej regulamin sprzedaży (§ 12 ust. 1), stopka każdej strony i klauzula przy rejestracji.
Dziś informacja o danych jest widoczna tylko w klauzuli przy rejestracji i pierwszym logowaniu.

## 2. Zakres

**W zakresie:**
- Strona `/polityka-prywatnosci/` (strona statyczna, `BaseLayout`) z treścią z sekcji 12, 1:1.
- Link „Polityka prywatności” w stopce każdej strony z `BaseLayout`.
- Zmiana klauzuli `privacy.body` tak, by mówiła to samo co polityka (decyzja 4A): GitHub jako odbiorca,
  Tpay i Google jako odrębni administratorzy, e-maile wysyłane przez Supabase (sekcja 12.2).
- Link „Polityka prywatności” pod klauzulą w `PrivacyNotice` (rejestracja, potwierdzenie klauzuli w `/konto/`).
- Link z § 12 ust. 1 regulaminu sprzedaży — osobne zadanie po #154 (treści regulaminu nie ma jeszcze w repo).

**Poza zakresem:**
- Baner zgody na cookies — aplikacja nie używa cookies ani analityki (sekcja 9).
- Wersja angielska (teksty w i18n, gotowe do tłumaczenia).
- Historia wersji polityki i archiwum poprzednich treści.
- Ponowne potwierdzanie klauzuli przez istniejące konta po jej zmianie (`privacy_notice_ack_at` bez zmian).
- Link pod tekstem klauzuli w `/panel/ksiazka/` (`PrivacyNoticeText`, wpis osoby bez konta) — ekran przekazany
  osobie wpisywanej, wyjście z niego przerwałoby wpis. Tekst klauzuli zmienia się tam razem z `privacy.body`.
- Zmiany w bazie, RLS, Edge Functions.
- Aktualizacja polityki po przejściu na własny SMTP (#40) — przy tamtej zmianie.

## 3. Role i uprawnienia

| Rola | Widzi | Może zmienić |
| --- | --- | --- |
| Każdy (gość, użytkownik, Obsługa, admin) | `/polityka-prywatnosci/` | — |
| Właściciel | — | Treść tylko przez PR (merge = zatwierdzenie) |

## 4. Historyjki i kryteria akceptacji

### US-1: Jako odwiedzający chcę przeczytać politykę prywatności pod stałym adresem
- **AC-1**: Given dowolna osoba (bez logowania) When otwiera `/polityka-prywatnosci/` Then widzi nagłówek „Polityka prywatności”, wiersz „Obowiązuje od: <data>” i treść z sekcji 12.1 z nagłówkami punktów 1–11 w tej kolejności.
- **AC-2**: Given strona polityki When ją oglądam Then linki do polityk prywatności Tpay, Google i GitHub otwierają się w nowej karcie (`target="_blank"`, `rel="noopener noreferrer"`), a adres e-mail administratora to link `mailto:`.
- **AC-3**: Given strona jest budowana When działa `npm run build` Then strona powstaje bez danych z bazy (tekst z i18n) i jest zwykłą stroną publiczną (indeksowaną, bez `noindex`).
- **AC-4**: Given data „Obowiązuje od” When Implementator otwiera PR publikujący stronę Then wpisuje datę otwarcia PR-a w stałej i18n (`privacyPolicy.effectiveDate`, format `D miesiąca RRRR`, np. „23 listopada 2026”) i podaje ją w opisie PR-a; jeśli merge jest innego dnia, właściciel przed merge'em prosi o poprawkę komentarzem `@claude` albo akceptuje datę (decyzja 5A).

### US-2: Jako odwiedzający chcę dojść do polityki z każdej strony
- **AC-5**: Given dowolna strona z `BaseLayout` (kalendarz, oferta, strona zawodów, `/konto/`, `/rejestracja/`, `/regulamin-sprzedazy/` itd.) When przewijam do stopki Then widzę link „Polityka prywatności” → `/polityka-prywatnosci/`.
- **AC-6**: Given stopka na telefonie (szerokość 360 px) When ją oglądam Then linki zawijają się bez poziomego przewijania, każdy ma obszar dotyku ≥ `--tap-target`.

### US-3: Jako zakładający konto chcę, żeby klauzula była zgodna z polityką
- **AC-7**: Given `/rejestracja/` (okno „Informacja o przetwarzaniu danych”) albo potwierdzenie klauzuli w `/konto/` When czytam klauzulę Then pod jej tekstem jest link „Polityka prywatności” otwierany w nowej karcie (formularz rejestracji nie traci wpisanych danych).
- **AC-8**: Given klauzula `privacy.body` When ją czytam Then akapit o odbiorcach ma treść z sekcji 12.2 (GitHub, Supabase z wysyłką e-maili, Tpay i Google jako odrębni administratorzy); pozostałe akapity są bez zmian.
- **AC-9**: Given `/panel/ksiazka/` (wpis osoby bez konta) When pokazuje klauzulę Then pokazuje nowy tekst `privacy.body`, bez linku do polityki.

### US-4: Jako kupujący chcę przejść z regulaminu sprzedaży do polityki
- **AC-10**: Given `/regulamin-sprzedazy/` z ostateczną treścią (#154) When czytam § 12 ust. 1 Then słowa „polityka prywatności” (w odmianie z tekstu regulaminu) są linkiem do `/polityka-prywatnosci/`; treść regulaminu poza linkiem bez zmian.

## 5. Model danych

Bez zmian w bazie. Nowe teksty w `web/src/i18n/pl.ts`:

| Klucz | Zawartość |
| --- | --- |
| `privacyPolicy.title` | „Polityka prywatności” |
| `privacyPolicy.effectiveDate` | Data z AC-4, np. „23 listopada 2026” |
| `privacyPolicy.effectiveFrom` | „Obowiązuje od: {date}” |
| `privacyPolicy.sections` | Punkty 1–11 z sekcji 12.1: nagłówek + akapity (struktura do wyboru Implementatora, np. tablica `{ heading, body }` z akapitami rozdzielonymi pustą linią jak w `privacy.body`) |
| `privacyPolicy.link` | „Polityka prywatności” (stopka, link pod klauzulą) |
| `privacy.body` | Akapit „Odbiorcy danych” podmieniony na sekcję 12.2 |

Linki w treści (adresy polityk Tpay, Google, GitHub; `mailto:`) — Implementator renderuje je jako `<a>`
(np. znaczniki w tekście zamieniane na linki w komponencie, bez `set:html` z niezaufanych danych — teksty są w repo).

## 6. Interfejs użytkownika

| Miejsce | Zmiana |
| --- | --- |
| `web/src/pages/polityka-prywatnosci/index.astro` | Nowa strona: `h1` „Polityka prywatności”, „Obowiązuje od: …”, punkty 1–11 jako `h2` + akapity; szerokość tekstu jak `/regulamin-sprzedazy/` |
| `SiteFooter.astro` | Link „Polityka prywatności” obok „Strzelnica Steel Valley — steel-valley.pl”, ten sam styl |
| `PrivacyNotice.astro` | Pod tekstem klauzuli `<p><a href="/polityka-prywatnosci/" target="_blank" rel="noopener">Polityka prywatności</a></p>` |
| `pl.ts` → `privacy.body` | Nowy akapit „Odbiorcy danych” (12.2) |
| `/regulamin-sprzedazy/` (po #154) | Link w § 12 ust. 1 (AC-10) |

Telefon: zwykły tekst, nagłówki punktów jako `h2`, bez tabel.

## 7. Przypadki brzegowe

- Merge innego dnia niż otwarcie PR-a → AC-4 (właściciel poprawia lub akceptuje datę).
- Zmiana dostawcy (np. własny SMTP w #40, inny hosting) → zmiana polityki, klauzuli i daty „Obowiązuje od” w PR-ze tej zmiany.
- Adres polityki Tpay zmieni się po stronie Tpay → link prowadzi na stronę błędu; poprawka PR-em (adres sprawdzić przy implementacji, sekcja 8).
- Regulamin sprzedaży z #154 nie zawiera słów „polityka prywatności” w § 12 ust. 1 → zadanie z AC-10 zadaje pytanie właścicielowi zamiast zgadywać.
- `PrivacyNotice` w `/konto/` (blokujące potwierdzenie klauzuli) → link w nowej karcie, potwierdzenie „Rozumiem” bez zmian.

## 8. Integracje

Brak. Linki zewnętrzne (Implementator sprawdza, że odpowiadają 200, i podaje je w opisie PR-a):
- Google: `https://policies.google.com/privacy?hl=pl`
- GitHub: `https://docs.github.com/pl/site-policy/privacy-policies/github-general-privacy-statement`
- Tpay: polityka prywatności z oficjalnej strony tpay.com (link ze stopki tpay.com, wersja polska).

## 9. RODO

- Strona sama nie zbiera danych. Stan faktyczny opisany w polityce (sprawdzony w kodzie):
  - cookies — brak; analityka — brak; fonty lokalne;
  - `localStorage` `sv-auth` (sesja logowania Supabase, w tym kod PKCE) — do wylogowania lub wygaśnięcia sesji;
  - `sessionStorage` `sv-duty-link` (SPEC-009) — do zamknięcia karty lub wylogowania;
  - GitHub Pages otrzymuje adres IP i dane techniczne przeglądarki przy każdym wyświetleniu strony;
  - e-maile (potwierdzenie konta, reset hasła) wysyła Supabase (#40 niezrealizowane);
  - przy logowaniu przez Google Supabase zapisuje e-mail i dane profilu Google (imię i nazwisko, zdjęcie) w danych logowania.
- Baner zgody nie jest potrzebny: zapis w pamięci przeglądarki jest niezbędny do świadczenia usługi żądanej przez użytkownika (logowanie).
- Opis Tpay i Google jako odrębnych administratorów (decyzja 3A) — **zalecany przegląd przez prawnika przed publikacją**.

## 10. Decyzje i pytania

| Pytanie | Decyzja właściciela | Data |
| --- | --- | --- |
| GitHub jako odbiorca danych (hosting, IP) | 1A — tak, wymienić w polityce | 2026-11-23 (#153) |
| Kto wysyła e-maile | 2A — Supabase (stan obecny); aktualizacja po #40 | 2026-11-23 (#153) |
| Tpay i Google | 3A — odrębni administratorzy, z linkami do ich polityk | 2026-11-23 (#153) |
| Klauzula przy rejestracji | 4A — mówi to samo co polityka, pod klauzulą link | 2026-11-23 (#153) |
| Data „Obowiązuje od” | 5A — data merge'a PR-a publikującego; Implementator wpisuje ją w PR | 2026-11-23 (#153) |

Założenia analityka (zatwierdzane razem ze specyfikacją): bez linku pod klauzulą w `/panel/ksiazka/`;
istniejące konta nie potwierdzają klauzuli ponownie; linki zewnętrzne i link pod klauzulą w nowej karcie;
okres przechowywania danych z logów serwera GitHub — według polityki GitHub (nie mamy na niego wpływu).

Otwarte: brak.

## 11. Zadania

1. #155 Strona `/polityka-prywatnosci/` z treścią 12.1, link w stopce, nowy akapit klauzuli 12.2, link pod klauzulą,
   testy Vitest (treść, kolejność punktów, nowy akapit klauzuli) i E2E (strona, stopka, link w oknie klauzuli) — AC-1…AC-9.
2. #156 Link do polityki w § 12 ust. 1 regulaminu sprzedaży — AC-10. **Po #154.**

## 12. Treść

Implementator przenosi tekst 1:1. Nawiasy `[link: …]` oznaczają link do podanego adresu (sekcja 8), tekst linku to słowa przed nawiasem.

### 12.1 Polityka prywatności

**Polityka prywatności**

Obowiązuje od: {data z AC-4}

**1. Kto jest administratorem danych**

Administratorem Twoich danych osobowych jest Rafał Kaźmierowski, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219 (dalej: Steel Valley), prowadzący serwis events.steel-valley.pl. W sprawach danych osobowych napisz na adres rkazmierowski@gmail.com [link: mailto:rkazmierowski@gmail.com]. Nie wyznaczyliśmy inspektora ochrony danych.

Polityka dotyczy serwisu events.steel-valley.pl: kalendarza zawodów, kont, zakupów wejść, karnetów i wejściówek oraz elektronicznej książki rejestru pobytu na strzelnicy.

**2. Jakie dane przetwarzamy**

Przetwarzamy: imię i nazwisko, adres e-mail, numer telefonu (dobrowolnie), numer decyzji o pozwoleniu na broń wraz z organem wydającym albo adres zamieszkania, podpis złożony przy wpisie do książki, a jeśli prosisz o fakturę — NIP, nazwę i adres firmy. Przetwarzamy też historię zamówień i płatności, historię wejść na strzelnicę oraz dane techniczne: adres IP i informacje o przeglądarce przy wyświetlaniu stron i logowaniu. Nie zbieramy numeru PESEL ani daty urodzenia.

Jeśli logujesz się przez Google, otrzymujemy od Google adres e-mail oraz dane profilu Google (imię i nazwisko, zdjęcie profilowe), zapisywane w danych logowania.

Osoba wpisywana do książki bez konta podaje wyłącznie dane potrzebne do wpisu i podpis — nie zapisujemy ich nigdzie poza książką.

**3. W jakich celach i na jakiej podstawie**

(1) Prowadzenie konta, logowanie (także przez Google) i wysyłanie wiadomości związanych z kontem (potwierdzenie adresu e-mail, zmiana hasła) — na podstawie umowy o prowadzenie konta (art. 6 ust. 1 lit. b RODO).

(2) Sprzedaż wejść, karnetów i wejściówek oraz obsługa płatności i zwrotów — na podstawie umowy (art. 6 ust. 1 lit. b RODO).

(3) Prowadzenie książki rejestru pobytu na strzelnicy — w wykonaniu obowiązku prawnego ciążącego na strzelnicy (art. 6 ust. 1 lit. c RODO).

(4) Wystawianie faktur i przechowywanie dokumentacji księgowej — obowiązek prawny (art. 6 ust. 1 lit. c RODO).

(5) Zapewnienie bezpieczeństwa serwisu, rozliczalność zmian danych oraz ustalenie, dochodzenie lub obrona roszczeń — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).

**4. Czy musisz podać dane**

Podanie imienia i nazwiska oraz numeru decyzji z organem albo adresu zamieszkania jest warunkiem wpisu do książki, a więc wejścia na strzelnicę. Podanie adresu e-mail jest warunkiem założenia konta. Dane do faktury są potrzebne, jeśli chcesz otrzymać fakturę. Pozostałe dane są dobrowolne.

**5. Komu przekazujemy dane**

Dostawcy usług, z których korzystamy w naszym imieniu:
- Supabase — hosting bazy danych, logowania i plików (serwery w Unii Europejskiej, Frankfurt) oraz wysyłka wiadomości e-mail z serwisu;
- GitHub — hosting stron serwisu; przy każdym wyświetleniu strony otrzymuje adres IP i informacje o przeglądarce. Polityka prywatności GitHub [link: GitHub].

Odrębni administratorzy, którzy przetwarzają dane na podstawie własnych zasad:
- Tpay (Krajowy Integrator Płatności S.A.) — w zakresie obsługi płatności i zwrotów; otrzymuje imię i nazwisko oraz e-mail płatnika. Polityka prywatności Tpay [link: Tpay];
- Google — w zakresie konta Google, jeśli logujesz się przez Google. Polityka prywatności Google [link: Google].

Dane mogą też otrzymać uprawnione organy państwowe, gdy wynika to z przepisów.

**6. Przekazywanie danych poza EOG**

Dostawcy (Supabase, GitHub, Google) mogą mieć dostęp do danych z państw spoza Europejskiego Obszaru Gospodarczego (EOG), w szczególności z USA. Odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o adekwatności (EU–US Data Privacy Framework).

**7. Jak długo przechowujemy dane**

- Dane konta — do czasu usunięcia konta.
- Wpisy w książce rejestru pobytu wraz z podpisem — 1 rok od dnia wpisu, potem są automatycznie usuwane.
- Historia zmian danych — 1 rok.
- Zamówienia i dane do faktur — 5 lat od końca roku, w którym dokonano zakupu (przepisy podatkowe).
- Dane techniczne w logach serwera hostingu stron — według zasad GitHub.

**8. Twoje prawa**

Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, przenoszenia danych oraz wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Usunięcie danych nie obejmuje danych, które musimy przechowywać z mocy prawa (książka, faktury) — do końca okresu ich przechowywania. Aby skorzystać z praw lub usunąć konto, napisz na adres z punktu 1.

Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).

**9. Pliki cookies i pamięć przeglądarki**

Serwis nie używa plików cookies ani narzędzi analitycznych i reklamowych. Po zalogowaniu zapisujemy w pamięci Twojej przeglądarki (localStorage) dane sesji logowania, aby nie trzeba było logować się na każdej stronie — do wylogowania lub wygaśnięcia sesji. Osobom prowadzącym strzelanie zapisujemy też w pamięci karty przeglądarki (sessionStorage) informację, czy pełnią dziś dyżur — do zamknięcia karty lub wylogowania. Te dane są niezbędne do działania serwisu i nie są wykorzystywane do śledzenia.

**10. Zautomatyzowane decyzje**

Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowaniu.

**11. Zmiany polityki**

Gdy zmienimy sposób przetwarzania danych (np. dostawców usług), zaktualizujemy tę politykę i datę „Obowiązuje od”.

### 12.2 Klauzula `privacy.body` — nowy akapit „Odbiorcy danych”

Zastępuje cały akapit zaczynający się od „Odbiorcy danych:”:

> Odbiorcy danych: dostawcy usług, z których korzystamy w naszym imieniu — hosting bazy danych, logowania i plików oraz wysyłka wiadomości e-mail (Supabase, serwery w Unii Europejskiej, Frankfurt) i hosting stron serwisu (GitHub — otrzymuje adres IP i informacje o przeglądarce przy wyświetlaniu stron). Odrębnymi administratorami danych są: Tpay (Krajowy Integrator Płatności S.A.) w zakresie obsługi płatności — otrzymuje imię i nazwisko oraz e-mail płatnika, oraz Google w zakresie konta Google, jeśli logujesz się przez Google. Dane mogą też otrzymać uprawnione organy państwowe, gdy wynika to z przepisów. Dostawcy mogą mieć dostęp do danych z państw spoza Europejskiego Obszaru Gospodarczego (EOG); odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o adekwatności (EU–US Data Privacy Framework). Szczegóły: polityka prywatności na events.steel-valley.pl/polityka-prywatnosci/.
