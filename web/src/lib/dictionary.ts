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
  /** Tylko prowadzący strzelanie (SPEC-005 AC-1); `null` u prowadzących sprzed #104. */
  license_number?: string | null;
  institution?: OfficerInstitution | null;
  institution_other?: string | null;
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

// ===== Prowadzący strzelanie: nr legitymacji i instytucja (SPEC-005 AC-1, AC-1a, #104) =====

/** Kody instytucji jak `check` w bazie; etykiety w i18n `dictionary.officers.institutions.<kod>`. */
export const OFFICER_INSTITUTIONS = ['PZSS', 'LOK', 'PZL', 'OTHER'] as const;
export type OfficerInstitution = (typeof OFFICER_INSTITUTIONS)[number];

export const LICENSE_NUMBER_MAX = 50;
export const INSTITUTION_OTHER_MIN = 2;
export const INSTITUTION_OTHER_MAX = 150;

/** Surowe wartości z formularza. */
export interface OfficerDetailsInput {
  license_number: string;
  institution: string;
  institution_other: string;
}

/** Wiersz do zapisu w `range_officers` (po `trim`; nazwa instytucji tylko przy „Inne”). */
export interface OfficerDetailsRow {
  license_number: string;
  institution: OfficerInstitution;
  institution_other: string | null;
}

export type OfficerDetailsField = keyof OfficerDetailsInput;
export type OfficerDetailsError =
  | 'licenseRequired'
  | 'licenseTooLong'
  | 'institutionRequired'
  | 'institutionOtherRequired'
  | 'institutionOtherTooShort'
  | 'institutionOtherTooLong';

export function isOfficerInstitution(value: string): value is OfficerInstitution {
  return (OFFICER_INSTITUTIONS as readonly string[]).includes(value);
}

/** Błędy pól (wszystkie wymagane; „Nazwa instytucji” tylko przy „Inne”). Pusty obiekt = poprawne. */
export function validateOfficerDetails(
  input: OfficerDetailsInput,
): Partial<Record<OfficerDetailsField, OfficerDetailsError>> {
  const errors: Partial<Record<OfficerDetailsField, OfficerDetailsError>> = {};
  const license = input.license_number.trim();
  if (!license) errors.license_number = 'licenseRequired';
  else if ([...license].length > LICENSE_NUMBER_MAX) errors.license_number = 'licenseTooLong';
  if (!isOfficerInstitution(input.institution)) errors.institution = 'institutionRequired';
  else if (input.institution === 'OTHER') {
    const other = input.institution_other.trim();
    const length = [...other].length;
    if (!other) errors.institution_other = 'institutionOtherRequired';
    else if (length < INSTITUTION_OTHER_MIN) errors.institution_other = 'institutionOtherTooShort';
    else if (length > INSTITUTION_OTHER_MAX) errors.institution_other = 'institutionOtherTooLong';
  }
  return errors;
}

/** Wiersz do zapisu — wywoływać po `validateOfficerDetails` bez błędów. */
export function officerDetailsRow(input: OfficerDetailsInput): OfficerDetailsRow {
  const institution = input.institution as OfficerInstitution;
  return {
    license_number: input.license_number.trim(),
    institution,
    institution_other: institution === 'OTHER' ? input.institution_other.trim() : null,
  };
}

/** Opis pod nazwiskiem na liście: „Nr legitymacji: 123/2024 · PZSS” albo „Brak nr legitymacji”. */
export function formatOfficerDetails(item: Pick<DictionaryItem, 'license_number' | 'institution' | 'institution_other'>): string {
  if (!item.license_number || !item.institution) return t('dictionary.officers.missingDetails');
  const institution =
    item.institution === 'OTHER' && item.institution_other
      ? item.institution_other
      : t(`dictionary.officers.institutions.${item.institution}` as MessageKey);
  return t('dictionary.officers.details', { license: item.license_number, institution });
}
