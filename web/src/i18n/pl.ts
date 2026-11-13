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
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Struktura słownika — wspólna dla wszystkich wersji językowych. */
export type Dictionary = Widen<typeof pl>;
