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
  },
  footer: {
    rangeLink: 'Strzelnica Steel Valley — steel-valley.pl',
    copyright: '© {year} Steel Valley',
  },
  home: {
    title: 'Kalendarz strzelnicy',
    comingSoon: 'Tu pojawi się kalendarz nadchodzących zawodów i wydarzeń na strzelnicy.',
  },
  panel: {
    title: 'Panel organizatora',
    loading: 'Wczytywanie…',
    loadError: 'Nie udało się wczytać danych. Odśwież stronę.',
    signInIntro: 'Zaloguj się, aby prowadzić kalendarz strzelnicy.',
    signIn: 'Zaloguj się przez Google',
    signOut: 'Wyloguj się',
    forbidden: 'Nie masz uprawnień organizatora. Skontaktuj się z administratorem strzelnicy.',
    saved: 'Zapisano.',
    saveError: 'Nie udało się zapisać. Spróbuj ponownie.',
    menu: {
      calendar: 'Kalendarz',
      rulebooks: 'Regulaminy',
      disciplines: 'Dyscypliny',
      categories: 'Kategorie',
    },
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
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Struktura słownika — wspólna dla wszystkich wersji językowych. */
export type Dictionary = Widen<typeof pl>;
