/**
 * Grafik dyżurów (SPEC-007 US-6, AC-22…AC-25). Logika bez DOM — wyspa: lib/range-duty-schedule-ui.ts.
 *
 * Dyżurnego dnia i jego źródło liczy baza (`range_duty_schedule`, kolejność: zmiana w książce → zawody / wydarzenie →
 * grafik); wpis grafiku przychodzi osobno (`schedule_*`), bo „Usuń z grafiku” i podpowiedzi AC-24, AC-25 go dotyczą.
 */
import type { MessageKey } from '../i18n';
import type { DutySource } from './range-duty';

/** AC-22: 30 dni na start i po każdym „Pokaż kolejne 30 dni”; maks. dziś + 90 (91 dni). */
export const SCHEDULE_PAGE_DAYS = 30;
export const SCHEDULE_MAX_DAYS = 91;

export interface ScheduleDay {
  day: string;
  range_officer_id: string | null;
  full_name: string | null;
  source: DutySource | null;
  event_name: string | null;
  schedule_range_officer_id: string | null;
  schedule_full_name: string | null;
  schedule_on_list: boolean | null;
}

type Message = { key: MessageKey; params?: Record<string, string> };

export function scheduleRows(data: unknown): ScheduleDay[] {
  return Array.isArray(data) ? (data as ScheduleDay[]) : [];
}

/** Liczba dni po „Pokaż kolejne 30 dni” (bez przekroczenia 90 dni naprzód). */
export function nextDayCount(current: number): number {
  return Math.min(current + SCHEDULE_PAGE_DAYS, SCHEDULE_MAX_DAYS);
}

/** Data `YYYY-MM-DD` z dniem tygodnia, np. „piątek, 20 listopada”. */
export function formatScheduleDay(day: string): string {
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function hasScheduleEntry(day: ScheduleDay): boolean {
  return Boolean(day.schedule_range_officer_id);
}

/** AC-22: „Ustaw”, gdy dzień nie ma wpisu w grafiku, inaczej „Zmień”. */
export function setLabelKey(day: ScheduleDay): MessageKey {
  return hasScheduleEntry(day) ? 'rangeDutySchedule.change' : 'rangeDutySchedule.set';
}

/** AC-22: źródło dyżurnego — „z grafiku”, „<nazwa zawodów lub wydarzenia>”, „zmiana w książce” (tylko dziś); brak — `null`. */
export function dutySourceLabel(day: ScheduleDay): Message | null {
  if (!day.range_officer_id) return null;
  if (day.source === 'schedule') return { key: 'rangeDutySchedule.sourceSchedule' };
  if (day.source === 'book') return { key: 'rangeDutySchedule.sourceBook' };
  if (day.source === 'event' && day.event_name) return { key: 'rangeDutySchedule.sourceEvent', params: { name: day.event_name } };
  return null;
}

/**
 * Podpowiedź pod dniem: AC-25 — dziś obowiązuje zmiana z książki (grafik to osobny wpis); AC-24 — dzień ma wpis
 * w grafiku, ale obowiązuje dyżurny zawodów lub wydarzenia; AC-17 — prowadzący z grafiku nie jest już „na liście”.
 */
export function dayHint(day: ScheduleDay): Message | null {
  if (day.source === 'book' && day.full_name) return { key: 'rangeDutySchedule.bookHint', params: { name: day.full_name } };
  if (!hasScheduleEntry(day)) return null;
  if (day.schedule_on_list === false) {
    return { key: 'rangeDutySchedule.scheduleUnavailable', params: { name: day.schedule_full_name ?? '' } };
  }
  if (day.source === 'event' && day.event_name) return { key: 'rangeDutySchedule.eventHint', params: { name: day.event_name } };
  return null;
}

/** Komunikat błędu zapisu lub usunięcia wpisu grafiku. */
export function scheduleErrorKey(error: { message?: string } | null | undefined): MessageKey {
  if (error?.message === 'invalid_day') return 'rangeDutySchedule.invalidDay';
  if (error?.message === 'range_officer_inactive') return 'rangeLog.officerInactive';
  return 'rangeLog.dutySaveError';
}
