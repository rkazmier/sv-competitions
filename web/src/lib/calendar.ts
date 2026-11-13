/**
 * Wpisy kalendarza strzelnicy: zawody i wydarzenia łączone we frontendzie (SPEC-001 §5).
 * Kolejność wpisów, „nadchodzące” (Europe/Warsaw) i grupowanie po miesiącach (AC-35).
 * Daty to dni `YYYY-MM-DD` (czas lokalny strzelnicy) — porównanie leksykograficzne jest poprawne.
 */
import { formatMonthHeading } from './dates';

export type CalendarEntryKind = 'competition' | 'event';
export type EntryStatus = 'draft' | 'published';

export interface CalendarEntry {
  kind: CalendarEntryKind;
  id: string;
  name: string;
  /** `YYYY-MM-DD`, czas lokalny strzelnicy */
  startsOn: string;
  endsOn: string | null;
  status: EntryStatus;
  /** Nazwa dyscypliny (zawody) lub kategorii (wydarzenie) */
  label: string;
  /** Zawody: adres strony `/zawody/<slug>/` */
  slug?: string;
  /** Wydarzenie: opis (zwykły tekst) i link do szczegółów */
  description?: string | null;
  externalUrl?: string | null;
}

export interface CalendarMonth {
  /** `YYYY-MM` */
  key: string;
  /** np. „Czerwiec 2027” */
  heading: string;
  entries: CalendarEntry[];
}

/** Strefa strzelnicy — „dziś” liczone w niej, niezależnie od strefy maszyny budującej. */
export const SITE_TIME_ZONE = 'Europe/Warsaw';

/** Od najbliższych; w tym samym dniu najpierw zawody, potem wydarzenia, w obu grupach wg nazwy (AC-6, AC-35). */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if (a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'competition' ? -1 : 1;
  return a.name.localeCompare(b.name, 'pl');
}

export function sortEntries(entries: readonly CalendarEntry[]): CalendarEntry[] {
  return [...entries].sort(compareEntries);
}

/** Dzisiejsza data w Europe/Warsaw jako `YYYY-MM-DD` (§7: wpis „dziś” widoczny przez cały dzień). */
export function todayInWarsaw(now: Date = new Date()): string {
  // `en-CA` formatuje datę jako YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** AC-35: data końca (lub początku, gdy brak końca) jest dziś lub później. */
export function isUpcoming(entry: Pick<CalendarEntry, 'startsOn' | 'endsOn'>, today: string): boolean {
  return (entry.endsOn ?? entry.startsOn) >= today;
}

/**
 * AC-35: nadchodzące wpisy pogrupowane po miesiącach, w miesiącu od najbliższych.
 * Wpis wielodniowy trafia do miesiąca daty początku, a jeśli zaczął się wcześniej i trwa — do bieżącego.
 */
export function upcomingByMonth(entries: readonly CalendarEntry[], today: string): CalendarMonth[] {
  const months = new Map<string, CalendarMonth>();
  for (const entry of sortEntries(entries.filter((e) => isUpcoming(e, today)))) {
    const day = entry.startsOn < today ? today : entry.startsOn;
    const key = day.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = { key, heading: formatMonthHeading(`${key}-01`), entries: [] };
      months.set(key, month);
    }
    month.entries.push(entry);
  }
  return [...months.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}
