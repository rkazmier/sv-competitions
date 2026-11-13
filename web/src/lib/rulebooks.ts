/**
 * Biblioteka regulaminów (SPEC-001 US-4, AC-12…16). Logika bez DOM:
 * walidacja pliku i tytułu, ścieżka w Storage, kolejność na liście, data wczytania.
 */

/** Limit pliku — jak bucket `documents` i `check` w bazie (20 MB). */
export const RULEBOOK_MAX_BYTES = 20 * 1024 * 1024;
/** Maks. długość tytułu po `trim` (`check` w bazie). */
export const RULEBOOK_TITLE_MAX = 200;
export const PDF_MIME = 'application/pdf';
export const STORAGE_BUCKET = 'documents';

export interface Rulebook {
  id: string;
  title: string;
  file_path: string;
  file_size: number;
  is_archived: boolean;
  created_at: string;
  /** Liczba zawodów, które używają regulaminu (szkice i opublikowane). */
  usage: number;
}

export type FileError = 'required' | 'notPdf' | 'tooLarge';
export type TitleError = 'required' | 'tooLong';

/** Pierwsze bajty każdego pliku PDF: `%PDF-`. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function hasPdfSignature(head: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => head[index] === byte);
}

/**
 * Sprawdza plik przed wczytaniem (AC-12, AC-13). Typ MIME może być pusty (część telefonów) —
 * wtedy decyduje rozszerzenie; ostatecznie i tak sprawdzamy sygnaturę `%PDF-` (`head`).
 */
export function validateFile(
  file: { name: string; type: string; size: number } | null | undefined,
  head?: Uint8Array,
): FileError | null {
  if (!file) return 'required';
  const typeOk = file.type ? file.type === PDF_MIME : /\.pdf$/i.test(file.name);
  if (!typeOk || file.size === 0) return 'notPdf';
  if (head && !hasPdfSignature(head)) return 'notPdf';
  if (file.size > RULEBOOK_MAX_BYTES) return 'tooLarge';
  return null;
}

export function validateTitle(title: string): TitleError | null {
  const trimmed = title.trim();
  if (!trimmed) return 'required';
  if ([...trimmed].length > RULEBOOK_TITLE_MAX) return 'tooLong';
  return null;
}

/** Ścieżka w Storage: `rulebooks/<uuid>.pdf` — losowa, bez oryginalnej nazwy pliku (SPEC-001 §5, §9). */
export function rulebookPath(id: string): string {
  return `rulebooks/${id}.pdf`;
}

/** Usunąć można tylko regulamin, którego nie używają żadne zawody (AC-15). */
export function canDelete(rulebook: Pick<Rulebook, 'usage'>): boolean {
  return rulebook.usage === 0;
}

/** Niezarchiwizowane przed zarchiwizowanymi, w grupie od najnowszych. */
export function sortRulebooks(items: readonly Rulebook[]): Rulebook[] {
  return [...items].sort(
    (a, b) => Number(a.is_archived) - Number(b.is_archived) || b.created_at.localeCompare(a.created_at),
  );
}

const warsawDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data wczytania jako dzień w Polsce (`YYYY-MM-DD`) — do `formatDate`. */
export function uploadDay(createdAt: string): string {
  return warsawDay.format(new Date(createdAt));
}

/**
 * Wiersz z PostgREST (`competitions(id)`) → `Rulebook`. Liczymy w kliencie, bo `competitions(count)`
 * wymaga uprawnienia do całej tabeli, a klienci mają `select` tylko na kolumnach (bez `created_by`).
 */
export function fromRow(row: Omit<Rulebook, 'usage'> & { competitions?: { id: string }[] | null }): Rulebook {
  const { competitions, ...rest } = row;
  return { ...rest, usage: competitions?.length ?? 0 };
}
