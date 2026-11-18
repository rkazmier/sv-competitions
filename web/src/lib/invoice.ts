/**
 * Faktura przy zakupie, w profilu i przy sprzedaży na miejscu (SPEC-004 AC-1…AC-9) — logika bez DOM.
 * NIP: taka sama normalizacja i suma kontrolna jak `normalize_nip` / `is_valid_nip` w bazie i w `company-lookup`.
 * Interfejs: lib/invoice-ui.ts, components/InvoiceFields.astro.
 */
import type { MessageKey } from '../i18n';

export type InvoiceSource = 'vat_whitelist' | 'regon' | 'manual';

/** Dane do faktury — kształt `billing_details` i kopii w zamówieniu (§5). */
export interface InvoiceDetails {
  nip: string;
  company_name: string;
  company_address: string;
  data_source: InvoiceSource;
  fetched_at: string | null;
}

export const BILLING_COLUMNS = 'nip, company_name, company_address, data_source, fetched_at';

/** Limity jak `check` w bazie (AC-4). */
export const NAME_LIMITS = { min: 2, max: 250 } as const;
export const ADDRESS_LIMITS = { min: 5, max: 300 } as const;

/** §7: usuwa spacje i myślniki, odcina prefiks `PL` (bez rozróżniania wielkości liter). Inny prefiks zostaje. */
export function normalizeNip(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  return s.startsWith('PL') ? s.slice(2) : s;
}

/** 10 cyfr, wagi 6,5,7,2,3,4,5,6,7; suma mod 11 = ostatnia cyfra (reszta 10 — NIP nieprawidłowy). */
export function isValidNip(nip: string): boolean {
  if (!/^[0-9]{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}

/** Wynik sprawdzenia NIP przed odpytaniem rejestru (AC-2, §7). */
export type NipCheck = { ok: true; nip: string } | { ok: false; error: MessageKey };

export function checkNip(input: string): NipCheck {
  const nip = normalizeNip(input);
  // §7: NIP z prefiksem innego kraju (np. `DE…`) — poza zakresem.
  if (/^[A-Z]{2}[0-9A-Z]+$/.test(nip) && /[0-9]/.test(nip)) return { ok: false, error: 'invoice.foreignNip' };
  return isValidNip(nip) ? { ok: true, nip } : { ok: false, error: 'invoice.invalidNip' };
}

/** Długość w znakach (jak `length()` w PostgreSQL) po `trim`. */
function lengthOk(value: string, { min, max }: { min: number; max: number }): boolean {
  const length = [...value.trim()].length;
  return length >= min && length <= max;
}

/** AC-4: dane wpisane ręcznie — `true` przy polu, które spełnia limit długości. */
export function validateManual(name: string, address: string): { name: boolean; address: boolean } {
  return { name: lengthOk(name, NAME_LIMITS), address: lengthOk(address, ADDRESS_LIMITS) };
}

/** Odpowiedź `company-lookup` (§8). */
export interface LookupResult {
  found: boolean;
  name: string | null;
  address: string | null;
  source: 'vat_whitelist' | 'regon' | null;
}

/**
 * Co pokazać po „Pobierz dane firmy”: dane z rejestru przyjęte od razu (AC-3), wpis ręczny (AC-4 — brak w rejestrach,
 * brak odpowiedzi, limit zapytań) albo komunikat błędu NIP (`invalid_nip`, `foreign_nip`).
 */
export type LookupView =
  | { kind: 'found'; details: InvoiceDetails }
  | { kind: 'manual' }
  | { kind: 'error'; message: MessageKey };

export function lookupView(nip: string, result: LookupResult | null, errorCode: string | null, now: Date): LookupView {
  if (errorCode === 'invalid_nip') return { kind: 'error', message: 'invoice.invalidNip' };
  if (errorCode === 'foreign_nip') return { kind: 'error', message: 'invoice.foreignNip' };
  const name = result?.name?.trim() ?? '';
  const address = result?.address?.trim() ?? '';
  const valid = validateManual(name, address);
  if (!result?.found || !result.source || !valid.name || !valid.address) {
    return { kind: 'manual' };
  }
  return {
    kind: 'found',
    details: { nip, company_name: name, company_address: address, data_source: result.source, fetched_at: now.toISOString() },
  };
}

/** Argumenty `set_order_invoice_details` (§5). */
export function invoiceArgs(orderId: string, details: InvoiceDetails, saveBillingDetails: boolean): Record<string, unknown> {
  return {
    p_order_id: orderId,
    p_nip: details.nip,
    p_company_name: details.company_name,
    p_company_address: details.company_address,
    p_data_source: details.data_source,
    p_fetched_at: details.fetched_at,
    p_save_billing_details: saveBillingDetails,
  };
}

export const SOURCE_TEXT: Record<InvoiceSource, MessageKey> = {
  vat_whitelist: 'invoice.sourceWhitelist',
  regon: 'invoice.sourceRegon',
  manual: 'invoice.sourceManual',
};

/** AC-7: status faktury w „Historii płatności”; `null` — zamówienie bez faktury. */
export function invoiceStatus(order: { invoice_requested?: boolean; invoice_number?: string | null }):
  | { key: 'invoice.statusPending' }
  | { key: 'invoice.statusIssued'; number: string }
  | null {
  if (!order.invoice_requested) return null;
  return order.invoice_number ? { key: 'invoice.statusIssued', number: order.invoice_number } : { key: 'invoice.statusPending' };
}
