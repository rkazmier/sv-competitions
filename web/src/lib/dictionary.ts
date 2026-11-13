/**
 * Lista słownikowa — dyscypliny i kategorie wydarzeń (SPEC-001 US-3, US-10).
 * Logika bez DOM: walidacja nazwy, kolejność na liście.
 */

/** Maks. długość nazwy po `trim` (`check` w bazie). */
export const DICTIONARY_NAME_MAX = 80;

export type DictionaryTable = 'disciplines' | 'event_categories';

export interface DictionaryItem {
  id: string;
  name: string;
  is_active: boolean;
}

export type NameError = 'required' | 'tooLong' | 'duplicate';

/** Klucz porównania — jak unikalny indeks w bazie: `lower(trim(name))`. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Sprawdza nazwę przed zapisem (AC-9, AC-46). `ownId` — edytowany wpis (zmiana nazwy na tę samą
 * w innej wielkości liter nie jest duplikatem).
 */
export function validateName(name: string, items: readonly DictionaryItem[], ownId?: string): NameError | null {
  const trimmed = name.trim();
  if (!trimmed) return 'required';
  if ([...trimmed].length > DICTIONARY_NAME_MAX) return 'tooLong';
  const key = nameKey(trimmed);
  if (items.some((item) => item.id !== ownId && nameKey(item.name) === key)) return 'duplicate';
  return null;
}

/** Błąd unikalności z PostgreSQL (np. gdy ktoś inny dodał tę samą nazwę w międzyczasie). */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/** Aktywne przed ukrytymi, w grupie alfabetycznie (pl). */
export function sortItems(items: readonly DictionaryItem[]): DictionaryItem[] {
  return [...items].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'pl'),
  );
}
