/**
 * Wpis osoby z kontem do książki (SPEC-005 US-3, US-4: AC-5…AC-12). Logika bez DOM, testowana w Vitest.
 * Osobę zwracają `staff_find_by_qr` / `staff_person_by_id` / `staff_complete_profile`, uprawnienia —
 * `passes_for_range_entry` (kolejność AC-10 liczy baza). Interfejs: lib/range-entry-ui.ts.
 */
import type { MessageKey } from '../i18n';
import { normalizeProfile, validateProfile, type ProfileErrors, type ProfileField } from './profile';

/** Podsumowanie osoby dla obsługi — minimum danych (AC-5). */
export interface PersonSummary {
  id: string;
  full_name: string | null;
  is_range_ready: boolean;
  missing_fields: string[];
  last_entry_today: string | null;
}

/** Wiersz `passes_for_range_entry` (AC-10). */
export interface EntryPass {
  priority: number;
  id: string;
  kind: 'entries' | 'single_entry' | 'event_ticket';
  item_name: string;
  entries_left: number | null;
  valid_until: string | null;
  expires_on: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Kod QR konta: `qr_token` (base64url, bez danych osobowych). */
const QR_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** AC-5: treść odczytana z kodu → `qr_token`; obcy kod (np. adres strony) → `null` = „Nie znaleziono konta…”. */
export function qrTokenFromScan(text: string): string | null {
  const token = text.trim();
  return QR_TOKEN.test(token) ? token : null;
}

/** `?osoba=<uuid>` — karta użytkownika (AC-8) i powrót ze sprzedaży na miejscu (AC-12). */
export function personIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('osoba');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** AC-12: sprzedaż na miejscu dla osoby; po zapisie strona sprzedaży wraca do wpisu. */
export function saleUrlFor(personId: string): string {
  return `/panel/sprzedaz/?${new URLSearchParams({ osoba: personId, powrot: 'ksiazka' })}`;
}

/** Powrót ze sprzedaży do wpisu tej samej osoby (z nowym uprawnieniem). */
export function entryUrlFor(personId: string): string {
  return `/panel/ksiazka/?${new URLSearchParams({ osoba: personId })}`;
}

/** Strona sprzedaży otwarta z książki (`powrot=ksiazka`) → adres powrotu, inaczej `null`. */
export function entryReturnUrl(search: string): string | null {
  const id = personIdFromSearch(search);
  return id && new URLSearchParams(search).get('powrot') === 'ksiazka' ? entryUrlFor(id) : null;
}

const timeFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

/** Godzina w Europe/Warsaw, np. „10:32” (AC-9). */
export function entryTime(timestamp: string): string {
  return timeFormat.format(new Date(timestamp));
}

/** Dzień `YYYY-MM-DD` przesunięty o `days`. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** AC-11: opis skutku wyboru uprawnienia dziś. */
export function passEffect(pass: EntryPass): { key: MessageKey; params: Record<string, string | number> } {
  const name = pass.item_name;
  switch (pass.kind) {
    case 'event_ticket':
      return { key: 'rangeEntry.effectTicket', params: { name } };
    case 'entries':
      return { key: 'rangeEntry.effectEntries', params: { name, left: Math.max(0, (pass.entries_left ?? 1) - 1) } };
    default:
      return { key: 'rangeEntry.effectSingle', params: { name } };
  }
}

/** Pola formularza „Uzupełnij dane” dla braków z bazy (AC-7). */
export function missingInputs(missing: readonly string[]): ProfileField[] {
  const fields: ProfileField[] = [];
  if (missing.includes('full_name')) fields.push('full_name');
  if (missing.includes('permit_or_address')) fields.push('permit_number', 'permit_authority', 'address');
  return fields;
}

/**
 * AC-7: walidacja uzupełnianych pól (SPEC-002 AC-8, AC-11) i komplet danych po zapisie.
 * `complete = false` → „Zapisz dane” pokazuje, czego brakuje; „Dalej” zostaje nieaktywny.
 */
export function validateCompletion(
  missing: readonly string[],
  input: Partial<Record<ProfileField, string>>,
): { errors: ProfileErrors; complete: boolean; values: Partial<Record<ProfileField, string | null>> } {
  const data = normalizeProfile(input);
  const fields = missingInputs(missing);
  const all = validateProfile(data);
  const errors: ProfileErrors = Object.fromEntries(fields.filter((f) => all[f]).map((f) => [f, all[f]]));
  if (fields.includes('full_name') && !data.full_name) errors.full_name = 'length';
  const hasPermit = Boolean(data.permit_number && data.permit_authority);
  const needsPermitOrAddress = fields.includes('address') && !hasPermit && !data.address;
  const values = Object.fromEntries(fields.map((f) => [f, data[f]]));
  return { errors, complete: Object.keys(errors).length === 0 && !needsPermitOrAddress, values };
}

const ERRORS: Record<string, MessageKey> = {
  person_not_found: 'rangeEntry.errorPerson',
  permit_pair: 'profile.errorPermitPair',
};

/** Błąd `staff_complete_profile` → komunikat. */
export function completeErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return ERRORS[error?.message ?? ''] ?? 'profile.saveError';
}
