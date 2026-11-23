/**
 * Teksty interfejsu — wersja polska (SPEC-001 AC-3).
 * Każdy tekst widoczny dla użytkownika pochodzi stąd (przez `t()` z ./index.ts).
 * Wersja angielska: plik `en.ts` o tej samej strukturze (typ `Dictionary`).
 * Parametry w tekstach: `{nazwa}`.
 */
export const pl = {
  site: {
    name: 'Steel Valley Competitions',
    description: 'Kalendarz zawodów i wydarzeń na strzelnicy Steel Valley.',
  },
  layout: {
    skipLink: 'Przejdź do treści',
    homeLabel: 'Steel Valley Competitions — strona główna',
    navLabel: 'Nawigacja główna',
    panelMenuLabel: 'Menu panelu',
  },
  nav: {
    calendar: 'Kalendarz',
    offer: 'Oferta',
    signIn: 'Zaloguj się',
    account: 'Moje konto',
    panel: 'Panel',
    rangeLog: 'Książka',
  },
  auth: {
    emailLabel: 'E-mail',
    passwordLabel: 'Hasło',
    password2Label: 'Powtórz hasło',
    newPasswordLabel: 'Nowe hasło',
    passwordHint: 'Co najmniej {min} znaków.',
    or: 'albo',
    google: 'Kontynuuj z Google',
    emailInvalid: 'Podaj poprawny adres e-mail.',
    passwordTooShort: 'Hasło musi mieć co najmniej {min} znaków.',
    passwordMismatch: 'Hasła nie są takie same.',
    rateLimited: 'Za dużo prób. Spróbuj ponownie za kilka minut.',
    genericError: 'Coś poszło nie tak. Spróbuj ponownie.',
    registerTitle: 'Załóż konto',
    privacyAck: 'Zapoznałem(-am) się z informacją o przetwarzaniu danych osobowych',
    privacyLink: 'Informacja o przetwarzaniu danych',
    register: 'Załóż konto',
    checkInbox: 'Sprawdź skrzynkę e-mail i kliknij link, aby potwierdzić konto.',
    haveAccount: 'Masz konto? Zaloguj się',
    loginTitle: 'Zaloguj się',
    signIn: 'Zaloguj się',
    invalidCredentials: 'Nieprawidłowy e-mail lub hasło.',
    emailNotConfirmed: 'Potwierdź adres e-mail — link wysłaliśmy w wiadomości po rejestracji.',
    resend: 'Wyślij link ponownie',
    resent: 'Wysłaliśmy nowy link. Sprawdź skrzynkę e-mail.',
    forgotPassword: 'Nie pamiętam hasła',
    resetIntro: 'Podaj e-mail konta — wyślemy link do zmiany hasła.',
    sendResetLink: 'Wyślij link',
    resetSent: 'Jeśli konto istnieje, wysłaliśmy link do zmiany hasła.',
    noAccount: 'Załóż konto',
    newPasswordTitle: 'Nowe hasło',
    savePassword: 'Zapisz hasło',
    passwordSaved: 'Hasło zostało zmienione.',
    linkInvalid: 'Link do zmiany hasła wygasł lub jest nieprawidłowy. Poproś o nowy na stronie logowania.',
    goToLogin: 'Przejdź do logowania',
    goToAccount: 'Przejdź do swojego konta',
  },
  privacy: {
    title: 'Informacja o przetwarzaniu danych osobowych',
    // Klauzula informacyjna RODO (#39) — projekt; akapity rozdziela pusta linia. Bez IOD (decyzja 2A w #39).
    body:
      'Administratorem Twoich danych osobowych jest Rafał Kaźmierowski, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219 (dalej: Steel Valley). Kontakt w sprawach danych osobowych: rkazmierowski@gmail.com.\n\n' +
      'Przetwarzamy Twoje dane w następujących celach: (1) prowadzenie konta w serwisie events.steel-valley.pl i sprzedaż wejść, karnetów i wejściówek — na podstawie umowy (art. 6 ust. 1 lit. b RODO); (2) prowadzenie książki rejestru pobytu na strzelnicy — w wykonaniu obowiązku prawnego ciążącego na strzelnicy (art. 6 ust. 1 lit. c RODO); (3) wystawianie faktur i przechowywanie dokumentacji księgowej — obowiązek prawny (art. 6 ust. 1 lit. c RODO); (4) zapewnienie bezpieczeństwa serwisu i rozliczalności zmian danych oraz ustalenie, dochodzenie lub obrona roszczeń — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).\n\n' +
      'Przetwarzamy: imię i nazwisko, adres e-mail, numer telefonu (dobrowolnie), numer decyzji o pozwoleniu na broń wraz z organem wydającym albo adres zamieszkania, podpis złożony przy wpisie do książki, a jeśli prosisz o fakturę — NIP, nazwę i adres firmy. Nie zbieramy numeru PESEL ani daty urodzenia. Osoba wpisywana do książki bez konta podaje wyłącznie dane potrzebne do wpisu i podpis — nie zapisujemy ich nigdzie poza książką.\n\n' +
      'Podanie imienia i nazwiska oraz numeru decyzji z organem albo adresu zamieszkania jest warunkiem wpisu do książki, a więc wejścia na strzelnicę. Podanie adresu e-mail jest warunkiem założenia konta. Pozostałe dane są dobrowolne.\n\n' +
      // Akapit „Odbiorcy danych” — SPEC-011 §12.2 (decyzja 4A w #153: klauzula mówi to samo co polityka).
      'Odbiorcy danych: dostawcy usług, z których korzystamy w naszym imieniu — hosting bazy danych, logowania i plików oraz wysyłka wiadomości e-mail (Supabase, serwery w Unii Europejskiej, Frankfurt) i hosting stron serwisu (GitHub — otrzymuje adres IP i informacje o przeglądarce przy wyświetlaniu stron). Odrębnymi administratorami danych są: Tpay (Krajowy Integrator Płatności S.A.) w zakresie obsługi płatności — otrzymuje imię i nazwisko oraz e-mail płatnika, oraz Google w zakresie konta Google, jeśli logujesz się przez Google. Dane mogą też otrzymać uprawnione organy państwowe, gdy wynika to z przepisów. Dostawcy mogą mieć dostęp do danych z państw spoza Europejskiego Obszaru Gospodarczego (EOG); odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o adekwatności (EU–US Data Privacy Framework). Szczegóły: polityka prywatności na events.steel-valley.pl/polityka-prywatnosci/.\n\n' +
      'Okres przechowywania: dane konta — do czasu usunięcia konta; wpisy w książce rejestru pobytu wraz z podpisem — 1 rok od dnia wpisu, potem są automatycznie usuwane; historia zmian danych — 1 rok; zamówienia i dane do faktur — 5 lat od końca roku, w którym dokonano zakupu (przepisy podatkowe).\n\n' +
      'Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, przenoszenia danych oraz wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Usunięcie danych nie obejmuje danych, które musimy przechowywać z mocy prawa (książka, faktury) — do końca okresu ich przechowywania. Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).\n\n' +
      'Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowaniu.',
    close: 'Zamknij',
    ackIntro: 'Zanim przejdziesz dalej, zapoznaj się z informacją o przetwarzaniu danych osobowych.',
    ack: 'Rozumiem',
  },
  privacyPolicy: {
    title: 'Polityka prywatności',
    // Data otwarcia PR-a publikującego stronę (SPEC-011 AC-4, decyzja 5A w #153). Zmiana polityki = nowa data.
    effectiveDate: '23 listopada 2026',
    effectiveFrom: 'Obowiązuje od: {date}',
    link: 'Polityka prywatności',
    // Punkty 1–11 polityki (SPEC-011 §12.1) 1:1. Format jak `salesTerms.body` (`## ` = nagłówek punktu,
    // `- ` = lista, pusta linia = nowy blok) oraz `[tekst](adres)` = link (`privacyPolicyBlocks`, lib/privacy-policy.ts).
    sections: String.raw`## 1. Kto jest administratorem danych

Administratorem Twoich danych osobowych jest Rafał Kaźmierowski, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219 (dalej: Steel Valley), prowadzący serwis events.steel-valley.pl. W sprawach danych osobowych napisz na adres [rkazmierowski@gmail.com](mailto:rkazmierowski@gmail.com). Nie wyznaczyliśmy inspektora ochrony danych.

Polityka dotyczy serwisu events.steel-valley.pl: kalendarza zawodów, kont, zakupów wejść, karnetów i wejściówek oraz elektronicznej książki rejestru pobytu na strzelnicy.

## 2. Jakie dane przetwarzamy

Przetwarzamy: imię i nazwisko, adres e-mail, numer telefonu (dobrowolnie), numer decyzji o pozwoleniu na broń wraz z organem wydającym albo adres zamieszkania, podpis złożony przy wpisie do książki, a jeśli prosisz o fakturę — NIP, nazwę i adres firmy. Przetwarzamy też historię zamówień i płatności, historię wejść na strzelnicę oraz dane techniczne: adres IP i informacje o przeglądarce przy wyświetlaniu stron i logowaniu. Nie zbieramy numeru PESEL ani daty urodzenia.

Jeśli logujesz się przez Google, otrzymujemy od Google adres e-mail oraz dane profilu Google (imię i nazwisko, zdjęcie profilowe), zapisywane w danych logowania.

Osoba wpisywana do książki bez konta podaje wyłącznie dane potrzebne do wpisu i podpis — nie zapisujemy ich nigdzie poza książką.

## 3. W jakich celach i na jakiej podstawie

(1) Prowadzenie konta, logowanie (także przez Google) i wysyłanie wiadomości związanych z kontem (potwierdzenie adresu e-mail, zmiana hasła) — na podstawie umowy o prowadzenie konta (art. 6 ust. 1 lit. b RODO).

(2) Sprzedaż wejść, karnetów i wejściówek oraz obsługa płatności i zwrotów — na podstawie umowy (art. 6 ust. 1 lit. b RODO).

(3) Prowadzenie książki rejestru pobytu na strzelnicy — w wykonaniu obowiązku prawnego ciążącego na strzelnicy (art. 6 ust. 1 lit. c RODO).

(4) Wystawianie faktur i przechowywanie dokumentacji księgowej — obowiązek prawny (art. 6 ust. 1 lit. c RODO).

(5) Zapewnienie bezpieczeństwa serwisu, rozliczalność zmian danych oraz ustalenie, dochodzenie lub obrona roszczeń — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).

## 4. Czy musisz podać dane

Podanie imienia i nazwiska oraz numeru decyzji z organem albo adresu zamieszkania jest warunkiem wpisu do książki, a więc wejścia na strzelnicę. Podanie adresu e-mail jest warunkiem założenia konta. Dane do faktury są potrzebne, jeśli chcesz otrzymać fakturę. Pozostałe dane są dobrowolne.

## 5. Komu przekazujemy dane

Dostawcy usług, z których korzystamy w naszym imieniu:

- Supabase — hosting bazy danych, logowania i plików (serwery w Unii Europejskiej, Frankfurt) oraz wysyłka wiadomości e-mail z serwisu;
- GitHub — hosting stron serwisu; przy każdym wyświetleniu strony otrzymuje adres IP i informacje o przeglądarce. [Polityka prywatności GitHub](https://docs.github.com/pl/site-policy/privacy-policies/github-general-privacy-statement).

Odrębni administratorzy, którzy przetwarzają dane na podstawie własnych zasad:

- Tpay (Krajowy Integrator Płatności S.A.) — w zakresie obsługi płatności i zwrotów; otrzymuje imię i nazwisko oraz e-mail płatnika. [Polityka prywatności Tpay](https://tpay.com/polityka-prywatnosci);
- Google — w zakresie konta Google, jeśli logujesz się przez Google. [Polityka prywatności Google](https://policies.google.com/privacy?hl=pl).

Dane mogą też otrzymać uprawnione organy państwowe, gdy wynika to z przepisów.

## 6. Przekazywanie danych poza EOG

Dostawcy (Supabase, GitHub, Google) mogą mieć dostęp do danych z państw spoza Europejskiego Obszaru Gospodarczego (EOG), w szczególności z USA. Odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o adekwatności (EU–US Data Privacy Framework).

## 7. Jak długo przechowujemy dane

- Dane konta — do czasu usunięcia konta.
- Wpisy w książce rejestru pobytu wraz z podpisem — 1 rok od dnia wpisu, potem są automatycznie usuwane.
- Historia zmian danych — 1 rok.
- Zamówienia i dane do faktur — 5 lat od końca roku, w którym dokonano zakupu (przepisy podatkowe).
- Dane techniczne w logach serwera hostingu stron — według zasad GitHub.

## 8. Twoje prawa

Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, przenoszenia danych oraz wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Usunięcie danych nie obejmuje danych, które musimy przechowywać z mocy prawa (książka, faktury) — do końca okresu ich przechowywania. Aby skorzystać z praw lub usunąć konto, napisz na adres z punktu 1.

Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).

## 9. Pliki cookies i pamięć przeglądarki

Serwis nie używa plików cookies ani narzędzi analitycznych i reklamowych. Po zalogowaniu zapisujemy w pamięci Twojej przeglądarki (localStorage) dane sesji logowania, aby nie trzeba było logować się na każdej stronie — do wylogowania lub wygaśnięcia sesji. Osobom prowadzącym strzelanie zapisujemy też w pamięci karty przeglądarki (sessionStorage) informację, czy pełnią dziś dyżur — do zamknięcia karty lub wylogowania. Te dane są niezbędne do działania serwisu i nie są wykorzystywane do śledzenia.

## 10. Zautomatyzowane decyzje

Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowaniu.

## 11. Zmiany polityki

Gdy zmienimy sposób przetwarzania danych (np. dostawców usług), zaktualizujemy tę politykę i datę „Obowiązuje od”.`,
  },
  account: {
    title: 'Moje konto',
    signedInAs: 'Zalogowano jako {email}',
    signOut: 'Wyloguj się',
    loadError: 'Nie udało się wczytać konta. Odśwież stronę.',
    missingTitle: 'Co uzupełnić, aby wejść na strzelnicę',
    missingFullName: 'Imię i nazwisko',
    missingPermitOrAddress: 'Numer decyzji i organ wydający albo adres zamieszkania',
    completeData: 'Uzupełnij dane',
    ready: 'Gotowy do wpisu do książki',
    qrTitle: 'Twój kod QR',
    qrIntro: 'Pokaż ten kod obsłudze strzelnicy przy wejściu.',
    qrLabel: 'Kod QR konta',
    qrFullscreen: 'Pełny ekran',
    qrPrint: 'Drukuj',
    qrRotate: 'Wygeneruj nowy kod',
    qrRotateConfirm: 'Stary kod przestanie działać, także wydrukowany. Kontynuować?',
    qrRotated: 'Wygenerowano nowy kod. Stary przestał działać.',
    close: 'Zamknij',
    dataTitle: 'Twoje dane',
    editData: 'Edytuj dane',
    notProvided: 'nie podano',
  },
  rangeOfficerAccount: {
    add: 'Dodaj uprawnienia prowadzącego',
    formTitle: 'Uprawnienia prowadzącego',
    fullName: 'Imię i nazwisko',
    fullNameHint: 'Z „Twoje dane” — zmienisz je w „Edytuj dane”.',
    fullNameRequired: 'Uzupełnij imię i nazwisko w „Twoje dane”, aby dodać uprawnienia prowadzącego.',
    hide: 'Ukryj mnie dla innych',
    hideHint:
      'Obsługa znajdzie Cię tylko przez wyszukiwanie. Przy Twoim własnym wpisie do książki zawsze możesz wskazać siebie.',
    submit: 'Wyślij do zatwierdzenia',
    cancel: 'Anuluj',
    edit: 'Edytuj',
    remove: 'Usuń',
    removeConfirm: 'Usunąć uprawnienia prowadzącego? Dawne wpisy w książce się nie zmienią.',
    statusPending: 'Uprawnienia prowadzącego: czekają na zatwierdzenie',
    statusApproved: 'Uprawnienia prowadzącego: zatwierdzone',
    statusRejected:
      'Uprawnienia prowadzącego: odrzucone. Popraw dane i wyślij ponownie albo skontaktuj się z obsługą strzelnicy.',
    savedPending: 'Zapisano. Uprawnienia czekają na zatwierdzenie.',
    saved: 'Zapisano.',
    removed: 'Usunięto uprawnienia prowadzącego.',
    saveError: 'Nie udało się zapisać. Spróbuj ponownie.',
    loadError: 'Nie udało się wczytać uprawnień prowadzącego. Odśwież stronę.',
    dutyToday: 'Dziś jesteś dyżurnym Prowadzącym.',
    openRangeLog: 'Otwórz książkę rejestru pobytu',
  },
  offer: {
    title: 'Oferta',
    intro: 'Karnety i wejścia na strzelnicę Steel Valley. Płatność online przez Tpay.',
    loading: 'Wczytywanie oferty…',
    loadError: 'Nie udało się wczytać oferty. Odśwież stronę.',
    empty: 'Brak produktów w tej grupie.',
    validity: 'Ważny 1 rok od zakupu.',
    daysNote: 'Odliczanie dni zaczyna się od pierwszego wejścia.',
    weekendNote: 'Tylko w soboty i niedziele.',
    weekdayNote: 'Tylko od poniedziałku do piątku.',
    buy: 'Kup',
    buyLabel: 'Kup: {name}',
    orderTitle: 'Podsumowanie zamówienia',
    product: 'Produkt',
    price: 'Cena',
    validityLabel: 'Ważność',
    acceptTerms: 'Akceptuję',
    salesTermsLink: 'regulamin sprzedaży',
    termsVersion: '(obowiązuje od {date})',
    consent:
      'Chcę korzystać z karnetu przed upływem 14 dni na odstąpienie od umowy. Wiem, że po wykorzystaniu usługi w całości tracę prawo odstąpienia.',
    consentHint: 'Bez tej zgody kupisz karnet na strzelnicy.',
    ticketNoWithdrawal: 'Wejściówki na wydarzenia nie podlegają odstąpieniu od umowy.',
    checksRequired: 'Zaznacz wymagane pola (*), aby zamówić.',
    termsChanged: 'Regulamin sprzedaży właśnie się zmienił. Zapoznaj się z nową wersją i zaakceptuj ją ponownie.',
    consentRequired: 'Zaznacz zgodę na korzystanie przed upływem 14 dni.',
    discontinued: 'Ten produkt nie jest już w ofercie.',
    orderTerms: 'Regulamin z {date}',
    orderConsent: 'Zgoda na korzystanie przed upływem 14 dni: {date}',
    pay: 'Zamawiam i płacę {amount}',
    paying: 'Przekierowujemy do Tpay…',
    payError: 'Nie udało się rozpocząć płatności. Spróbuj ponownie.',
    unavailable: 'Ten produkt nie jest już dostępny.',
    backToOffer: 'Wróć do oferty',
    paymentTitle: 'Płatność',
    paymentWaiting: 'Czekamy na potwierdzenie płatności…',
    paymentSlow: 'Potwierdzenie może potrwać kilka minut. Sprawdź „Moje konto”.',
    paymentPaid: 'Płatność przyjęta. Karnet jest aktywny w Twoim koncie.',
    paymentNotFound: 'Nie znaleziono zamówienia.',
    paymentOrder: 'Zamówienie {number}',
    goToAccount: 'Moje konto',
    passesTitle: 'Twoje karnety',
    passesEmpty: 'Nie masz aktywnych karnetów.',
    renew: 'Przedłuż karnet',
    entriesLeft: 'Pozostałe wejścia: {left} z {total}',
    firstUsed: 'Pierwsze użycie: {date}',
    notUsedYet: 'Jeszcze nieużywany',
    validTo: 'Ważny do: {date}',
    notActivated: 'Nieaktywny — dni liczą się od pierwszego wejścia',
    passHistoryTitle: 'Historia karnetów',
    passHistoryEmpty: 'Brak karnetów w historii.',
    passUsedUp: 'Wykorzystany',
    passExpired: 'Wygasł',
    passCancelled: 'Anulowany',
    paymentsTitle: 'Historia płatności',
    paymentsEmpty: 'Brak płatności.',
    orderDate: 'Data',
    orderItem: 'Produkt',
    orderNumber: 'Nr: {number}',
    orderAmount: 'Kwota',
    orderMethod: 'Metoda',
    orderStatus: 'Status',
    methodOnline: 'Online',
    methodOnSite: 'Na miejscu',
    methodGift: 'Prezent',
    statusPaid: 'Opłacone',
    statusPending: 'Oczekuje',
    statusCancelled: 'Nieopłacone — anulowane',
    statusGiftCancelled: 'Anulowane',
    statusRefundPending: 'Zwrot w toku',
    statusRefunded: 'Zwrócone',
    // SPEC-012 AC-20: zwrot częściowy (odstąpienie od umowy).
    statusRefundedPartial: 'Zwrócone {refund} z {amount}',
    statusRefundPendingPartial: 'Zwrot w toku: {refund}',
    passesLoadError: 'Nie udało się wczytać karnetów i płatności. Odśwież stronę.',
    ticketName: 'Wejściówka: {name}',
    ticketValidity: 'Ważna w dniach wydarzenia: {dates}.',
    soldOut: 'Wejściówki zostały wyprzedane.',
  },
  invoice: {
    heading: 'Faktura',
    wanted: 'Potrzebuję faktury',
    nip: 'NIP',
    lookup: 'Pobierz dane firmy',
    looking: 'Szukam firmy w rejestrze…',
    invalidNip: 'Nieprawidłowy NIP.',
    foreignNip: 'Faktury dla firm zagranicznych — skontaktuj się ze strzelnicą.',
    notFound: 'Nie znaleźliśmy firmy w rejestrze. Wpisz dane ręcznie.',
    name: 'Nazwa',
    address: 'Adres',
    source: 'Źródło',
    sourceWhitelist: 'Biała lista VAT',
    sourceRegon: 'REGON',
    sourceManual: 'Dane niezweryfikowane (wpisane ręcznie)',
    lengthError: 'Wpisz od {min} do {max} znaków.',
    confirm: 'Dane są poprawne',
    confirmed: 'Dane do faktury potwierdzone.',
    edit: 'Zmień dane do faktury',
    confirmRequired: 'Potwierdź dane do faktury.',
    invalidDetails: 'Dane do faktury są nieprawidłowe. Sprawdź NIP, nazwę i adres.',
    statusPending: 'Faktura: w przygotowaniu',
    statusIssued: 'Faktura: {number}',
    profileHeading: 'Dane do faktury',
    profileIntro: 'Zapisane dane podpowiemy przy kolejnym zakupie. Zmiana nie wpływa na złożone zamówienia.',
    profileNone: 'Nie masz zapisanych danych do faktury.',
    profileSave: 'Zapisz dane do faktury',
    profileDelete: 'Usuń dane do faktury',
    profileDeleteConfirm: 'Usunąć zapisane dane do faktury?',
    profileSaved: 'Zapisano dane do faktury.',
    profileDeleted: 'Usunięto dane do faktury.',
    profileError: 'Nie udało się zapisać zmian. Spróbuj ponownie.',
    saleInvoiceError: 'Sprzedaż zarejestrowana, ale nie zapisano danych do faktury. Poproś admina o dodanie ich w zamówieniu.',
  },
  salesTerms: {
    title: 'Regulamin sprzedaży',
    effectiveFrom: 'Obowiązuje od: {date}',
    versionsHeading: 'Wersje regulaminu',
    versionItem: 'Obowiązuje od {date}',
    versionPdf: 'PDF',
    versionPdfLabel: 'Regulamin sprzedaży obowiązujący od {date} (PDF)',
    pdfHeading: 'Regulamin sprzedaży — obowiązuje od {date}',
    pdfPage: 'Strona {page} z {pages}',
    // Regulamin sprzedaży od właściciela (#154, SPEC-003 12-A) — treść 1:1 z komentarza w issue (Markdown).
    // Podzbiór Markdown opisuje `salesTermsBlocks` (lib/sales-terms.ts). Z tej treści powstaje też PDF wersji
    // (`npm run pdf:sales-terms`). Zmiana treści = nowa wersja z nową datą obowiązywania (SPEC-012).
    body: String.raw`# Regulamin sprzedaży

## § 1. Postanowienia ogólne

1. Regulamin określa zasady sprzedaży karnetów, wejść jednorazowych i wejściówek na wydarzenia na strzelnicy Steel Valley — online, przez zakładkę „Oferta” w serwisie events.steel-valley.pl, oraz na miejscu, w strzelnicy.
2. Sprzedawcą jest Rafał Kaźmierowski, prowadzący działalność gospodarczą pod firmą RAFAŁ KAŹMIEROWSKI, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219, REGON 368862966, wpisany do Centralnej Ewidencji i Informacji o Działalności Gospodarczej.
3. Kontakt ze Sprzedawcą: e-mail rkazmierowski@gmail.com, telefon 503 911 707, adres do korespondencji jak w ust. 2.
4. Strzelnica, na której realizowane są usługi, mieści się pod adresem Morawy Wielkie 67, 06-316.
5. Regulamin jest udostępniany nieodpłatnie pod adresem events.steel-valley.pl/regulamin-sprzedazy/ w sposób umożliwiający jego pobranie, utrwalenie i wydrukowanie.
6. Akceptacja Regulaminu jest warunkiem złożenia zamówienia online.

## § 2. Definicje

1. **Klient** — osoba fizyczna, osoba prawna lub jednostka organizacyjna nieposiadająca osobowości prawnej, która kupuje Produkt.
2. **Konsument** — Klient będący osobą fizyczną, który kupuje Produkt w celu niezwiązanym bezpośrednio z jego działalnością gospodarczą lub zawodową.
3. **Przedsiębiorca na prawach konsumenta** — osoba fizyczna prowadząca jednoosobową działalność gospodarczą, która kupuje Produkt w celu bezpośrednio związanym z tą działalnością, gdy z treści umowy wynika, że nie ma ona dla niej charakteru zawodowego (art. 38a ustawy o prawach konsumenta). Postanowienia Regulaminu dotyczące Konsumentów stosuje się do niej odpowiednio.
4. **Serwis** — aplikacja internetowa dostępna pod adresem events.steel-valley.pl.
5. **Konto** — konto Klienta w Serwisie, w którym widoczne są jego Uprawnienia, historia płatności i kod QR.
6. **Produkt** — usługa udostępnienia strzelnicy w postaci:
   1. **Karnetu ilościowego** — uprawnia do określonej liczby wejść na strzelnicę;
   2. **Wejścia jednorazowego** — uprawnia do jednego wejścia na strzelnicę w dniu weekendowym albo w dniu powszednim, zależnie od rodzaju;
   3. **Wejściówki** — uprawnia do udziału w wydarzeniu organizowanym przez Sprzedawcę w dniu lub dniach tego wydarzenia.
7. **Uprawnienie** — prawo do skorzystania z Produktu, powstające po opłaceniu zamówienia i przypisane do Konta.
8. **Wejście** — jeden pobyt na strzelnicy w danym dniu, potwierdzony wpisem do książki rejestru pobytu na strzelnicy.
9. **Regulamin strzelnicy** — regulamin użytkowania strzelnicy w miejscowości Morawy Wielkie, dostępny w Serwisie i na strzelnicy.
10. **Obsługa** — osoby działające w imieniu Sprzedawcy na strzelnicy, w tym prowadzący strzelanie.

## § 3. Wymagania techniczne i Konto

1. Do korzystania z Serwisu potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka internetowa z włączoną obsługą JavaScript i plików cookies niezbędnych do logowania oraz aktywny adres e-mail. Do skanowania kodu QR na strzelnicy przydatny jest telefon z ekranem.
2. Zakup online wymaga zalogowania się do Konta — przez konto Google albo adres e-mail.
3. Prowadzenie Konta jest nieodpłatne i trwa przez czas nieokreślony. Klient może w każdej chwili zażądać usunięcia Konta, pisząc na adres z § 1 ust. 3.
4. Przed usunięciem Konta Sprzedawca informuje Klienta o niewykorzystanych Uprawnieniach. Usunięcie Konta na żądanie Klienta oznacza rezygnację z niewykorzystanych Uprawnień. Dane zamówień i faktur są przechowywane zgodnie z § 12.
5. Klientowi nie wolno dostarczać przez Serwis treści o charakterze bezprawnym ani udostępniać Konta innym osobom.

## § 4. Produkty i ceny

1. Aktualna oferta, ceny i opisy Produktów są dostępne w zakładce „Oferta” oraz — dla Wejściówek — na kartach wydarzeń w kalendarzu Serwisu.
2. Ceny podawane są w złotych polskich i są cenami brutto, które Klient płaci; zawierają podatek VAT.
3. Wiążąca jest cena widoczna w podsumowaniu zamówienia w chwili kliknięcia przycisku zapłaty. Zmiana cen nie dotyczy zamówień złożonych wcześniej.
4. Każde Uprawnienie jest imienne — przysługuje wyłącznie właścicielowi Konta, na które zostało kupione, i nie może być przekazane innej osobie.
5. **Ważność.** Uprawnienie z Karnetu ilościowego albo Wejścia jednorazowego jest ważne 1 rok od dnia zakupu. Po tym terminie niewykorzystane Wejścia przepadają. Sprzedawca nie przedłuża ważności Uprawnień, chyba że Regulamin stanowi inaczej (ust. 9).
6. **Karnet ilościowy** — każde Wejście zmniejsza liczbę pozostałych Wejść o jedno.
7. **Wejście jednorazowe** jest ważne w dniu weekendowym (sobota, niedziela) albo w dniu powszednim (poniedziałek–piątek), zależnie od rodzaju wskazanego w ofercie. Święto przypadające w dniu powszednim traktuje się jak dzień powszedni.
8. **Wejściówka** jest ważna wyłącznie w dniu lub dniach wydarzenia, na które została kupiona, i obejmuje wszystkie dni tego wydarzenia. Liczba Wejściówek może być ograniczona limitem miejsc. Sprzedaż kończy się z upływem ostatniego dnia wydarzenia albo po wyczerpaniu miejsc.
9. Jeżeli strzelnica jest zamknięta z przyczyn leżących po stronie Sprzedawcy przez więcej niż 7 kolejnych dni, ważność Uprawnień przedłuża się o czas zamknięcia.
10. Uprawnienie nie stanowi rezerwacji stanowiska strzeleckiego w określonym terminie. Godziny otwarcia strzelnicy są publikowane w Serwisie. Karnety i Wejścia jednorazowe uprawniają do wejścia tylko wtedy, gdy na strzelnicy nie odbywają się wydarzenia ani zawody sportowe. W czasie wydarzenia lub zawodów, których terminy są podane w kalendarzu Serwisu, wstęp na strzelnicę jest możliwy wyłącznie na zasadach tego wydarzenia, w szczególności z Wejściówką.

## § 5. Zamówienie online

1. Aby złożyć zamówienie, Klient:
   1. loguje się do Konta;
   2. wybiera Produkt w zakładce „Oferta” albo przycisk „Kup wejściówkę” na karcie wydarzenia;
   3. w podsumowaniu sprawdza nazwę Produktu, cenę i ważność, opcjonalnie zaznacza „Potrzebuję faktury” i podaje dane do faktury;
   4. akceptuje Regulamin;
   5. klika przycisk „Zapłać” z podaną kwotą, co oznacza złożenie zamówienia z obowiązkiem zapłaty, i zostaje przekierowany do serwisu płatności Tpay.
2. Jedno zamówienie obejmuje jeden Produkt w ilości 1.
3. Umowa sprzedaży zostaje zawarta z chwilą złożenia zamówienia w sposób opisany w ust. 1 pkt 5.
4. Klient powinien opłacić zamówienie w ciągu 24 godzin od jego złożenia. Po tym terminie nieopłacone zamówienie jest anulowane, a umowa wygasa. W przypadku Wejściówki miejsce jest rezerwowane dla Klienta przez 30 minut od rozpoczęcia płatności.
5. Uprawnienie staje się aktywne niezwłocznie po otrzymaniu przez Sprzedawcę potwierdzenia płatności od Tpay. Status płatności i Uprawnienia Klient widzi w Koncie.
6. Potwierdzenie zawarcia umowy, wraz z treścią Regulaminu, Sprzedawca przekazuje Klientowi na trwałym nośniku — e-mailem na adres przypisany do Konta, z Regulaminem w formacie PDF w załączniku — niezwłocznie po otrzymaniu płatności. Potwierdzenie płatności wysyła Klientowi także Tpay.
7. Jeżeli wpłata wpłynie po anulowaniu zamówienia, Sprzedawca realizuje zamówienie albo — gdy nie jest to możliwe (np. brak miejsc na wydarzeniu) — zwraca wpłatę w terminie 14 dni.

## § 6. Płatności i faktury

1. Płatności online obsługuje Tpay — Krajowy Integrator Płatności S.A. z siedzibą w Poznaniu. Klient może wybrać każdą metodę płatności udostępnioną przez Tpay i wyświetloną w serwisie Tpay przy płatności, w szczególności BLIK, szybki przelew, kartę płatniczą i portfele elektroniczne.
2. Na strzelnicy można kupić Produkt gotówką albo kartą w terminalu płatniczym. Sprzedaż jest rejestrowana przez Obsługę w Serwisie, a Uprawnienie pojawia się w Koncie Klienta.
3. Osoba, która nie ma Konta, może kupić na miejscu wyłącznie Wejście jednorazowe ważne w dniu zakupu albo Wejściówkę na wydarzenie odbywające się w dniu zakupu. Takie Uprawnienie jest wykorzystywane w dniu zakupu i wygasa z jego końcem.
4. Fakturę wystawia się na żądanie Klienta zgłoszone przy zakupie (pole „Potrzebuję faktury” i NIP) albo po zakupie, na adres z § 1 ust. 3, w terminie wynikającym z przepisów o VAT. Faktury są wystawiane w Krajowym Systemie e-Faktur (KSeF) i udostępniane nabywcy przez KSeF.
5. Dane firmy do faktury Serwis może pobrać z publicznych rejestrów (Biała lista VAT, REGON) na podstawie podanego NIP. Klient odpowiada za poprawność danych wpisanych ręcznie.

## § 7. Korzystanie z Uprawnień

1. Wejście na strzelnicę wymaga wpisu do książki rejestru pobytu na strzelnicy, prowadzonej w formie elektronicznej, i potwierdzenia zapoznania się z Regulaminem strzelnicy. Klient okazuje Obsłudze kod QR z Konta albo podaje dane pozwalające go zidentyfikować.
2. Wpis do książki rejestru pobytu zużywa Uprawnienie wybrane przy wpisie: jedno Wejście z Karnetu ilościowego, Wejście jednorazowe albo dzień wydarzenia z Wejściówki.
3. Klient korzysta ze strzelnicy zgodnie z Regulaminem strzelnicy i poleceniami prowadzącego strzelanie. Sprzedawca nie stawia Klientom innych wymagań niż akceptacja Regulaminu strzelnicy i stosowanie się do niego.
4. Prowadzący strzelanie może odmówić wpuszczenia na strzelnicę albo usunąć z niej osobę, która narusza Regulamin strzelnicy lub zagraża bezpieczeństwu. W takim przypadku wykorzystane Wejście nie podlega zwrotowi.
5. Jeżeli Klient nie może skorzystać z Wejścia z przyczyn leżących po stronie Sprzedawcy (np. zamknięcie strzelnicy w godzinach otwarcia), Wejście nie jest zużywane.

## § 8. Prawo odstąpienia od umowy (Konsumenci)

1. Konsument, który kupił online Karnet ilościowy albo Wejście jednorazowe, może odstąpić od umowy bez podania przyczyny w terminie **14 dni od dnia jej zawarcia**.
2. Jeżeli Konsument wyraźnie zażąda rozpoczęcia świadczenia usługi przed upływem terminu na odstąpienie (pierwsze Wejście w tym terminie), a następnie odstąpi od umowy, zapłaci za usługi spełnione do chwili odstąpienia. Kwotę tę oblicza się proporcjonalnie: cena Karnetu ilościowego podzielona przez liczbę Wejść, pomnożona przez liczbę wykorzystanych Wejść.
3. Prawo odstąpienia nie przysługuje, gdy usługa została w pełni wykonana za wyraźną zgodą Konsumenta, który przed rozpoczęciem świadczenia został poinformowany, że po spełnieniu świadczenia utraci prawo odstąpienia (art. 38 ust. 1 pkt 1 ustawy o prawach konsumenta) — dotyczy to w szczególności wykorzystanego Wejścia jednorazowego i w pełni wykorzystanego karnetu.
4. Prawo odstąpienia nie przysługuje w odniesieniu do **Wejściówek**, ponieważ są to usługi związane z wydarzeniami sportowymi lub rekreacyjnymi, dla których w umowie oznaczono dzień świadczenia (art. 38 ust. 1 pkt 12 ustawy o prawach konsumenta).
5. Ustawowe prawo odstąpienia nie dotyczy umów zawartych na miejscu, w strzelnicy.
6. Aby odstąpić od umowy, Konsument składa oświadczenie: przez funkcję „Odstąp od umowy” w Koncie, e-mailem na adres z § 1 ust. 3 albo pisemnie na adres Sprzedawcy. Może skorzystać ze wzoru w Załączniku nr 1, ale nie jest to obowiązkowe. Do zachowania terminu wystarczy wysłanie oświadczenia przed jego upływem.
7. Sprzedawca niezwłocznie potwierdza otrzymanie oświadczenia na trwałym nośniku, anuluje Uprawnienie i zwraca należną kwotę (całą cenę albo cenę pomniejszoną o kwotę z ust. 2) w terminie 14 dni od otrzymania oświadczenia, przy użyciu takiego samego sposobu płatności, jakiego użył Konsument, chyba że Konsument zgodzi się na inny sposób niewiążący się dla niego z kosztami.

## § 9. Rezygnacja, odwołanie wydarzenia i inne zwroty

1. Poza przypadkami opisanymi w § 8, w ust. 2–3 poniżej i w przepisach prawa cena Uprawnienia nie podlega zwrotowi, także gdy Uprawnienie nie zostało wykorzystane.
2. Jeżeli Sprzedawca odwoła wydarzenie, zwraca Klientom pełną cenę Wejściówek w terminie 14 dni od odwołania, bez konieczności składania wniosku.
3. Jeżeli Sprzedawca zmieni termin wydarzenia, Klient może zachować Wejściówkę na nowy termin albo zażądać zwrotu pełnej ceny w terminie 30 dni od otrzymania informacji o zmianie, o ile Wejściówka nie została wykorzystana.
4. Zwroty płatności online realizowane są przez Tpay na rachunek lub kartę, z których dokonano płatności. Zwroty za zakupy na miejscu — gotówką albo na kartę użytą w terminalu.

## § 10. Reklamacje

1. Sprzedawca odpowiada za należyte wykonanie umowy na zasadach określonych w przepisach prawa, w szczególności w Kodeksie cywilnym i ustawie o prawach konsumenta.
2. Reklamację można złożyć e-mailem na adres z § 1 ust. 3 lub pisemnie na adres Sprzedawcy. Zalecane jest podanie: imienia i nazwiska, adresu e-mail Konta, numeru zamówienia, opisu problemu i oczekiwanego sposobu rozwiązania.
3. Sprzedawca odpowiada na reklamację w terminie 14 dni od jej otrzymania, na trwałym nośniku (e-mailem albo pisemnie).
4. Reklamacje dotyczące samej płatności (np. podwójne obciążenie) Sprzedawca rozpatruje we współpracy z Tpay.

## § 11. Pozasądowe rozwiązywanie sporów

1. Konsument może skorzystać z pozasądowych sposobów rozpatrywania reklamacji i dochodzenia roszczeń, w szczególności:
   1. zwrócić się o pomoc do miejskiego lub powiatowego rzecznika konsumentów albo organizacji konsumenckiej (np. Federacji Konsumentów);
   2. wystąpić do stałego polubownego sądu konsumenckiego lub o mediację przy Wojewódzkim Inspektoracie Inspekcji Handlowej w Gdańsku.
2. Informacje o tych procedurach są dostępne na stronie Urzędu Ochrony Konkurencji i Konsumentów (uokik.gov.pl).
3. Sprzedawca nie zobowiązuje się z góry do udziału w pozasądowym rozwiązywaniu sporów; decyzję o udziale podejmuje indywidualnie w każdej sprawie.

## § 12. Dane osobowe

1. Administratorem danych osobowych Klientów jest Sprzedawca. Szczegółowe zasady przetwarzania danych opisuje Polityka prywatności dostępna pod adresem events.steel-valley.pl/polityka-prywatnosci/.
2. W celu realizacji płatności Sprzedawca przekazuje Tpay adres e-mail oraz imię i nazwisko płatnika.
3. Dane zamówień i faktur są przechowywane przez 5 lat od końca roku kalendarzowego, w którym dokonano zakupu, ze względu na przepisy podatkowe i rachunkowe. Po usunięciu Konta zamówienia nie są powiązane z osobą Klienta, z wyjątkiem danych na fakturach.

## § 13. Postanowienia końcowe

1. Sprzedawca może zmienić Regulamin z ważnych przyczyn, w szczególności zmiany przepisów, zakresu oferty lub sposobu płatności. Do zamówień złożonych przed zmianą stosuje się Regulamin w brzmieniu zaakceptowanym przy zamówieniu.
2. O zmianie Regulaminu Sprzedawca informuje w Serwisie co najmniej 7 dni przed jej wejściem w życie.
3. W sprawach nieuregulowanych stosuje się prawo polskie, w szczególności Kodeks cywilny, ustawę o prawach konsumenta i ustawę o świadczeniu usług drogą elektroniczną.
4. Postanowienia Regulaminu nie ograniczają uprawnień Konsumentów wynikających z bezwzględnie obowiązujących przepisów prawa. W razie sprzeczności stosuje się te przepisy.
5. Spory z Klientami niebędącymi Konsumentami ani Przedsiębiorcami na prawach konsumenta rozstrzyga sąd właściwy dla siedziby Sprzedawcy.
6. Regulamin obowiązuje od 1 stycznia 2027 r.

## Załącznik nr 1 — Wzór formularza odstąpienia od umowy

*(formularz należy wypełnić i odesłać tylko w przypadku chęci odstąpienia od umowy)*

**Adresat:** RAFAŁ KAŹMIEROWSKI, ul. Lęborska 22E/39, 80-387 Gdańsk, e-mail: rkazmierowski@gmail.com

Ja/My (\*) niniejszym informuję/informujemy (\*) o moim/naszym (\*) odstąpieniu od umowy o świadczenie następującej usługi:

- Produkt (nazwa karnetu / wejścia): ……………………………………
- Numer zamówienia: ……………………………………
- Data zawarcia umowy: ……………………………………
- Imię i nazwisko Konsumenta: ……………………………………
- Adres e-mail Konta: ……………………………………
- Adres Konsumenta: ……………………………………
- Podpis Konsumenta (tylko jeżeli formularz jest przesyłany w wersji papierowej): ……………………………………
- Data: ……………………………………

(\*) Niepotrzebne skreślić.
`,
  },
  profile: {
    title: 'Twoje dane',
    intro: 'Pola oznaczone * są wymagane.',
    fullName: 'Imię i nazwisko',
    required: '(wymagane)',
    email: 'E-mail',
    emailHint: 'Adresu e-mail nie można tu zmienić.',
    phone: 'Telefon',
    phoneHint: 'Np. +48 600 100 200.',
    permitNumber: 'Numer decyzji (pozwolenia na broń)',
    permitAuthority: 'Organ wydający',
    permitHint: 'Numer decyzji i organ wydający znajdziesz w pozwoleniu na broń.',
    address: 'Adres zamieszkania',
    addressHint: 'Adres zamieszkania jest potrzebny, jeśli nie masz pozwolenia na broń.',
    save: 'Zapisz dane',
    cancel: 'Wróć do konta',
    saveError: 'Nie udało się zapisać danych. Sprawdź pola i spróbuj ponownie.',
    errorLength: 'Wpisz od {min} do {max} znaków.',
    errorPhone: 'Podaj numer telefonu: 9–20 cyfr, mogą być spacje i „+” na początku.',
    errorPermitPair: 'Podaj numer decyzji razem z organem wydającym.',
  },
  footer: {
    rangeLink: 'Strzelnica Steel Valley — steel-valley.pl',
    copyright: '© {year} Steel Valley',
  },
  home: {
    title: 'Kalendarz strzelnicy',
    empty: 'Brak zaplanowanych wydarzeń. Zajrzyj wkrótce.',
  },
  calendarCard: {
    competitionKind: 'Zawody Steel Valley',
    competitionLink: 'Szczegóły zawodów',
    eventLink: 'Szczegóły u organizatora',
    newTab: '(otwiera się w nowej karcie)',
    ticketPrice: 'Wejściówka: {price}',
    buyTicket: 'Kup wejściówkę',
    seatsLeft: 'Wolne miejsca: {count}',
    soldOut: 'Wyprzedane',
    salesClosed: 'Sprzedaż zakończona.',
    // SPEC-012 AC-25
    cancelled: 'Odwołane',
    cancelReason: 'Powód: {reason}',
  },
  competitionPage: {
    kind: 'Zawody Steel Valley',
    dateLabel: 'Termin',
    disciplineLabel: 'Dyscyplina',
    rulebook: 'Regulamin (PDF)',
    rulebookSoon: 'Regulamin wkrótce',
    matchbook: 'Matchbook (PDF)',
    matchbookSoon: 'Matchbook wkrótce',
    scheduleSoon: 'Harmonogram wkrótce',
    metaFallback: '{name}, {date} — zawody na strzelnicy Steel Valley.',
    previewTitle: 'Podgląd zawodów',
    previewBar: 'Podgląd — zawody nie są opublikowane',
    backToEdit: 'Wróć do edycji',
  },
  panel: {
    title: 'Panel strzelnicy',
    loading: 'Wczytywanie…',
    loadError: 'Nie udało się wczytać danych. Odśwież stronę.',
    signInIntro: 'Zaloguj się, aby korzystać z panelu strzelnicy.',
    signIn: 'Zaloguj się przez Google',
    signOut: 'Wyloguj się',
    forbidden: 'Nie masz uprawnień do panelu.',
    goToAccount: 'Przejdź do swojego konta',
    staffComingSoon: 'Moduły obsługi będą dostępne wkrótce.',
    saved: 'Zapisano.',
    saveError: 'Nie udało się zapisać. Spróbuj ponownie.',
    menu: {
      calendar: 'Kalendarz',
      rulebooks: 'Regulaminy',
      disciplines: 'Dyscypliny',
      categories: 'Kategorie',
      offer: 'Oferta',
      sales: 'Sprzedaż',
      orders: 'Zamówienia',
      invoices: 'Faktury',
      invoicesCount: 'do wystawienia: {count}',
      users: 'Użytkownicy',
      rangeLog: 'Książka',
      rangeReview: 'Przegląd książki',
      rangeOfficers: 'Prowadzący',
      rangeOfficersCount: 'do zatwierdzenia: {count}',
      rangeDutySchedule: 'Dyżury',
      rangeClosures: 'Zamknięcia',
      openingHours: 'Godziny otwarcia',
    },
  },
  users: {
    title: 'Użytkownicy',
    searchLabel: 'Szukaj po imieniu i nazwisku lub e-mailu',
    searchHint: 'Wpisz co najmniej 2 znaki.',
    search: 'Szukaj',
    empty: 'Nie znaleziono kont.',
    count: 'Kont: {count}',
    page: 'Strona {page} z {pages}',
    previous: 'Poprzednia strona',
    next: 'Następna strona',
    noName: '(bez imienia i nazwiska)',
    email: 'E-mail',
    role: 'Rola',
    ready: 'Gotowy do wpisu',
    yes: 'Tak',
    no: 'Nie',
    createdAt: 'Data założenia',
    roles: {
      user: 'Użytkownik',
      staff: 'Obsługa strzelnicy',
      admin: 'Admin',
    },
    cardTitle: 'Karta użytkownika',
    backToList: 'Wróć do listy',
    startEntry: 'Rozpocznij wpis do książki',
    notFound: 'Nie znaleziono konta.',
    dataTitle: 'Dane',
    roleTitle: 'Rola',
    changeRole: 'Zmień rolę',
    confirmRole: 'Zmienić rolę na „{role}”?',
    roleChanged: 'Rola zmieniona.',
    lastAdmin: 'Musi zostać co najmniej jeden admin.',
    historyTitle: 'Historia zmian',
    historyEmpty: 'Brak zmian dokonanych przez obsługę lub admina.',
    change: '{field}: {before} → {after}',
    auditPassGrant: 'Przyznano karnet: {name}',
    auditPassGrantCancel: 'Anulowano przyznanie: {name}',
    passGift: 'Prezent: {reason}',
    privacyAck: 'Potwierdzenie klauzuli informacyjnej',
    actorNoName: '(konto bez imienia i nazwiska)',
    actorDeleted: '(konto usunięte)',
    deleteTitle: 'Usuń konto',
    deleteButton: 'Usuń konto',
    deleteWarning:
      'Konto, dane profilu i kod QR zostaną usunięte. Niewykorzystane karnety przepadną. Zamówienia i dane do faktur zostają przez 5 lat, wpisy w książce rejestru pobytu — do końca okresu przechowywania.',
    deleteConfirmLabel: 'Aby potwierdzić, wpisz USUŃ',
    deleteConfirm: 'Usuń konto na stałe',
    deleteCancel: 'Anuluj',
    deleteOwn: 'Nie możesz usunąć własnego konta.',
    deleted: 'Konto zostało usunięte.',
    deleteForbidden: 'Nie masz uprawnień do usunięcia konta.',
    deleteError: 'Nie udało się usunąć konta. Spróbuj ponownie.',
  },
  products: {
    title: 'Oferta — produkty i ceny',
    intro:
      'Nowy produkt jest ukryty — pokaż go w ofercie, gdy będzie gotowy. Produktów nie można usuwać; niepotrzebny produkt ukryj.',
    addHeading: 'Dodaj produkt',
    editHeading: 'Edytuj produkt: {name}',
    requiredHint: 'Pola oznaczone * są wymagane.',
    kindLabel: 'Rodzaj *',
    choose: '— wybierz —',
    kinds: {
      entries: 'Karnet ilościowy',
      days: 'Karnet czasowy',
      single_entry: 'Wejście jednorazowe',
    },
    groups: {
      entries: 'Karnety ilościowe',
      days: 'Karnety czasowe',
      single_entry: 'Wejścia jednorazowe',
    },
    nameLabel: 'Nazwa *',
    priceLabel: 'Cena (zł) *',
    priceHint: 'Np. 120,00.',
    entriesLabel: 'Liczba wejść *',
    entriesHint: 'Od 1 do {max}.',
    daysLabel: 'Liczba dni *',
    daysHint: 'Od 1 do {max}. Dni liczą się od pierwszego wejścia.',
    dayTypeLabel: 'Dzień *',
    dayTypes: {
      weekend: 'Weekend',
      weekday: 'Dzień powszedni',
    },
    descriptionLabel: 'Opis',
    descriptionHint: 'Maks. {max} znaków.',
    add: 'Dodaj produkt',
    save: 'Zapisz zmiany',
    cancel: 'Anuluj',
    added: 'Dodano produkt. Jest ukryty — kliknij „Pokaż w ofercie”, aby go udostępnić.',
    fixErrors: 'Popraw zaznaczone pola.',
    kindRequired: 'Wybierz rodzaj.',
    nameRequired: 'Podaj nazwę.',
    nameTooLong: 'Nazwa może mieć najwyżej {max} znaków.',
    priceInvalid: 'Podaj cenę od 0,01 do 10 000,00 zł (najwyżej dwa miejsca po przecinku).',
    entriesInvalid: 'Podaj liczbę wejść od 1 do {max}.',
    daysInvalid: 'Podaj liczbę dni od 1 do {max}.',
    dayTypeRequired: 'Wybierz dzień.',
    descriptionTooLong: 'Opis może mieć najwyżej {max} znaków.',
    hasOrders:
      'Produkt ma zamówienia — rodzaju, liczby wejść, liczby dni ani dnia nie można zmienić. Utwórz nowy produkt i ukryj ten.',
    hasOrdersHint: 'Produkt ma zamówienia: możesz zmienić nazwę, cenę i opis. Zamówienia zachowują dotychczasową nazwę i cenę.',
    empty: 'Brak produktów w tej grupie.',
    details: {
      entries: 'Liczba wejść: {count}',
      days: 'Liczba dni: {count}',
      single_entry: 'Dzień: {day}',
    },
    active: 'W ofercie',
    hidden: 'Ukryty',
    discontinued: 'Wycofany',
    kindDiscontinued: 'Karnety czasowe zostały wycofane z Oferty.',
    show: 'Pokaż w ofercie',
    hide: 'Ukryj',
    edit: 'Edytuj',
    moveUp: 'W górę',
    moveDown: 'W dół',
  },
  sales: {
    title: 'Sprzedaż na miejscu',
    intro: 'Zarejestruj sprzedaż opłaconą gotówką lub terminalem. Uprawnienie powstaje od razu.',
    personHeading: '1. Osoba',
    personWithAccount: 'Osoba z kontem',
    personGuest: 'Osoba bez konta',
    guestHint: 'Bez konta: tylko wejście jednorazowe na dziś albo wejściówka na dzisiejsze wydarzenie. Dane osoby trafiają tylko do książki rejestru pobytu.',
    searchLabel: 'Imię i nazwisko lub e-mail',
    searchHint: 'Wpisz co najmniej {min} znaki.',
    search: 'Szukaj',
    searching: 'Szukam…',
    noResults: 'Nie znaleziono osoby.',
    searchError: 'Nie udało się wyszukać. Spróbuj ponownie.',
    choose: 'Wybierz',
    chooseLabel: 'Wybierz: {name}',
    noName: 'Bez imienia i nazwiska',
    selected: 'Wybrana osoba: {name}',
    change: 'Zmień osobę',
    itemHeading: '2. Produkt lub wejściówka',
    itemLabel: 'Produkt lub wejściówka *',
    itemChoose: '— wybierz —',
    itemOption: '{name} — {price}',
    itemsEmpty: 'Brak produktów do sprzedaży dla tej osoby.',
    methodHeading: '3. Płatność',
    cash: 'Gotówka',
    terminal: 'Terminal',
    invoiceHeading: '4. Faktura',
    submit: 'Zarejestruj sprzedaż',
    saving: 'Zapisuję…',
    personRequired: 'Wybierz osobę albo „Osoba bez konta”.',
    itemRequired: 'Wybierz produkt lub wejściówkę.',
    methodRequired: 'Wybierz „Gotówka” albo „Terminal”.',
    saved: 'Sprzedaż zarejestrowana: {number}.',
    savedNoNumber: 'Sprzedaż zarejestrowana.',
    errorSoldOut: 'Wejściówki zostały wyprzedane.',
    errorSalesClosed: 'Sprzedaż zakończona.',
    errorUnavailable: 'Ten produkt nie jest już dostępny.',
    errorGuest: 'Osobie bez konta można sprzedać tylko wejście na dziś.',
    errorRangeBlocked: 'Dziś karnety i wejścia jednorazowe nie obowiązują.',
    errorPerson: 'Nie znaleziono osoby. Wyszukaj ją ponownie.',
    errorGeneric: 'Nie udało się zarejestrować sprzedaży. Spróbuj ponownie.',
    todayHeading: 'Dzisiejsza sprzedaż na miejscu',
    todayEmpty: 'Dziś nie było sprzedaży na miejscu.',
    todayError: 'Nie udało się wczytać dzisiejszej sprzedaży. Odśwież stronę.',
    colNumber: 'Nr zamówienia',
    colTime: 'Godzina',
    colItem: 'Produkt',
    colAmount: 'Kwota',
    colMethod: 'Płatność',
    colSeller: 'Sprzedał(a)',
    refunded: '(zwrócone)',
    totalCash: 'Suma gotówka: {amount}',
    totalTerminal: 'Suma terminal: {amount}',
    backToEntry: 'Wróć do wpisu do książki',
  },
  orders: {
    title: 'Zamówienia',
    intro: 'Przeglądaj zamówienia, eksportuj je do CSV, anuluj i zwracaj niewykorzystane karnety.',
    filtersHeading: 'Filtry',
    from: 'Od dnia',
    to: 'Do dnia',
    status: 'Status',
    method: 'Metoda',
    item: 'Produkt lub wejściówka',
    person: 'Osoba lub nr zamówienia',
    any: 'Wszystkie',
    filter: 'Pokaż',
    exportCsv: 'Eksportuj CSV',
    loading: 'Wczytywanie zamówień…',
    loadError: 'Nie udało się wczytać zamówień. Spróbuj ponownie.',
    empty: 'Brak zamówień dla wybranych filtrów.',
    summary: 'Zamówień: {count}. Suma: {amount}',
    numberResult: 'Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.',
    numberNotFound: 'Brak zamówienia o tym numerze.',
    colNumber: 'Nr zamówienia',
    csvNumber: 'Numer zamówienia',
    colDate: 'Data',
    colItem: 'Produkt',
    colAmount: 'Kwota',
    colMethod: 'Metoda',
    colStatus: 'Status',
    colPerson: 'Osoba',
    colSeller: 'Sprzedał(a)',
    colNote: 'Uwagi',
    colActions: 'Akcje',
    noAccount: 'Bez konta',
    cash: 'gotówka',
    terminal: 'terminal',
    refund: 'Anuluj i zwróć',
    refundLabel: 'Anuluj i zwróć: {item}, {amount}',
    passUsed: 'Karnet był używany — zwrot poza systemem.',
    confirmHeading: 'Anuluj i zwróć',
    confirmOnline: 'Uprawnienie zostanie anulowane, a Tpay zwróci {amount} na konto płacącego. Tej operacji nie można cofnąć.',
    confirmOnSite: 'Uprawnienie zostanie anulowane. Oddaj {amount} gotówką lub na terminal. Tej operacji nie można cofnąć.',
    confirmItem: 'Zamówienie {number}: {item}, {person}, {date}.',
    note: 'Notatka (opcjonalnie, maks. 300 znaków)',
    confirm: 'Potwierdź zwrot',
    back: 'Wróć',
    refunding: 'Zlecam zwrot…',
    refundedOnline: 'Zlecono zwrot w Tpay. Status zmieni się na „Zwrócone” po potwierdzeniu.',
    refundedOnSite: 'Zamówienie zwrócone. Oddaj pieniądze klientowi.',
    errorNotPaid: 'Zamówienie nie jest już opłacone. Odśwież listę.',
    errorTpay: 'Tpay nie przyjął zwrotu. Zamówienie pozostaje opłacone — spróbuj później.',
    errorGeneric: 'Nie udało się anulować zamówienia. Spróbuj ponownie.',
    addInvoice: 'Dodaj dane do faktury',
    addInvoiceLabel: 'Dodaj dane do faktury: {item}, {amount}',
    invoiceHeading: 'Dodaj dane do faktury',
    invoiceSave: 'Zapisz i dodaj do „Do wystawienia”',
    invoiceSaved: 'Dodano dane do faktury. Zamówienie jest na liście „Do wystawienia”.',
    invoiceRequested: 'Faktura zamówiona',
    grant: 'Przyznaj karnet',
    grantReason: 'Powód: {reason}',
    grantCancelNote: 'Notatka anulowania: {note}',
    csvGrantReason: 'Powód przyznania',
    cancelGrant: 'Anuluj przyznanie',
    cancelGrantLabel: 'Anuluj przyznanie: {item}',
    cancelGrantText: 'Karnet zostanie anulowany. Niewykorzystane wejścia i dni przepadają, historia wejść zostaje. Tej operacji nie można cofnąć.',
    grantNote: 'Notatka',
    grantCancelling: 'Anuluję przyznanie…',
    grantCancelled: 'Przyznanie anulowane.',
    grantAlreadyCancelled: 'Przyznanie zostało już anulowane.',
    grantNoteTooLong: 'Notatka może mieć najwyżej 300 znaków.',
    grantCancelError: 'Nie udało się anulować przyznania. Spróbuj ponownie.',
    // SPEC-012 AC-11, AC-14: stan e-maila z potwierdzeniem zamówienia i „Wyślij ponownie”.
    emailSent: 'E-mail z potwierdzeniem: wysłano {date}',
    emailPending: 'E-mail z potwierdzeniem: w kolejce',
    emailFailed: 'E-mail z potwierdzeniem: nie wysłano',
    emailSkipped: 'E-mail z potwierdzeniem: pominięto (konto usunięte)',
    emailResend: 'Wyślij ponownie',
    emailResendLabel: 'Wyślij ponownie e-mail z potwierdzeniem zamówienia {number}',
    emailResent: 'E-mail jest w kolejce do wysłania.',
    emailResendError: 'Nie udało się ponowić wysyłki e-maila. Odśwież listę i spróbuj ponownie.',
    // SPEC-012 US-4 (AC-15…AC-22, AC-52): odstąpienie od umowy, zwrot częściowy, ostrzeżenie po 14 dniach.
    summaryRefunds: 'Zwroty: −{amount}',
    csvRefundAmount: 'Kwota zwrotu',
    csvWithdrawalOn: 'Dzień odstąpienia',
    withdrawal: 'Odstąpienie od umowy',
    withdrawalLabel: 'Odstąpienie od umowy: zamówienie {number}',
    withdrawalUntil: 'Odstąpienie możliwe do {date}',
    withdrawalDone: 'Usługa wykonana w całości — prawo odstąpienia wygasło.',
    withdrawalDay: 'Dzień odstąpienia *',
    withdrawalQuote: 'Cena {price}, wykorzystano {used} z {total} wejść ({value}). Zwrot: {refund}.',
    withdrawalQuoteUnused: 'Cena {price}, bez wykorzystania. Zwrot: {refund}.',
    withdrawalQuoteLoading: 'Wyliczam zwrot…',
    withdrawalQuoteError: 'Nie udało się wyliczyć zwrotu. Sprawdź dzień odstąpienia.',
    withdrawalConfirm: 'Zleć zwrot',
    withdrawalWindowClosed: 'Termin na odstąpienie minął.',
    withdrawalInvalidDay: 'Dzień odstąpienia musi być między dniem opłacenia a dziś.',
    withdrawalRefunded: 'Zlecono zwrot {amount} w Tpay. Status zmieni się na „Zwrócone” po potwierdzeniu.',
    retryFailed: 'Zwrot nieudany',
    retry: 'Ponów zwrot',
    retryLabel: 'Ponów zwrot {amount}: zamówienie {number}',
    lateWarning: 'Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).',
    noteRequired: 'Notatka * (3–300 znaków)',
    refundNoteRequired: 'Wpisz notatkę (3–300 znaków).',
  },
  grant: {
    title: 'Przyznaj karnet',
    intro: 'Przyznaj osobie z kontem karnet albo wejściówkę bez płatności — np. nagrodę lub prezent. Powstaje zamówienie „Prezent — 0,00 zł”.',
    back: 'Wróć do zamówień',
    requiredHint: 'Pola oznaczone * są wymagane.',
    personHeading: 'Osoba *',
    itemLabel: 'Co przyznać *',
    itemChoose: '— wybierz —',
    ticketGroup: 'Wejściówki',
    hiddenSuffix: '(ukryty w Ofercie)',
    seatsLeft: 'wolne: {count}',
    soldOut: 'wyprzedane',
    itemsEmpty: 'Brak produktów i wydarzeń do przyznania.',
    price: 'Cena w Ofercie: {price}',
    expiresLabel: 'Ważny do *',
    expiresDaysHint: 'Do tego dnia trzeba zacząć korzystać z karnetu — dni liczą się od pierwszego wejścia.',
    ticketValidity: 'Wejściówka ważna w dniach wydarzenia.',
    reasonLabel: 'Powód *',
    reasonHint: 'Widoczny tylko dla admina. Nie wpisuj danych osobowych — osoba jest już wskazana.',
    reasonCounter: '{count}/{max} znaków',
    submit: 'Przyznaj karnet',
    saving: 'Przyznaję…',
    personRequired: 'Wybierz osobę.',
    itemRequired: 'Wybierz, co przyznać.',
    errorPerson: 'Nie znaleziono osoby.',
    errorProduct: 'Nie znaleziono produktu.',
    errorEvent: 'Na to wydarzenie nie można już przyznać wejściówki.',
    errorSoldOut: 'Brak wolnych miejsc na to wydarzenie.',
    errorReason: 'Powód musi mieć od 3 do 300 znaków.',
    errorExpiresOn: 'Data ważności musi być między dziś a {max}.',
    errorGeneric: 'Nie udało się przyznać karnetu. Spróbuj ponownie.',
    granted: 'Przyznano: {item} — {person}. Zamówienie {number}.',
    another: 'Przyznaj kolejny',
    showOrder: 'Pokaż zamówienie',
  },
  invoices: {
    title: 'Faktury',
    intro: 'Wystaw faktury w e-mikrofirmie, kopiując dane z listy, a potem wpisz numer faktury i numer KSeF.',
    tabTodo: 'Do wystawienia',
    tabIssued: 'Wystawione',
    from: 'Data zapłaty od',
    to: 'Data zapłaty do',
    filter: 'Pokaż',
    exportCsv: 'Eksport CSV',
    loading: 'Wczytywanie faktur…',
    loadError: 'Nie udało się wczytać faktur. Spróbuj ponownie.',
    emptyTodo: 'Brak faktur do wystawienia.',
    emptyIssued: 'Brak wystawionych faktur w wybranym zakresie.',
    count: 'Pozycji: {count}',
    unverified: 'Dane niezweryfikowane',
    refunded: 'Zwrot — sprawdź, czy potrzebna jest korekta w e-mikrofirmie.',
    details: 'Szczegóły i dane do faktury',
    fieldNip: 'NIP',
    fieldBuyer: 'Nazwa nabywcy',
    fieldAddress: 'Adres',
    fieldItem: 'Nazwa pozycji',
    fieldAmount: 'Kwota brutto',
    fieldSaleDate: 'Data sprzedaży',
    fieldPayment: 'Sposób zapłaty',
    fieldOrder: 'Numer zamówienia',
    payTpay: 'przelew/płatność online — Tpay',
    payCash: 'gotówka',
    payTerminal: 'karta — terminal',
    copy: 'Kopiuj',
    copyLabel: 'Kopiuj: {field}',
    copied: 'Skopiowano',
    copyError: 'Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.',
    invoiceNumber: 'Numer faktury',
    ksefNumber: 'Numer KSeF',
    ksefHint: 'Opcjonalnie, np. 5260250274-20261118-0100A0B1C2D3-E4',
    mark: 'Oznacz jako wystawioną',
    marked: 'Oznaczono fakturę jako wystawioną.',
    unmark: 'Cofnij oznaczenie',
    unmarkConfirm: 'Cofnąć oznaczenie faktury {number}? Pozycja wróci do „Do wystawienia”.',
    unmarked: 'Cofnięto oznaczenie. Pozycja jest w „Do wystawienia”.',
    issuedInfo: 'Wystawiona: {date}, oznaczył(a): {person}',
    numberError: 'Wpisz numer faktury (od 1 do 50 znaków).',
    ksefError: 'Numer KSeF ma format: NIP-RRRRMMDD-12 znaków-2 znaki (do 50 znaków).',
    errorChanged: 'Pozycja została już zmieniona. Odśwież listę.',
    errorNotPaid: 'Zamówienie nie jest opłacone (np. zwrócone). Odśwież listę.',
    errorGeneric: 'Nie udało się zapisać. Spróbuj ponownie.',
  },
  entries: {
    title: 'Kalendarz',
    newCompetition: 'Nowe zawody',
    newEvent: 'Nowe wydarzenie',
    empty: 'Kalendarz jest pusty. Dodaj zawody lub wydarzenie.',
    kindCompetition: 'Zawody',
    kindEvent: 'Wydarzenie',
    statusDraft: 'Szkic',
    statusPublished: 'Opublikowane',
    refreshSite: 'Odśwież stronę publiczną',
  },
  rebuild: {
    started: 'Strona publiczna odświeży się w ciągu kilku minut.',
    failed: 'Nie udało się uruchomić odświeżenia strony. Spróbuj „Odśwież stronę publiczną” za chwilę.',
  },
  dictionary: {
    nameLabel: 'Nazwa',
    newNameLabel: 'Nowa nazwa',
    add: 'Dodaj',
    rename: 'Zmień nazwę',
    save: 'Zapisz',
    cancel: 'Anuluj',
    hide: 'Ukryj',
    restore: 'Przywróć',
    active: 'Aktywna',
    hidden: 'Ukryta',
    required: 'Podaj nazwę.',
    tooShort: 'Nazwa musi mieć co najmniej {min} znaki.',
    tooLong: 'Nazwa może mieć najwyżej {max} znaków.',
    disciplines: {
      title: 'Dyscypliny',
      intro: 'Ukrytej dyscypliny nie da się wybrać przy nowych zawodach; zawody, które jej używają, zachowują ją.',
      addHeading: 'Dodaj dyscyplinę',
      listHeading: 'Lista dyscyplin',
      empty: 'Lista dyscyplin jest pusta.',
      duplicate: 'Taka dyscyplina już istnieje.',
    },
    categories: {
      title: 'Kategorie wydarzeń',
      intro: 'Ukrytej kategorii nie da się wybrać przy nowych wydarzeniach; wydarzenia, które jej używają, zachowują ją.',
      addHeading: 'Dodaj kategorię',
      listHeading: 'Lista kategorii',
      empty: 'Lista kategorii jest pusta.',
      duplicate: 'Taka kategoria już istnieje.',
    },
    officers: {
      title: 'Prowadzący strzelanie',
      intro:
        'Ukrytego prowadzącego nie da się wybrać na zmianę; zmiana imienia i nazwiska nie zmienia wcześniejszych wpisów w książce.',
      addHeading: 'Dodaj prowadzącego',
      listHeading: 'Lista prowadzących',
      empty: 'Lista prowadzących jest pusta.',
      nameLabel: 'Imię i nazwisko',
      newNameLabel: 'Imię i nazwisko',
      rename: 'Edytuj',
      active: 'Aktywny',
      hidden: 'Ukryty',
      required: 'Podaj imię i nazwisko.',
      tooShort: 'Imię i nazwisko musi mieć co najmniej {min} znaki.',
      tooLong: 'Imię i nazwisko może mieć najwyżej {max} znaków.',
      licenseLabel: 'Nr legitymacji',
      institutionLabel: 'Instytucja',
      institutionPlaceholder: 'Wybierz…',
      institutionOtherLabel: 'Nazwa instytucji',
      institutions: {
        PZSS: 'PZSS',
        LOK: 'LOK',
        PZL: 'PZŁ',
        OTHER: 'Inne',
      },
      details: 'Nr legitymacji: {license} · {institution}',
      missingDetails: 'Brak nr legitymacji — uzupełnij w „Edytuj”.',
      licenseRequired: 'Podaj nr legitymacji.',
      licenseTooLong: 'Nr legitymacji może mieć najwyżej {max} znaków.',
      institutionRequired: 'Wybierz instytucję.',
      institutionOtherRequired: 'Podaj nazwę instytucji.',
      institutionOtherTooShort: 'Nazwa instytucji musi mieć co najmniej {min} znaki.',
      institutionOtherTooLong: 'Nazwa instytucji może mieć najwyżej {max} znaków.',
    },
  },
  officerReview: {
    heading: 'Do zatwierdzenia ({count})',
    approve: 'Zatwierdź',
    reject: 'Odrzuć',
    rejectConfirm: 'Odrzucić zgłoszenie {name}?',
    approved: 'Zatwierdzono.',
    rejected: 'Odrzucono.',
    notPending: 'To zgłoszenie zostało już rozpatrzone. Odśwież stronę.',
    submittedAt: 'zgłoszono {date}',
    fromAccount: 'Z konta',
    statusPending: 'Czeka na zatwierdzenie',
    statusRejected: 'Odrzucony',
    hiddenForOthers: 'Ukryty dla innych',
    readOnly: 'Listę prowadzących zmienia admin. Ty możesz zatwierdzać i odrzucać zgłoszenia z kont.',
  },
  rangeLog: {
    title: 'Książka rejestru pobytu',
    shiftQuestion: 'Kto prowadzi dziś strzelanie?',
    shiftHint: 'Wybór obowiązuje do końca dnia na wszystkich urządzeniach.',
    noOfficers: 'Brak aktywnych prowadzących. Admin dodaje ich w zakładce „Prowadzący”.',
    officerLabel: 'Prowadzący strzelanie:',
    dutyFromSchedule: '(z grafiku)',
    dutyFromEvent: '({name})',
    change: 'Zmień',
    changeSr: 'dyżurnego prowadzącego',
    cancel: 'Anuluj',
    searchLabel: 'Szukaj prowadzącego',
    searchHint: 'Wpisz co najmniej {min} znaki imienia lub nazwiska.',
    search: 'Szukaj',
    searchEmpty: 'Nie znaleziono prowadzącego.',
    officerIsPerson: '{name} (osoba wpisywana)',
    officerInactive: 'Ten prowadzący nie jest już dostępny — wybierz innego.',
    dutySaveError: 'Nie udało się zapisać. Spróbuj ponownie.',
    dutyForbiddenNote: 'Książkę może prowadzić dyżurny Prowadzący w dniu dyżuru albo Obsługa strzelnicy.',
    dutyLost:
      'Nie jesteś już dyżurnym Prowadzącym — wpis nie został zapisany. Książkę prowadzi teraz Obsługa lub nowy dyżurny.',
    refresh: 'Odśwież',
  },
  rangeDutySchedule: {
    title: 'Grafik dyżurów',
    intro: 'Dyżurny Prowadzący na kolejne dni (do 90 dni naprzód) — jeden na dzień dla całej strzelnicy.',
    today: 'dziś',
    noDuty: 'Brak dyżurnego',
    sourceSchedule: 'z grafiku',
    sourceBook: 'zmiana w książce',
    sourceEvent: '{name}',
    set: 'Ustaw',
    change: 'Zmień',
    clear: 'Usuń z grafiku',
    actionSr: 'dyżurnego na {date}',
    pickerHeading: 'Dyżurny na {date}',
    showMore: 'Pokaż kolejne 30 dni',
    eventHint: 'W tym dniu obowiązuje dyżurny z „{name}”. Wpis z grafiku zadziała, jeśli tam zostanie usunięty.',
    bookHint: 'Dziś obowiązuje zmiana z książki: {name}.',
    scheduleUnavailable: 'W grafiku: {name} — ten prowadzący nie jest już dostępny. Wybierz innego.',
    saved: 'Zapisano dyżurnego na {date}.',
    cleared: 'Usunięto z grafiku: {date}.',
    invalidDay: 'Grafik obejmuje dni od dziś do 90 dni naprzód. Odśwież stronę.',
  },
  calendarDuty: {
    label: 'Dyżurny Prowadzący (opcjonalnie)',
    none: 'Nie wskazano',
    hint: 'Obowiązuje we wszystkie dni zawodów lub wydarzenia. Możesz uzupełnić później. Bez dyżurnego obowiązuje grafik dyżurów.',
    choose: 'Wybierz',
    change: 'Zmień',
    clear: 'Nie wskazuj',
    actionSr: 'dyżurnego prowadzącego',
    cancel: 'Anuluj',
    unsaved: 'Zmiana zacznie obowiązywać po zapisaniu formularza.',
    unavailable: 'Wskazany dyżurny nie jest już dostępny — wybierz innego.',
    conflict: 'W dniu {date} dyżurnego wskazuje już „{name}”. Usuń tam dyżurnego albo wskaż tę samą osobę.',
  },
  rangeEntry: {
    findHeading: 'Kogo wpisujemy?',
    scan: 'Skanuj kod QR',
    qrNotFound: 'Nie znaleziono konta dla tego kodu.',
    qrError: 'Nie udało się sprawdzić kodu. Spróbuj ponownie.',
    missingTitle: 'Brakuje danych:',
    complete: 'Uzupełnij dane',
    completeSave: 'Zapisz dane',
    completeHint: 'Podaj numer decyzji z organem wydającym albo adres zamieszkania.',
    completeSaved: 'Dane zapisane.',
    errorPerson: 'Nie znaleziono osoby. Wyszukaj ją ponownie.',
    todayWarning: 'Ta osoba ma dziś wpis o {time}. Kontynuować?',
    continue: 'Kontynuuj',
    passesLegend: 'Uprawnienie do wykorzystania',
    passesError: 'Nie udało się wczytać uprawnień. Spróbuj ponownie.',
    effectActivate: '{name} — aktywacja dziś, ważny do {date}',
    effectCovered: '{name} — ważny do {date} (bez zmian)',
    effectTicket: '{name} — obejmuje dziś (bez zmian)',
    effectEntries: '{name} — zostanie {left}',
    effectSingle: '{name} — zostanie wykorzystane',
    noPass: 'Brak ważnego karnetu lub wejścia na dziś.',
    noPassDuty: 'Brak ważnego karnetu lub wejścia na dziś. Sprzedaż na miejscu prowadzi Obsługa.',
    sell: 'Sprzedaj na miejscu',
    companion: 'Wpisz jako osobę towarzyszącą',
    next: 'Dalej',
    otherPerson: 'Wybierz inną osobę',
    nextPerson: 'Następna osoba',
  },
  rangeSign: {
    guest: 'Osoba bez konta',
    companionNote: 'Osoba towarzysząca — bez zużycia uprawnienia',
    companionPass: 'osoba towarzysząca (bez zużycia uprawnienia)',
    saleHeading: 'Sprzedaż na miejscu — wejście na dziś',
    saleItemsEmpty: 'Brak wejścia jednorazowego ani wejściówki na dziś.',
    salePassError: 'Sprzedaż zapisana, ale nie udało się wczytać uprawnienia. Spróbuj ponownie.',
    heading: 'Wpis do książki rejestru pobytu',
    dateTime: 'Data i godzina',
    permitOrAddress: 'Nr decyzji i organ wydający / Adres zamieszkania',
    officer: 'Prowadzący strzelanie',
    rulesHeading: 'Regulamin strzelnicy',
    // Regulamin strzelnicy od właściciela (#39, SPEC-005 AC-13) — treść 1:1 z PDF „Regulamin_strzelnicy”.
    // Bloki rozdziela pusta linia; linia „## …” to tytuł rozdziału; podpunkty w osobnych liniach.
    rulesBody:
      'Regulamin użytkowania strzelnicy w miejscowości Morawy Wielkie\n\n' +
      '## Rozdział 1. Warunki korzystania ze strzelnicy\n\n' +
      '1. Prowadzący strzelanie:\n1) odpowiada za bezpieczeństwo użytkowników strzelnicy oraz osób im towarzyszących,\n2) wyznacza korzystającym ze strzelnicy stanowiska strzeleckie, a osobom towarzyszącym — miejsce bezpiecznego pobytu,\n3) prowadzi książkę rejestru pobytu na strzelnicy, w której zamieszcza się następujące dane:\n   a) imię i nazwisko korzystającego ze strzelnicy,\n   b) kaliber broni, z której przeprowadzono strzelanie,\n   c) numer pozwolenia na broń oraz nazwę organu, który je wydał, albo adres korzystającego ze strzelnicy, jeśli nie posiada on pozwolenia na broń,\n   d) godzinę przyjścia na strzelnicę,\n   e) oświadczenie korzystającego ze strzelnicy o zapoznaniu się z regulaminem strzelnicy i przepisami bezpieczeństwa, potwierdzone własnoręcznym podpisem lub zatwierdza zapoznanie się z regulaminem strzelnicy w przypadku elektronicznej wersji książki pobytu na strzelnicy.\n4) jest zobowiązany do posiadania sprawnego i naładowanego telefonu komórkowego oraz apteczki pierwszej pomocy.\n\n' +
      '2. Na strzelnicy zabrania się:\n1) osobom towarzyszącym osobom korzystającym ze strzelnicy wchodzenia na stanowiska strzeleckie oraz styczności z bronią,\n2) używania broni innych osób korzystających ze strzelnicy, bez zgody jej użytkownika,\n3) spożywania alkoholu lub używania środków odurzających oraz przebywania na terenie strzelnicy osób będących pod ich wpływem.\n\n' +
      '3. Na strzelnicy, w miejscu widocznym, umieszcza się:\n1) regulamin strzelnicy,\n2) plan strzelnicy z oznaczeniem:\n   a) stanowisk strzeleckich,\n   b) punktu sanitarnego,\n   c) dróg ewakuacji,\n3) wykaz sygnałów alarmowych,\n4) informację o możliwości i sposobie połączenia się z najbliższym punktem pomocy medycznej.\n\n' +
      '4. Za szkody powstałe podczas strzelania oraz spowodowanie wypadku odpowiada zarządca strzelnicy, prowadzący strzelanie lub trening strzelecki albo korzystający ze strzelnicy, na zasadach określonych w odrębnych przepisach.\n\n' +
      '5. Korzystanie ze strzelnicy możliwe jest tylko za wiedzą i zgodą właściciela lub zarządzającego strzelnicą lub osób przez niego upoważnionych.\n\n' +
      '## Rozdział 2. Sposób obchodzenia się z bronią\n\n' +
      '1. Broń palną na terenie strzelnicy poza stanowiskiem strzeleckim przenosi się broń rozładowaną z otwartymi komorami nabojowymi skierowaną w górę lub dół. Dopuszcza się stosowanie flag bezpieczeństwa wskazujących pustą komorę nabojową. W przypadku pistoletów i rewolwerów dozwolone jest ich noszenie w kaburach. Dopuszcza się inny sposób przenoszenia broni, jeśli tak stanowi regulamin zawodów.\n\n' +
      '2. Wyjmowanie broni odbywa się wyłącznie na stanowisku strzeleckim lub treningowym tylko na polecenie prowadzącego strzelanie lub trening strzelecki.\n\n' +
      '3. Wszelkich czynności związanych z obsługą broni dokonuje się wyłącznie z lufą skierowaną w kierunku kulochwytu, tarcz bądź przedmiotów będących celem na strzelnicy.\n\n' +
      '4. Strzelanie rozpoczyna się wyłącznie na komendę prowadzącego strzelanie.\n\n' +
      '5. Zakończenie strzelania zgłasza się prowadzącemu strzelanie.\n\n' +
      '6. Po zakończeniu strzelania broń rozładowuje się i przedstawia do kontroli prowadzącemu strzelanie oraz opuszcza się stanowisko strzeleckie z bronią rozładowaną.\n\n' +
      '7. Strzelanie i celowanie na strzelnicy odbywa się wyłącznie na wyznaczonych stanowiskach, do tarcz lub innych przedmiotów będących celem strzeleckim na strzelnicy. Tarcze (cele strzeleckie) umieszcza się na tle kulochwytu, gdzie górna krawędź jest nie wyżej niż 160 cm od ziemi.\n\n' +
      '8. Broń można odłożyć wyłącznie w stanie rozładowanym w miejscu i na kierunku bezpiecznym wskazanym przez prowadzącego strzelanie.\n\n' +
      '## Rozdział 3. Sposób zachowania się osób przebywających na strzelnicy\n\n' +
      '1. Korzystający ze strzelnicy jest obowiązany ściśle przestrzegać poleceń wydawanych przez prowadzącego strzelanie.\n\n' +
      '2. Zabrania się wchodzenia przed stanowisko strzeleckie bez zgody prowadzącego strzelanie.\n\n' +
      '3. Korzystający ze strzelnicy, z wyjątkiem osoby niepełnosprawnej, obowiązany jest przestrzegać przepisów dotyczących postaw strzeleckich.\n\n' +
      '4. Po komendzie „STOP” lub „PRZERWIJ OGIEŃ” lub innej podobnej komendy nakazującej zaprzestanie strzelania, wydanej przez dowolną osobę, strzelający bezzwłocznie przerywają strzelanie.\n\n' +
      '5. Każda osoba przebywająca na strzelnicy musi niezwłocznie powiadomić prowadzącego strzelanie o sytuacji, która może być niebezpieczna, lub spowodować wypadek.\n\n' +
      '6. Na teren strzelnicy zwierzęta mogą być wprowadzone tylko w wyjątkowych przypadkach oraz obowiązkowo powinny być trzymane na uwięzi i pod ścisłym nadzorem opiekuna.\n\n' +
      '7. Osobę naruszającą regulamin można usunąć ze strzelnicy.\n\n' +
      '8. Dzieci mogą przebywać na strzelnicy wyłącznie pod bezpośrednim nadzorem rodziców lub opiekunów.\n\n' +
      '9. Każda osoba jest zobowiązana zabrać ze sobą wyprodukowane przez siebie śmieci.\n\n' +
      '## Rozdział 4. Dodatkowe warunki bezpieczeństwa\n\n' +
      '1. Osoba korzystająca ze strzelnicy, nie stosująca się do zasad określonych w regulaminie strzelnicy ponosi wszelką odpowiedzialność za wyrządzone szkody.\n\n' +
      '2. Osoba która narusza przepisy regulaminu określającego zasady zachowania bezpieczeństwa na strzelnicy podlega karze aresztu lub grzywny, zgodnie z ustawą o broni i amunicji.\n\n' +
      '3. Osoby przebywające na strzelnicy powinny stosować ochronniki słuchu.\n\n' +
      '4. Wyjmowanie broni dozwolone jest w miejscach do tego wyznaczonych, stosując się do zasad opisanych w rozdziale nr 2, punkt nr 3.\n\n' +
      '5. Prowadzący strzelanie może odmówić możliwości korzystania ze strzelnicy wobec konkretnej osoby lub grupy osób, jeśli uzna, że osoby te z dużym prawdopodobieństwem mogą spowodować powstanie zagrożenia. Decyzja ta jest decyzją subiektywną i autonomiczną prowadzącego strzelanie. Decyzja ta jest decyzją ostateczną.\n\n' +
      '6. Gospodarz strzelnicy nie ponosi odpowiedzialności za rzeczy pozostawione na terenie strzelnicy bez nadzoru.',
    noticeHeading: 'Klauzula informacyjna',
    confirm: 'Podpisując, potwierdzasz zapoznanie się z regulaminem strzelnicy.',
    padLabel: 'Pole podpisu — podpisz się palcem lub rysikiem',
    save: 'Zapisz wpis',
    saving: 'Zapisuję…',
    clear: 'Wyczyść',
    otherPass: 'Wybierz inne uprawnienie',
    cancel: 'Anuluj wpis',
    errorSave: 'Nie udało się zapisać wpisu. Spróbuj ponownie.',
    errorPassUsed: 'Uprawnienie zostało właśnie wykorzystane — wybierz inne.',
    errorOfficer: 'Brak dyżurnego. Wybierz, kto prowadzi dziś strzelanie.',
    // SPEC-007 §6, §7: prowadzący wybrany przy wpisie zniknął z listy — podpis zostaje na ekranie.
    errorOfficerInactive: 'Ten prowadzący nie jest już dostępny — wybierz innego.',
    officerLabel: 'Prowadzący:',
    officerChangeSr: 'prowadzącego tego wpisu',
    done: 'Wpisano do książki: {name}, {time}.',
    addCompanion: 'Dodaj osobę towarzyszącą',
  },
  rangeHistory: {
    todayTitle: 'Dzisiejsze wpisy',
    todayEmpty: 'Dziś nie ma jeszcze wpisów.',
    loadError: 'Nie udało się wczytać wpisów. Odśwież stronę.',
    companionTag: 'osoba towarzysząca',
    annotationsLabel: 'Adnotacje',
    annotation: '{author}, {time}: {body}',
    addAnnotation: 'Dodaj adnotację',
    addAnnotationSr: 'do wpisu: {name}, {time}',
    annotationLabel: 'Treść adnotacji (5–500 znaków)',
    annotationSave: 'Zapisz adnotację',
    annotationCancel: 'Anuluj',
    annotationTooShort: 'Adnotacja musi mieć co najmniej 5 znaków.',
    annotationTooLong: 'Adnotacja może mieć najwyżej 500 znaków.',
    annotationError: 'Nie udało się zapisać adnotacji. Spróbuj ponownie.',
    annotationForbidden: 'Adnotację do wpisu z innego dnia może dodać tylko admin.',
    entriesTitle: 'Historia wejść',
    entriesEmpty: 'Nie masz jeszcze wpisów w książce rejestru pobytu.',
    entryDate: 'Data i godzina',
    entryOfficer: 'Prowadzący',
    entryPass: 'Uprawnienie',
    companion: 'osoba towarzysząca',
    noPass: '—',
    usageTitle: 'Historia zużycia',
    usageEmpty: 'Brak zużyć.',
    passesTitle: 'Karnety i zużycie',
    passesEmpty: 'Brak karnetów.',
    revert: 'Cofnij zużycie',
    revertSr: 'z dnia {time}',
    revertConfirm: 'Cofnąć zużycie z {time}? Wpis w książce zostanie, dostanie adnotację.',
    revertDone: 'Cofnięto zużycie karnetu.',
    revertAlready: 'To zużycie zostało już cofnięte.',
    revertForbidden: 'Cofnąć zużycie może tylko admin.',
    revertError: 'Nie udało się cofnąć zużycia. Spróbuj ponownie.',
    auditRevert: 'Cofnięto zużycie karnetu z dnia {date}',
  },
  rangeReview: {
    title: 'Przegląd książki rejestru pobytu',
    intro: 'Każde wyświetlenie podpisów i każdy eksport zapisuje się w dzienniku zmian.',
    filtersHeading: 'Filtry',
    from: 'Data od',
    to: 'Data do',
    person: 'Imię i nazwisko',
    officer: 'Prowadzący strzelanie',
    anyOfficer: 'Wszyscy',
    filter: 'Pokaż',
    exportPdf: 'Eksport PDF',
    exportCsv: 'Eksport CSV',
    exporting: 'Przygotowuję plik…',
    dateRangeRequired: 'Do eksportu wybierz dzień lub zakres dat (od nie później niż do).',
    loading: 'Wczytywanie…',
    summary: 'Wpisów: {count}',
    empty: 'Brak wpisów w wybranym zakresie.',
    loadError: 'Nie udało się wczytać książki. Spróbuj ponownie.',
    exportError: 'Nie udało się przygotować eksportu. Spróbuj ponownie.',
    colSignature: 'Podpis',
    signatureAlt: 'Podpis: {name}',
    signatureError: 'Nie udało się wczytać podpisu.',
    signatureYes: 'tak',
    pdfTitle: 'Książka rejestru pobytu na strzelnicy Steel Valley',
    pdfRange: 'Zakres dat: {range}',
    pdfPage: 'Strona {page} z {pages}',
  },
  scan: {
    title: 'Skanuj kod QR',
    starting: 'Uruchamiam kamerę…',
    hint: 'Skieruj kamerę na kod QR z konta osoby.',
    noCamera: 'Brak dostępu do kamery. Zamknij okno i wyszukaj osobę po imieniu i nazwisku lub e-mailu.',
    close: 'Zamknij',
  },
  rulebooks: {
    title: 'Regulaminy',
    intro:
      'Biblioteka regulaminów do wyboru przy zawodach. Pliku nie można podmienić — aby zmienić treść, wczytaj nowy regulamin; tytuł można poprawić.',
    addHeading: 'Wczytaj regulamin',
    titleLabel: 'Tytuł',
    fileLabel: 'Plik PDF (maks. 20 MB)',
    personalDataHint: 'Nie wczytuj plików z danymi osobowymi zawodników.',
    upload: 'Wczytaj',
    uploading: 'Wczytywanie pliku…',
    listHeading: 'Lista regulaminów',
    empty: 'Biblioteka jest pusta. Wczytaj pierwszy regulamin.',
    uploadedOn: 'Wczytano {date}',
    usage: 'Liczba zawodów: {count}',
    archivedTag: 'Zarchiwizowany',
    download: 'Pobierz PDF',
    rename: 'Zmień tytuł',
    newTitleLabel: 'Nowy tytuł',
    save: 'Zapisz',
    cancel: 'Anuluj',
    archive: 'Archiwizuj',
    restore: 'Przywróć',
    delete: 'Usuń',
    confirmDelete: 'Czy na pewno usunąć regulamin „{title}”? Tej operacji nie można cofnąć.',
    deleted: 'Usunięto.',
    deleteError: 'Nie udało się usunąć. Spróbuj ponownie.',
    inUse: 'Tego regulaminu używają zawody — nie można go usunąć. Możesz go zarchiwizować.',
    titleRequired: 'Podaj tytuł.',
    titleTooLong: 'Tytuł może mieć najwyżej {max} znaków.',
    fileRequired: 'Wybierz plik PDF.',
    fileNotPdf: 'Dozwolony jest tylko plik PDF.',
    fileTooLarge: 'Plik jest za duży (maks. 20 MB).',
  },
  competition: {
    titleNew: 'Nowe zawody',
    titleEdit: 'Edycja zawodów',
    backToCalendar: 'Wróć do kalendarza',
    nameLabel: 'Nazwa *',
    disciplineLabel: 'Dyscyplina *',
    startsOnLabel: 'Data początku *',
    endsOnLabel: 'Data końca (opcjonalnie)',
    endsOnHint: 'Dla zawodów wielodniowych.',
    descriptionLabel: 'Opis',
    descriptionHint: 'Zwykły tekst; pusta linia zaczyna nowy akapit.',
    rulebookLabel: 'Regulamin',
    rulebookHint: 'Regulamin z biblioteki jest wymagany do publikacji.',
    choose: '— wybierz —',
    rulebookOption: '{title} (wczytano {date})',
    archivedSuffix: ' — zarchiwizowany',
    hiddenSuffix: ' — ukryta',
    requiredHint: 'Pola oznaczone * są wymagane.',
    save: 'Zapisz',
    fixErrors: 'Popraw zaznaczone pola.',
    nameRequired: 'Podaj nazwę.',
    nameTooLong: 'Nazwa może mieć najwyżej {max} znaków.',
    disciplineRequired: 'Wybierz dyscyplinę.',
    startsOnRequired: 'Podaj datę początku.',
    endBeforeStart: 'Data końca nie może być wcześniejsza niż data początku.',
    descriptionTooLong: 'Opis może mieć najwyżej {max} znaków.',
    preview: 'Podgląd',
    afterFirstSave: 'Matchbook i harmonogram dodasz po pierwszym zapisie zawodów.',
    notFound: 'Nie znaleziono zawodów. Mogły zostać usunięte.',
    deleteHeading: 'Usuwanie',
    delete: 'Usuń zawody',
    deleteHint: 'Usunięcie obejmuje harmonogram i plik matchbooka.',
    publishedNoDelete: 'Opublikowanych zawodów nie można usunąć — najpierw cofnij publikację.',
    confirmDelete: 'Czy na pewno usunąć zawody „{name}”? Tej operacji nie można cofnąć.',
    deleteError: 'Nie udało się usunąć. Spróbuj ponownie.',
    publish: 'Opublikuj',
    unpublish: 'Cofnij publikację',
    published: 'Opublikowano.',
    unpublished: 'Cofnięto publikację.',
    rulebookRequired: 'Aby opublikować zawody, wybierz regulamin.',
    confirmUnpublish: 'Czy na pewno cofnąć publikację zawodów „{name}”? Po odświeżeniu strony publicznej ich strona przestanie istnieć.',
  },
  // SPEC-012 US-8 (AC-40…AC-43): karnety nie obowiązują w dniach wydarzeń i zawodów.
  passBlocking: {
    label: 'Karnety i wejścia jednorazowe nie obowiązują w dniach tego wpisu',
    hint: 'Odznacz tylko, gdy wpis nie zajmuje strzelnicy (np. wydarzenie poza strzelnicą).',
    rangeEntry: 'Dziś: {name} — karnety i wejścia jednorazowe nie obowiązują. Wejście na zasadach wydarzenia (wejściówka).',
    saleWarning: 'Karnet nie obowiązuje dziś ({name}).',
  },
  // SPEC-012 US-5 (AC-23…AC-29, AC-51): odwołanie wydarzenia w panelu.
  eventCancel: {
    heading: 'Odwołanie wydarzenia',
    open: 'Odwołaj wydarzenie',
    dialogText:
      'Wydarzenie zostanie oznaczone jako odwołane. Wszystkie wejściówki zostaną anulowane, a pieniądze zwrócone: online — automatycznie przez Tpay ({online}), na miejscu — lista do zwrotu ({onSite}). Kupujący z kontem dostaną e-mail. Tej operacji nie można cofnąć.',
    reasonLabel: 'Powód odwołania (widoczny publicznie) *',
    reasonHint: 'Nie wpisuj danych osobowych.',
    reasonInvalid: 'Powód odwołania musi mieć od 3 do 200 znaków.',
    confirm: 'Odwołaj wydarzenie',
    back: 'Wróć',
    cancelling: 'Odwołuję wydarzenie…',
    done: 'Wydarzenie odwołane.',
    refundsQueued: 'Zwroty Tpay: zlecono {requested}, nieudane {failed}. Pozostałe zostaną zlecone automatycznie w ciągu kilkunastu minut.',
    tag: 'Odwołane',
    cancelledInfo: 'Wydarzenie odwołane. Zmienić można tylko opis i powód odwołania.',
    errorAlreadyCancelled: 'To wydarzenie jest już odwołane.',
    errorEnded: 'Wydarzenie już się zakończyło — nie można go odwołać.',
    errorNotPublished: 'Odwołać można tylko opublikowane wydarzenie.',
    error: 'Nie udało się odwołać wydarzenia. Spróbuj ponownie.',
    refundsHeading: 'Zwroty po odwołaniu',
    refundsEmpty: 'Brak zwrotów.',
    colPerson: 'Osoba',
    colNumber: 'Numer zamówienia',
    colMethod: 'Metoda',
    colAmount: 'Kwota',
    colState: 'Stan',
    noAccount: 'Osoba bez konta',
    methodTpay: 'Online (Tpay)',
    methodOnSite: 'Na miejscu',
    statePending: 'Zwrot w toku',
    stateRefunded: 'Zwrócone',
    stateOnSite: 'Do zwrotu na miejscu',
    stateFailed: 'Zwrot Tpay nieudany',
    retry: 'Ponów zwrot',
    retrying: 'Zlecam zwrot…',
    retried: 'Zwrot zlecony w Tpay.',
    retryError: 'Nie udało się zlecić zwrotu. Spróbuj ponownie.',
    // §6: błąd `event_cancelled` (sprzedaż online, na miejscu, przyznanie)
    eventCancelled: 'Wydarzenie zostało odwołane.',
  },
  // SPEC-012 US-6 (AC-30…AC-34): zamknięcie strzelnicy i przedłużenie ważności.
  rangeClosures: {
    title: 'Zamknięcia strzelnicy',
    intro:
      'Zamknięcie dłuższe niż 7 kolejnych dni przedłuża ważność uprawnień o liczbę dni zamknięcia. Wpisz je po zakończeniu zamknięcia. Zapisu nie można cofnąć.',
    formHeading: 'Nowe zamknięcie',
    from: 'Od *',
    to: 'Do *',
    toHint: 'Ostatni dzień zamknięcia — nie później niż dziś.',
    reason: 'Przyczyna *',
    reasonHint: 'Widoczna tylko dla admina. Nie wpisuj danych osobowych.',
    next: 'Dalej',
    checking: 'Sprawdzam…',
    preview: 'Zamknięcie: {days} dni. Ważność przedłuży się o {days} dni dla {count} uprawnień.',
    confirm: 'Zapisz i przedłuż',
    back: 'Wróć',
    saving: 'Zapisuję…',
    saved: 'Zapisano. Przedłużono ważność {count} uprawnień o {days} dni.',
    datesRequired: 'Podaj daty „Od” i „Do”.',
    rangeInvalid: 'Dzień „Do” nie może być wcześniejszy niż „Od”.',
    notEnded: 'Dzień „Do” nie może być późniejszy niż dziś.',
    tooShort: 'Przedłużenie przysługuje przy zamknięciu dłuższym niż 7 kolejnych dni.',
    overlap: 'Ten okres nakłada się na zapisane zamknięcie.',
    reasonInvalid: 'Przyczyna musi mieć od 3 do 200 znaków.',
    error: 'Nie udało się zapisać zamknięcia. Spróbuj ponownie.',
    listHeading: 'Zapisane zamknięcia',
    empty: 'Brak zapisanych zamknięć.',
    colPeriod: 'Okres',
    colDays: 'Dni',
    colReason: 'Przyczyna',
    colPasses: 'Uprawnienia',
    colBy: 'Kto',
    colAt: 'Kiedy',
    // AC-33: przy karnecie w `/konto/`.
    extended: 'Przedłużono o {days} dni (zamknięcie strzelnicy {period}).',
  },
  // SPEC-012 US-7 (AC-35…AC-39): godziny otwarcia — panel, `/oferta/#godziny`, stopka.
  openingHours: {
    title: 'Godziny otwarcia',
    link: 'Godziny otwarcia',
    weekdays: {
      d1: 'Poniedziałek',
      d2: 'Wtorek',
      d3: 'Środa',
      d4: 'Czwartek',
      d5: 'Piątek',
      d6: 'Sobota',
      d7: 'Niedziela',
    },
    open: 'Otwarte',
    closed: 'Zamknięte',
    from: 'Od',
    to: 'Do',
    soon: 'Godziny otwarcia wkrótce.',
    loading: 'Wczytywanie godzin otwarcia…',
    loadError: 'Nie udało się wczytać godzin otwarcia. Odśwież stronę.',
    exceptionsHeading: 'Wyjątki',
    blockedHeading: 'Dni wydarzeń i zawodów — karnety i wejścia jednorazowe nie obowiązują:',
    blockedEmpty: 'Brak w najbliższych 30 dniach.',
    calendarLink: 'Zobacz w kalendarzu',
    // Panel
    intro: 'Godziny są informacją dla klientów (strona „Oferta”) i nie blokują wpisów do książki. Zmiany widać od razu.',
    weekHeading: 'Tydzień',
    saveWeek: 'Zapisz godziny',
    exceptionHeading: 'Nowy wyjątek',
    exceptionHint: 'Wyjątek zastępuje godziny dnia tygodnia. Wyjątki znikają 30 dni po swojej dacie.',
    day: 'Data *',
    state: 'Stan',
    note: 'Opis (publiczny)',
    noteHint: 'Do 100 znaków, np. „Wigilia”. Nie wpisuj danych osobowych.',
    addException: 'Zapisz wyjątek',
    remove: 'Usuń',
    removeLabel: 'Usuń wyjątek {day}',
    exceptionsEmpty: 'Brak wyjątków.',
    colDay: 'Data',
    colHours: 'Godziny',
    colNote: 'Opis',
    saving: 'Zapisuję…',
    saved: 'Zapisano.',
    dayRequired: 'Podaj datę wyjątku.',
    timesRequired: 'Podaj godziny „Od” i „Do” albo wybierz „Zamknięte”.',
    closeAfterOpen: 'Godzina zamknięcia musi być późniejsza niż otwarcia.',
    noteTooLong: 'Opis może mieć najwyżej 100 znaków.',
    error: 'Nie udało się zapisać. Spróbuj ponownie.',
  },
  calendarEvent: {
    titleNew: 'Nowe wydarzenie',
    titleEdit: 'Edycja wydarzenia',
    backToCalendar: 'Wróć do kalendarza',
    requiredHint: 'Pola oznaczone * są wymagane.',
    nameLabel: 'Nazwa *',
    categoryLabel: 'Kategoria *',
    choose: '— wybierz —',
    hiddenSuffix: ' — ukryta',
    noCategories: 'Brak aktywnych kategorii. Dodaj kategorię w zakładce „Kategorie”.',
    startsOnLabel: 'Data początku *',
    endsOnLabel: 'Data końca (opcjonalnie)',
    endsOnHint: 'Dla wydarzeń wielodniowych.',
    descriptionLabel: 'Opis',
    descriptionHint: 'Zwykły tekst (maks. {max} znaków); pusta linia zaczyna nowy akapit.',
    personalDataHint: 'Nie wpisuj danych kontaktowych osób prywatnych; szczegóły podaje strona organizatora.',
    urlLabel: 'Link do szczegółów',
    urlHint: 'Strona organizatora wydarzenia ze szczegółami, np. wydarzenie na Facebooku.',
    urlPublishHint: 'Link jest wymagany do publikacji (tryb „Zewnętrzne”).',
    modeLegend: 'Tryb *',
    modeExternal: 'Zewnętrzne — organizator rozlicza u siebie',
    modeFree: 'Otwarte, bezpłatne',
    modePaid: 'Płatne przez Ofertę',
    priceLabel: 'Cena wejściówki (zł) *',
    capacityLabel: 'Limit miejsc (opcjonalnie)',
    capacityHint: 'Od 1 do 1000. Puste pole — bez limitu.',
    priceRequired: 'Podaj cenę wejściówki.',
    priceInvalid: 'Podaj cenę w złotych, np. 50 lub 49,99.',
    capacityInvalid: 'Limit miejsc to liczba od 1 do 1000.',
    hasTickets: 'Wydarzenie ma sprzedane wejściówki — zmiana niedostępna.',
    capacityBelowSold: 'Limit nie może być mniejszy niż liczba sprzedanych wejściówek.',
    save: 'Zapisz',
    publish: 'Opublikuj',
    unpublish: 'Cofnij publikację',
    fixErrors: 'Popraw zaznaczone pola.',
    nameRequired: 'Podaj nazwę.',
    nameTooLong: 'Nazwa może mieć najwyżej {max} znaków.',
    categoryRequired: 'Wybierz kategorię.',
    startsOnRequired: 'Podaj datę początku.',
    endBeforeStart: 'Data końca nie może być wcześniejsza niż data początku.',
    descriptionTooLong: 'Opis może mieć najwyżej {max} znaków.',
    urlInvalid: 'Podaj pełny adres strony, np. https://…',
    urlRequired: 'Aby opublikować wydarzenie, podaj link do szczegółów.',
    published: 'Opublikowano.',
    unpublished: 'Cofnięto publikację.',
    confirmUnpublish: 'Czy na pewno cofnąć publikację wydarzenia „{name}”? Po odświeżeniu strony publicznej zniknie ono z kalendarza.',
    notFound: 'Nie znaleziono wydarzenia. Mogło zostać usunięte.',
    previewHeading: 'Podgląd karty w kalendarzu',
    previewEmpty: 'Podaj nazwę, kategorię i datę początku, aby zobaczyć podgląd karty.',
    deleteHeading: 'Usuwanie',
    delete: 'Usuń wydarzenie',
    confirmDelete: 'Czy na pewno usunąć wydarzenie „{name}”? Tej operacji nie można cofnąć.',
    deleted: 'Usunięto wydarzenie.',
    deleteError: 'Nie udało się usunąć. Spróbuj ponownie.',
  },
  matchbook: {
    heading: 'Matchbook',
    none: 'Brak matchbooka (opcjonalny).',
    download: 'Pobierz matchbook (PDF)',
    fileLabel: 'Plik PDF (maks. 20 MB)',
    upload: 'Wczytaj matchbook',
    replace: 'Podmień matchbook',
    uploading: 'Wczytywanie pliku…',
    remove: 'Usuń matchbook',
    confirmRemove: 'Czy na pewno usunąć matchbook? Tej operacji nie można cofnąć.',
    removed: 'Usunięto matchbook.',
  },
  schedule: {
    heading: 'Harmonogram',
    empty: 'Brak punktów harmonogramu.',
    day: 'Dzień',
    time: 'Godzina',
    timeOptional: 'Godzina (opcjonalnie)',
    description: 'Opis',
    actions: 'Akcje',
    addHeading: 'Dodaj punkt',
    editHeading: 'Edytuj punkt',
    add: 'Dodaj punkt',
    save: 'Zapisz punkt',
    cancel: 'Anuluj',
    edit: 'Edytuj',
    delete: 'Usuń',
    confirmDelete: 'Czy na pewno usunąć punkt harmonogramu „{description}”?',
    deleted: 'Usunięto punkt.',
    dayRequired: 'Podaj dzień.',
    dayOutOfRange: 'Dzień musi mieścić się w terminie zawodów.',
    descriptionRequired: 'Podaj opis.',
    descriptionTooLong: 'Opis może mieć najwyżej {max} znaków.',
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Struktura słownika — wspólna dla wszystkich wersji językowych. */
export type Dictionary = Widen<typeof pl>;
