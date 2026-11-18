/**
 * Lista słownikowa — dyscypliny i kategorie wydarzeń (SPEC-001 US-3, US-10),
 * prowadzący strzelanie (SPEC-005 US-1). Logika bez DOM: walidacja nazwy, kolejność na liście.
 */
import { t, type MessageKey } from '../i18n';

/** Maks. długość nazwy po `trim` (`check` w bazie). */
export const DICTIONARY_NAME_MAX = 80;

export type DictionaryTable = 'disciplines' | 'event_categories' | 'range_officers';
export type DictionaryKind = 'disciplines' | 'categories' | 'officers';

/** Ustawienia listy: tabela, kolumna nazwy, długość (jak `check` w bazie), unikalność, przebudowa strony. */
export interface DictionaryConfig {
  table: DictionaryTable;
  column: 'name' | 'full_name';
  min: number;
  max: number;
  unique: boolean;
  rebuild: boolean;
}

export const DICTIONARIES: Record<DictionaryKind, DictionaryConfig> = {
  disciplines: { table: 'disciplines', column: 'name', min: 1, max: DICTIONARY_NAME_MAX, unique: true, rebuild: true },
  categories: { table: 'event_categories', column: 'name', min: 1, max: DICTIONARY_NAME_MAX, unique: true, rebuild: true },
  // SPEC-005 AC-1: imię i nazwisko 2–150 znaków; ta sama osoba może się powtórzyć (bez indeksu unikalnego).
  officers: { table: 'range_officers', column: 'full_name', min: 2, max: 150, unique: false, rebuild: false },
};

export interface DictionaryItem {
  id: string;
  name: string;
  is_active: boolean;
}

export type NameError = 'required' | 'tooShort' | 'tooLong' | 'duplicate';

/** Klucz porównania — jak unikalny indeks w bazie: `lower(trim(name))`. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Sprawdza nazwę przed zapisem (AC-9, AC-46; SPEC-005 AC-1). `ownId` — edytowany wpis (zmiana nazwy na tę samą
 * w innej wielkości liter nie jest duplikatem).
 */
export function validateName(
  name: string,
  items: readonly DictionaryItem[],
  ownId?: string,
  config: Pick<DictionaryConfig, 'min' | 'max' | 'unique'> = DICTIONARIES.disciplines,
): NameError | null {
  const trimmed = name.trim();
  if (!trimmed) return 'required';
  const length = [...trimmed].length;
  if (length < config.min) return 'tooShort';
  if (length > config.max) return 'tooLong';
  if (!config.unique) return null;
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

/** Teksty, które lista może nadpisać we własnej sekcji `dictionary.<kind>` (np. „Imię i nazwisko” zamiast „Nazwa”). */
export type DictionaryTextKey =
  | 'nameLabel'
  | 'newNameLabel'
  | 'rename'
  | 'active'
  | 'hidden'
  | 'required'
  | 'tooShort'
  | 'tooLong';

/** Tekst listy: najpierw `dictionary.<kind>.<key>`, potem wspólny `dictionary.<key>`. */
export function dictionaryText(
  kind: DictionaryKind,
  key: DictionaryTextKey,
  params: Record<string, string | number> = {},
): string {
  try {
    return t(`dictionary.${kind}.${key}` as MessageKey, params);
  } catch {
    return t(`dictionary.${key}` as MessageKey, params);
  }
}
