/**
 * Zamknięcia strzelnicy (SPEC-012 US-6: AC-30…AC-34) — logika bez DOM.
 * Daty to dni `YYYY-MM-DD` (Europe/Warsaw) — porównanie leksykograficzne jest poprawne.
 * Ostatecznie waliduje baza (`range_closure_preview`, `add_range_closure`).
 */
import { t, type MessageKey } from '../i18n';
import { formatShortDateRange } from './dates';

export const CLOSURE_MIN_DAYS = 8;
export const CLOSURE_REASON_MIN = 3;
export const CLOSURE_REASON_MAX = 200;

/** Wiersz listy `/panel/zamkniecia/` (AC-34); autor przez `profiles!range_closures_created_by_fkey`. */
export interface RangeClosure {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
  days: number;
  passes_count: number;
  created_at: string;
  author: { full_name: string | null } | null;
}

export const CLOSURE_COLUMNS =
  'id, starts_on, ends_on, reason, days, passes_count, created_at, author:profiles!range_closures_created_by_fkey(full_name)';

/** Wynik `rpc/range_closure_preview` / `rpc/add_range_closure` (AC-30, AC-32). */
export interface ClosureSummary {
  days: number;
  passes_count: number;
}

/** Wiersz `rpc/my_pass_extensions` (AC-33). */
export interface PassExtension {
  user_pass_id: string;
  days: number;
  starts_on: string;
  ends_on: string;
}

/** Liczba dni zamknięcia (obie daty włącznie). */
export function closureDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** AC-30, AC-31: walidacja okresu w przeglądarce (jak w bazie, bez nakładania) — `null` = poprawny. */
export function closurePeriodError(from: string, to: string, today: string): MessageKey | null {
  if (!from || !to) return 'rangeClosures.datesRequired';
  if (from > to) return 'rangeClosures.rangeInvalid';
  if (to > today) return 'rangeClosures.notEnded';
  if (closureDays(from, to) < CLOSURE_MIN_DAYS) return 'rangeClosures.tooShort';
  return null;
}

/** AC-30: przyczyna 3–200 znaków (po przycięciu, jak `check` w bazie). */
export function isClosureReasonValid(reason: string): boolean {
  const length = [...reason.trim()].length;
  return length >= CLOSURE_REASON_MIN && length <= CLOSURE_REASON_MAX;
}

const CLOSURE_ERRORS: Record<string, MessageKey> = {
  invalid_closure_range: 'rangeClosures.rangeInvalid',
  closure_not_ended: 'rangeClosures.notEnded',
  closure_too_short: 'rangeClosures.tooShort',
  closure_overlap: 'rangeClosures.overlap',
  invalid_closure_reason: 'rangeClosures.reasonInvalid',
};

/** Kod błędu RPC → komunikat (inne — ogólny). */
export function closureErrorKey(code: string | null | undefined): MessageKey {
  return CLOSURE_ERRORS[code ?? ''] ?? 'rangeClosures.error';
}

/** AC-34: od najnowszych. */
export function sortClosures(closures: readonly RangeClosure[]): RangeClosure[] {
  return [...closures].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** AC-33: „Przedłużono o 10 dni (zamknięcie strzelnicy 3–12.02.2027).” */
export function extensionText(extension: Pick<PassExtension, 'days' | 'starts_on' | 'ends_on'>): string {
  return t('rangeClosures.extended', {
    days: extension.days,
    period: formatShortDateRange(extension.starts_on, extension.ends_on),
  });
}

/** AC-33: przedłużenia pogrupowane według uprawnienia. */
export function extensionsByPass(extensions: readonly PassExtension[]): Map<string, PassExtension[]> {
  const map = new Map<string, PassExtension[]>();
  for (const extension of extensions) {
    const list = map.get(extension.user_pass_id) ?? [];
    list.push(extension);
    map.set(extension.user_pass_id, list);
  }
  return map;
}
