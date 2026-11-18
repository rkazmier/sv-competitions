/**
 * Podpis i zapis wpisu do książki (SPEC-005 US-5, US-6: AC-13…AC-20). Logika bez DOM, testowana w Vitest.
 * Zapis: PNG do prywatnego bucketu `signatures`, potem `create_range_log_entry` (jedna transakcja w bazie).
 * Interfejs: lib/range-sign-ui.ts i lib/range-entry-ui.ts.
 */
import type { MessageKey } from '../i18n';

/** AC-14: podpis krótszy niż 20 punktów ścieżki → „Zapisz wpis” nieaktywny. */
export const MIN_SIGNATURE_POINTS = 20;
/** AC-15: limit bucketu `signatures`. */
export const MAX_SIGNATURE_BYTES = 200 * 1024;

export interface Point {
  x: number;
  y: number;
}
export type Stroke = Point[];

export function signaturePoints(strokes: readonly Stroke[]): number {
  return strokes.reduce((sum, stroke) => sum + stroke.length, 0);
}

export function isSignatureComplete(strokes: readonly Stroke[]): boolean {
  return signaturePoints(strokes) >= MIN_SIGNATURE_POINTS;
}

const yearMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' });

/** Nazwa obiektu w buckecie: `<RRRR>/<MM>/<id>.png` (miesiąc Europe/Warsaw, jak sprawdza baza). */
export function signaturePath(id: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(yearMonth.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${id}.png`;
}

/** Dane osoby kopiowane do wpisu (z profilu albo podane dla osoby bez konta, AC-18). */
export interface EntryPerson {
  full_name: string | null;
  permit_number: string | null;
  permit_authority: string | null;
  address: string | null;
}

/** AC-13: „Nr decyzji i organ wydający” albo „Adres zamieszkania” — jak kolumna książki. */
export function permitOrAddress(person: EntryPerson): string {
  return person.permit_number ? `${person.permit_number}, ${person.permit_authority ?? ''}` : (person.address ?? '');
}

const dateTimeFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });

/** Data i godzina wpisu w Europe/Warsaw, np. „18.11.2026, 10:32”. */
export function entryDateTime(timestamp: Date | string): string {
  return dateTimeFormat.format(new Date(timestamp));
}

/** AC-16: wykorzystane w międzyczasie uprawnienie → wybór innego; reszta → „Spróbuj ponownie”. */
export function saveErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return error?.message === 'pass_not_valid' ? 'rangeSign.errorPassUsed' : 'rangeSign.errorSave';
}

/** Ponowienie po udanym wysłaniu pliku: Storage odpowiada „już istnieje” — plik jest, można zapisać wpis. */
export function isAlreadyUploaded(error: { message?: string; statusCode?: string } | null | undefined): boolean {
  return error?.statusCode === '409' || /already exists|duplicate/i.test(error?.message ?? '');
}
