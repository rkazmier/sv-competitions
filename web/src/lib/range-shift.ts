/**
 * Prowadzący strzelanie na zmianę (SPEC-005 US-2, AC-3, AC-4). Logika bez DOM.
 *
 * Wybór zapamiętuje urządzenie (localStorage) do końca dnia w Europe/Warsaw. Zapisujemy tylko
 * identyfikator i dzień — imię i nazwisko zawsze z aktualnej listy aktywnych prowadzących.
 * Prowadzący ukryty w trakcie zmiany → wybór unieważniony, trzeba wybrać ponownie (§7).
 * Wpisy (#60, #61) biorą prowadzącego z `currentShiftOfficerId()` — każdy dziedziczy ten sam wybór (AC-4);
 * baza i tak odrzuca nieaktywnego prowadzącego (`range_officer_inactive`).
 */

export const SHIFT_STORAGE_KEY = 'sv-range-shift';

export interface RangeOfficer {
  id: string;
  full_name: string;
}

type ShiftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const warsawDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dzień kalendarzowy w Europe/Warsaw, `YYYY-MM-DD`. */
export function warsawDay(now: Date = new Date()): string {
  return warsawDayFormat.format(now);
}

/** Identyfikator prowadzącego wybranego dziś na tym urządzeniu albo `null` (brak wyboru, wybór z innego dnia). */
export function currentShiftOfficerId(storage: ShiftStorage, now: Date = new Date()): string | null {
  let stored: unknown;
  try {
    stored = JSON.parse(storage.getItem(SHIFT_STORAGE_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  const { id, day } = (stored ?? {}) as { id?: unknown; day?: unknown };
  if (typeof id === 'string' && day === warsawDay(now)) return id;
  if (stored !== null) storage.removeItem(SHIFT_STORAGE_KEY);
  return null;
}

/** Prowadzący dzisiejszej zmiany, o ile nadal jest na liście aktywnych; inaczej wybór jest kasowany. */
export function currentShiftOfficer(
  storage: ShiftStorage,
  activeOfficers: readonly RangeOfficer[],
  now: Date = new Date(),
): RangeOfficer | null {
  const id = currentShiftOfficerId(storage, now);
  if (!id) return null;
  const officer = activeOfficers.find((item) => item.id === id) ?? null;
  if (!officer) storage.removeItem(SHIFT_STORAGE_KEY);
  return officer;
}

/** Zapamiętuje wybór na tym urządzeniu do końca dzisiejszego dnia (Europe/Warsaw). */
export function saveShiftOfficer(storage: ShiftStorage, officerId: string, now: Date = new Date()): void {
  storage.setItem(SHIFT_STORAGE_KEY, JSON.stringify({ id: officerId, day: warsawDay(now) }));
}

/** „Zmień” — kasuje wybór, ekran wraca do pytania „Kto prowadzi strzelanie?”. */
export function clearShiftOfficer(storage: ShiftStorage): void {
  storage.removeItem(SHIFT_STORAGE_KEY);
}
