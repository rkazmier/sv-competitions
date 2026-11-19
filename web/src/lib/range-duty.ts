/**
 * Dyżurny Prowadzący (SPEC-007 US-4, AC-15…AC-17, AC-19). Logika bez DOM.
 *
 * Dyżurny jest w bazie — jeden na dzień (Europe/Warsaw, zegar bazy) dla całej strzelnicy. Kolejność źródeł
 * (zmiana w książce → zawody / wydarzenie → grafik) i warunek „na liście” liczy baza (`current_range_duty`);
 * urządzenie niczego nie zapamiętuje i pobiera dyżurnego przy każdym nowym wpisie (§7).
 */
import type { MessageKey } from '../i18n';

export interface RangeOfficer {
  id: string;
  full_name: string;
}

export type DutySource = 'book' | 'event' | 'schedule';

export interface RangeDuty {
  range_officer_id: string;
  full_name: string;
  source: DutySource;
  event_name: string | null;
}

/** Zdarzenia na korzeniu `/panel/ksiazka/` między wyspą dyżurnego a przebiegiem wpisu. */
export const DUTY_CHANGED_EVENT = 'range-duty:changed';
export const DUTY_MISSING_EVENT = 'range-duty:missing';

/** AC-19: wyszukiwarka prowadzących od 3 znaków (jak `staff_search_range_officers`). */
export const OFFICER_SEARCH_MIN_LENGTH = 3;

/** Wynik `current_range_duty` / `set_range_duty` — pierwszy wiersz albo `null` (brak dyżurnego, AC-15). */
export function dutyFromRows(data: unknown): RangeDuty | null {
  const row = Array.isArray(data) ? (data[0] as RangeDuty | undefined) : undefined;
  return row?.range_officer_id ? row : null;
}

/** AC-16: dopisek przy „Dyżurny: …” — „(z grafiku)”, „(<nazwa zawodów lub wydarzenia>)”; zmiana w książce bez dopisku. */
export function dutySourceNote(duty: RangeDuty): { key: MessageKey; params?: Record<string, string> } | null {
  if (duty.source === 'schedule') return { key: 'rangeLog.dutyFromSchedule' };
  if (duty.source === 'event' && duty.event_name) return { key: 'rangeLog.dutyFromEvent', params: { name: duty.event_name } };
  return null;
}

/** Zapytanie wyszukiwarki po przycięciu albo `null`, gdy za krótkie (AC-19). */
export function officerSearchQuery(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= OFFICER_SEARCH_MIN_LENGTH ? trimmed : null;
}

/** Komunikat błędu zapisu dyżurnego. */
export function dutyErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return error?.message === 'range_officer_inactive' ? 'rangeLog.officerInactive' : 'rangeLog.dutySaveError';
}

/** Lista wyboru (AC-15 = AC-18 bez osoby wpisywanej): alfabetycznie po imieniu i nazwisku. */
export function sortOfficers(officers: readonly RangeOfficer[]): RangeOfficer[] {
  return [...officers].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pl'));
}
