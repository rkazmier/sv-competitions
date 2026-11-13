/**
 * Wpisy kalendarza strzelnicy: zawody i wydarzenia łączone we frontendzie (SPEC-001 §5).
 * Tu: wspólny typ i kolejność wpisów; grupowanie po miesiącach dojdzie ze stroną publiczną (#10).
 */

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
}

/** Od najbliższych; w tym samym dniu najpierw zawody, potem wydarzenia, w obu grupach wg nazwy (AC-6, AC-35). */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if (a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'competition' ? -1 : 1;
  return a.name.localeCompare(b.name, 'pl');
}

export function sortEntries(entries: readonly CalendarEntry[]): CalendarEntry[] {
  return [...entries].sort(compareEntries);
}
