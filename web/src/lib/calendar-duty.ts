/**
 * Dyżurny Prowadzący zawodów i wydarzeń (SPEC-007 US-7, AC-26…AC-30). Logika bez DOM — pole w formularzach:
 * components/DutyOfficerField.astro + lib/calendar-duty-ui.ts.
 *
 * Kolumna `duty_range_officer_id` jest niepubliczna (AC-30): formularz czyta ją funkcją `admin_calendar_duty`,
 * a zapisuje razem z formularzem. „Na liście” i nakładanie terminów sprawdza wyzwalacz w bazie (AC-28, AC-29).
 */
import { t } from '../i18n';
import { formatDate } from './dates';

export type CalendarKind = 'competition' | 'event';

export interface CalendarDuty {
  range_officer_id: string;
  full_name: string;
  /** `false` — prowadzący ukryty lub cofnięty do `pending` po zapisie (AC-28). */
  on_list: boolean;
}

/** Wynik `admin_calendar_duty` — pierwszy wiersz albo `null` („Nie wskazano”). */
export function calendarDutyFromRows(data: unknown): CalendarDuty | null {
  const row = Array.isArray(data) ? (data[0] as CalendarDuty | undefined) : undefined;
  return row?.range_officer_id ? row : null;
}

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Komunikat przy polu dla błędu zapisu z wyzwalacza: `range_officer_inactive` (AC-28) albo `range_duty_conflict`
 * z `detail` = `{"day": "YYYY-MM-DD", "name": "…"}` (AC-29). Inne błędy — `null` (obsługuje formularz).
 */
export function calendarDutyError(error: DbError | null | undefined): string | null {
  if (error?.code !== 'P0001') return null;
  if (error.message === 'range_officer_inactive') return t('rangeLog.officerInactive');
  if (error.message !== 'range_duty_conflict') return null;
  let detail: { day?: unknown; name?: unknown } = {};
  try {
    detail = JSON.parse(error.details ?? '{}') as typeof detail;
  } catch {
    // Bez szczegółów — komunikat z pustymi polami jest lepszy niż ogólny błąd zapisu.
  }
  const day = typeof detail.day === 'string' ? formatDate(detail.day) : '';
  const name = typeof detail.name === 'string' ? detail.name : '';
  return t('calendarDuty.conflict', { date: day, name });
}

/**
 * AC-30: przebudowa strony publicznej po zapisie — przy publikacji albo gdy opublikowany wpis zmienił pola publiczne.
 * Zmiana samego dyżurnego (pole niepubliczne) jej nie uruchamia. `before` / `after` — wiersz bez dyżurnego.
 */
export function needsRebuild(publish: boolean, wasPublished: boolean, before: object | null, after: object): boolean {
  if (publish) return true;
  if (!wasPublished) return false;
  return JSON.stringify(before) !== JSON.stringify(after);
}
