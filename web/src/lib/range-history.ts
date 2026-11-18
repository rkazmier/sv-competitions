/**
 * SPEC-005 US-7, US-8 — logika bez DOM: adnotacje (AC-21, AC-22), cofnięcie zużycia (AC-23),
 * „Historia wejść” (AC-24) i historia zużycia karnetu (AC-25).
 */
import type { MessageKey } from '../i18n';

/** Zdarzenie na korzeniu `/panel/ksiazka/` po zapisie wpisu — odświeża listę dzisiejszych wpisów. */
export const ENTRY_SAVED_EVENT = 'range-entry-saved';

export const ANNOTATION_MIN = 5;
export const ANNOTATION_MAX = 500;

/** AC-21: treść adnotacji 5–500 znaków (po przycięciu, jak `check` w bazie). */
export function annotationError(body: string): MessageKey | null {
  const length = body.trim().length;
  if (length < ANNOTATION_MIN) return 'rangeHistory.annotationTooShort';
  if (length > ANNOTATION_MAX) return 'rangeHistory.annotationTooLong';
  return null;
}

/** AC-22: RLS odrzuca adnotację obsługi do wpisu z innego dnia (42501) — osobny komunikat. */
export function annotationSaveErrorKey(code: string | undefined): MessageKey {
  return code === '42501' ? 'rangeHistory.annotationForbidden' : 'rangeHistory.annotationError';
}

/** Adnotacja z autorem (`profiles` przez `created_by`; RLS `profiles: staff read`). */
export interface Annotation {
  id: string;
  entry_id: string;
  body: string;
  created_at: string;
  author: { full_name: string | null } | null;
}

export const ANNOTATION_COLUMNS = 'id, entry_id, body, created_at, author:profiles!range_log_annotations_created_by_fkey(full_name)';

/** AC-21: „kto” — imię i nazwisko autora albo „—”, gdy konto usunięto lub nie ma danych. */
export function annotationAuthor(annotation: Pick<Annotation, 'author'>): string {
  return annotation.author?.full_name ?? '—';
}

/** Adnotacje pogrupowane wg wpisu, od najstarszej. */
export function groupAnnotations(annotations: readonly Annotation[]): Map<string, Annotation[]> {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of [...annotations].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    groups.set(annotation.entry_id, [...(groups.get(annotation.entry_id) ?? []), annotation]);
  }
  return groups;
}

/** Zużycie uprawnienia (`pass_usages`; RLS: własne, obsługa, admin). */
export interface PassUsage {
  id: string;
  used_on: string;
  created_at: string;
  reverted_at: string | null;
}

/** AC-25: historia zużycia — tylko niecofnięte, od najnowszych. */
export function usageHistory<T extends PassUsage>(usages: readonly T[]): T[] {
  return usages.filter((usage) => !usage.reverted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const REVERT_ERRORS: Record<string, MessageKey> = {
  usage_already_reverted: 'rangeHistory.revertAlready',
  forbidden: 'rangeHistory.revertForbidden',
};

/** AC-23: komunikat błędu `revert_pass_usage`. */
export function revertErrorKey(message: string | undefined): MessageKey {
  return (message && REVERT_ERRORS[message]) || 'rangeHistory.revertError';
}

/** Wiersz `my_range_entries()` (AC-24). */
export interface MyRangeEntry {
  id: string;
  entered_at: string;
  range_officer_name: string;
  is_companion: boolean;
  pass_name: string | null;
}

/** AC-24: wykorzystane uprawnienie; osoba towarzysząca — bez uprawnienia; zużycie cofnięte — „—”. */
export function entryPassText(entry: Pick<MyRangeEntry, 'is_companion' | 'pass_name'>): { key: MessageKey } | { text: string } {
  if (entry.pass_name) return { text: entry.pass_name };
  return { key: entry.is_companion ? 'rangeHistory.companion' : 'rangeHistory.noPass' };
}
