/**
 * Formularz wydarzenia w kalendarzu strzelnicy (SPEC-001 US-11, AC-48…53). Logika bez DOM.
 * Daty to dni `YYYY-MM-DD` (czas lokalny strzelnicy) — porównanie leksykograficzne jest poprawne.
 * Ograniczenia odpowiadają `check` w tabeli `calendar_events` (docs/architecture.md).
 */
import type { CalendarEntry } from './calendar';
import { safeExternalUrl } from './text';

export const EVENT_NAME_MAX = 150;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_URL_MAX = 2000;
/** Nazwa `check` w bazie: opublikowane ⇒ link (AC-51). */
export const PUBLISHED_NEEDS_URL = 'calendar_events_published_needs_url';
/** Domyślna nazwa `check` kolumny `external_url` (AC-50). */
export const EXTERNAL_URL_CHECK = 'calendar_events_external_url_check';

export type EventStatus = 'draft' | 'published';

export interface CalendarEventInput {
  name: string;
  category_id: string;
  starts_on: string;
  ends_on: string;
  description: string;
  external_url: string;
}

export type CalendarEventField = keyof CalendarEventInput;
export type CalendarEventError = 'required' | 'tooLong' | 'endBeforeStart' | 'invalidUrl' | 'urlRequired';
export type CalendarEventErrors = Partial<Record<CalendarEventField, CalendarEventError>>;

const length = (value: string) => [...value].length;

/** AC-50: tylko `http://` lub `https://` (jak `check` w bazie — wielkość liter ma znaczenie), maks. 2000 znaków. */
export function isValidExternalUrl(url: string): boolean {
  return /^https?:\/\/\S/.test(url) && length(url) <= EVENT_URL_MAX;
}

/** AC-51: opublikowane (lub publikowane teraz) wydarzenie musi mieć link. */
export function needsExternalUrl(status: EventStatus, url: string): boolean {
  return status === 'published' && !url.trim();
}

/**
 * AC-48: wymagane nazwa (1–150), kategoria, data początku; opis maks. 2000 znaków.
 * AC-49: koniec nie przed początkiem. AC-50: poprawny link. AC-51: link wymagany przy stanie `published`.
 */
export function validateCalendarEvent(input: CalendarEventInput, status: EventStatus = 'draft'): CalendarEventErrors {
  const errors: CalendarEventErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'required';
  else if (length(name) > EVENT_NAME_MAX) errors.name = 'tooLong';
  if (!input.category_id) errors.category_id = 'required';
  if (!input.starts_on) errors.starts_on = 'required';
  if (input.starts_on && input.ends_on && input.ends_on < input.starts_on) errors.ends_on = 'endBeforeStart';
  if (length(input.description.trim()) > EVENT_DESCRIPTION_MAX) errors.description = 'tooLong';
  const url = input.external_url.trim();
  if (url && !isValidExternalUrl(url)) errors.external_url = 'invalidUrl';
  else if (needsExternalUrl(status, url)) errors.external_url = 'urlRequired';
  return errors;
}

/** Wiersz do zapisu: puste pola opcjonalne → `null`. */
export function toEventRow(input: CalendarEventInput) {
  return {
    name: input.name.trim(),
    category_id: input.category_id,
    starts_on: input.starts_on,
    ends_on: input.ends_on || null,
    description: input.description.trim() || null,
    external_url: input.external_url.trim() || null,
  };
}

type DbError = { code?: string; message?: string } | null | undefined;

/** Który `check` z bazy odrzucił zapis (AC-49…51); `null` — inny błąd. */
export function eventCheckError(error: DbError): { field: CalendarEventField; code: CalendarEventError } | null {
  if (error?.code !== '23514') return null;
  const message = error.message ?? '';
  if (message.includes(PUBLISHED_NEEDS_URL)) return { field: 'external_url', code: 'urlRequired' };
  if (message.includes(EXTERNAL_URL_CHECK)) return { field: 'external_url', code: 'invalidUrl' };
  if (message.includes('ends_on')) return { field: 'ends_on', code: 'endBeforeStart' };
  return null;
}

/**
 * Podgląd karty pod formularzem (AC-53): wpis kalendarza z bieżących wartości formularza.
 * `null`, dopóki brakuje nazwy, kategorii lub poprawnego terminu (karty nie da się pokazać).
 */
export function previewEntry(input: CalendarEventInput, categoryName: string | undefined): CalendarEntry | null {
  const name = input.name.trim();
  if (!name || !categoryName || !input.starts_on) return null;
  const endsOn = input.ends_on && input.ends_on >= input.starts_on ? input.ends_on : null;
  const url = input.external_url.trim();
  return {
    kind: 'event',
    id: 'preview',
    name,
    startsOn: input.starts_on,
    endsOn,
    status: 'draft',
    label: categoryName,
    description: input.description,
    externalUrl: isValidExternalUrl(url) ? safeExternalUrl(url) : null,
  };
}
