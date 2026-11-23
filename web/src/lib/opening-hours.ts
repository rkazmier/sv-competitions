/**
 * Godziny otwarcia strzelnicy (SPEC-012 US-7: AC-35…AC-39) — logika bez DOM.
 * Dni to `YYYY-MM-DD` (Europe/Warsaw), czasy `HH:MM` (baza zwraca `HH:MM:SS`). Ostatecznie waliduje baza (`check`).
 */
import { t, type MessageKey } from '../i18n';
import { formatDate, formatDateRange } from './dates';

export const OPENING_NOTE_MAX = 100;
/** AC-37: wyjątki i dni blokady na najbliższe 30 dni (dziś + 29). */
export const OPENING_LOOKAHEAD_DAYS = 30;
/** ISO: 1 = poniedziałek … 7 = niedziela. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface Hours {
  opens_at: string | null;
  closes_at: string | null;
}
export interface WeekdayHours extends Hours {
  weekday: number;
}
export interface HoursException extends Hours {
  day: string;
  note: string | null;
}
/** Wiersz `rpc/range_blocked_between` (AC-37). */
export interface BlockedEntry {
  kind: 'competition' | 'event';
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

export const weekdayName = (weekday: number): string => t(`openingHours.weekdays.d${weekday}` as MessageKey);

/** `10:00:00` → `10:00`. */
export const shortTime = (value: string): string => value.slice(0, 5);

/** „10:00–18:00” albo „Zamknięte”. */
export function hoursText(hours: Hours): string {
  if (!hours.opens_at || !hours.closes_at) return t('openingHours.closed');
  return `${shortTime(hours.opens_at)}–${shortTime(hours.closes_at)}`;
}

/** AC-39: „Do” później niż „Od”; otwarte wymaga obu godzin. `null` = poprawne (także „Zamknięte”). */
export function hoursError(open: boolean, opensAt: string, closesAt: string): MessageKey | null {
  if (!open) return null;
  if (!opensAt || !closesAt) return 'openingHours.timesRequired';
  return shortTime(closesAt) > shortTime(opensAt) ? null : 'openingHours.closeAfterOpen';
}

/** AC-36: opis do 100 znaków (po przycięciu; pusty → `null`). */
export function normalizeNote(note: string): string | null {
  const value = note.trim();
  return value ? value : null;
}

export const isNoteValid = (note: string): boolean => [...note.trim()].length <= OPENING_NOTE_MAX;

/** `YYYY-MM-DD` + n dni. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** AC-37: tydzień pn–nd; dzień bez wiersza — `null` (nieustawiony). */
export function weekRows(hours: readonly WeekdayHours[]): { weekday: number; hours: WeekdayHours | null }[] {
  return WEEKDAYS.map((weekday) => ({ weekday, hours: hours.find((h) => h.weekday === weekday) ?? null }));
}

/** AC-36, AC-37: wyjątki od dziś na najbliższe 30 dni, rosnąco. */
export function upcomingExceptions(exceptions: readonly HoursException[], today: string): HoursException[] {
  const last = addDays(today, OPENING_LOOKAHEAD_DAYS - 1);
  return exceptions.filter((e) => e.day >= today && e.day <= last).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** „24 grudnia 2026 (Wigilia): Zamknięte”. */
export function exceptionText(exception: HoursException): string {
  const note = exception.note ? ` (${exception.note})` : '';
  return `${formatDate(exception.day)}${note}: ${hoursText(exception)}`;
}

/** AC-37: „Nazwa — 14–15 czerwca 2027”. */
export const blockedText = (entry: BlockedEntry): string =>
  `${entry.name} — ${formatDateRange(entry.starts_on, entry.ends_on)}`;

/** AC-37: link do miesiąca w kalendarzu (kotwica jak na stronie głównej — trwający wpis w bieżącym miesiącu). */
export function blockedHref(entry: BlockedEntry, today: string): string {
  const day = entry.starts_on < today ? today : entry.starts_on;
  return `/#miesiac-${day.slice(0, 7)}`;
}
