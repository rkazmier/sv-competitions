/**
 * Przyznanie karnetu przez admina (`/panel/zamowienia/przyznaj/`, SPEC-010 US-1: AC-1…AC-11). Logika bez DOM:
 * co można przyznać (wszystkie produkty + wejściówki na trwające płatne wydarzenia), „Ważny do” (domyślna data i zakres),
 * walidacja formularza, komunikaty błędów `grant_pass`, adresy przycisków. Interfejs: lib/pass-grant-ui.ts.
 */
import type { MessageKey } from '../i18n';
import { normalizeOrderNumber } from './order-number';
import { PRODUCT_KINDS, type Product, type ProductKind } from './products';
import { personIdFromSearch } from './range-entry';

export const GRANT_URL = '/panel/zamowienia/przyznaj/';
export const GRANT_REASON_MIN = 3;
export const GRANT_REASON_MAX = 300;
/** AC-4: „Ważny do” najpóźniej dziś + 5 lat (jak `grant_pass`). */
export const GRANT_EXPIRES_MAX_YEARS = 5;

/** Płatne wydarzenie do przyznania wejściówki (`calendar_events`) + wolne miejsca (`event_seats_left`, `null` = bez limitu). */
export interface GrantEvent {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  ticket_price: number;
  capacity: number | null;
  seats_left: number | null;
}

export const GRANT_EVENT_COLUMNS = 'id, name, starts_on, ends_on, ticket_price, capacity';

export type GrantProduct = Pick<Product, 'id' | 'kind' | 'name' | 'price' | 'is_active'>;

/** Pozycja listy „Co przyznać”: `product:<id>` albo `event:<id>` (jak w sprzedaży na miejscu). */
export interface GrantItem {
  value: string;
  name: string;
  price: number;
  kind: ProductKind | 'ticket';
  /** Produkt ukryty w Ofercie (`is_active = false`) — AC-3. */
  hidden: boolean;
  /** Wejściówka: data (pierwszy i ostatni dzień) i wolne miejsca (`null` = bez limitu). */
  event?: { starts_on: string; ends_on: string | null; seats_left: number | null };
  /** Wyprzedane — pozycja nieaktywna (AC-3). */
  disabled: boolean;
}

export type GrantGroup = { kind: ProductKind | 'ticket'; items: GrantItem[] };

/**
 * AC-3: grupy „Karnety ilościowe”, „Wejścia jednorazowe” (wszystkie produkty, także ukryte)
 * i „Wejściówki” — wydarzenia, których ostatni dzień jeszcze nie minął. Puste grupy pomijane.
 * Wydarzenia muszą być już przefiltrowane do opublikowanych płatnych (zapytanie); ostateczna kontrola — `grant_pass`.
 */
export function grantGroups(
  products: readonly GrantProduct[],
  events: readonly GrantEvent[],
  today: string,
  ticketName: (name: string) => string,
): GrantGroup[] {
  const groups: GrantGroup[] = PRODUCT_KINDS.map((kind) => ({
    kind,
    items: products
      .filter((p) => p.kind === kind)
      .map((p) => ({ value: `product:${p.id}`, name: p.name, price: p.price, kind, hidden: !p.is_active, disabled: false })),
  }));
  groups.push({
    kind: 'ticket',
    items: events
      .filter((e) => (e.ends_on ?? e.starts_on) >= today)
      .map((e) => ({
        value: `event:${e.id}`,
        name: ticketName(e.name),
        price: e.ticket_price,
        kind: 'ticket' as const,
        hidden: false,
        event: { starts_on: e.starts_on, ends_on: e.ends_on, seats_left: e.capacity === null ? null : e.seats_left },
        disabled: e.capacity !== null && e.seats_left !== null && e.seats_left <= 0,
      })),
  });
  return groups.filter((group) => group.items.length > 0);
}

/** Data `YYYY-MM-DD` + pełne lata; 29.02 → 28.02, gdy roku docelowego nie jest przestępny (jak `date + interval` w PostgreSQL). */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const year = y + years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** AC-4: domyślne „Ważny do” = dziś + 1 rok (`pass_expires_on(dziś)`), zakres dziś…dziś + 5 lat. */
export function expiresRange(today: string): { min: string; max: string; default: string } {
  return { min: today, max: addYears(today, GRANT_EXPIRES_MAX_YEARS), default: addYears(today, 1) };
}

export interface GrantForm {
  personId: string | null;
  item: string;
  expiresOn: string;
  reason: string;
}

export type GrantField = 'person' | 'item' | 'expiresOn' | 'reason';
export type GrantErrors = Partial<Record<GrantField, MessageKey>>;

export interface GrantArgs {
  p_user_id: string;
  p_product_id: string | null;
  p_event_id: string | null;
  p_reason: string;
  p_expires_on: string | null;
}

const ITEM = /^(product|event):([0-9a-f-]{36})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Długość powodu po obcięciu spacji (licznik i walidacja — AC-6). */
export function reasonLength(reason: string): number {
  return reason.trim().length;
}

/** AC-2…AC-6: walidacja formularza → argumenty `grant_pass` (bez `p_request_key`) albo błędy pól. */
export function validateGrant(
  form: GrantForm,
  today: string,
): { ok: true; args: GrantArgs } | { ok: false; errors: GrantErrors } {
  const errors: GrantErrors = {};
  const item = ITEM.exec(form.item);
  const isProduct = item?.[1] === 'product';
  const range = expiresRange(today);
  if (!form.personId) errors.person = 'grant.personRequired';
  if (!item) errors.item = 'grant.itemRequired';
  if (isProduct && (!DATE.test(form.expiresOn) || form.expiresOn < range.min || form.expiresOn > range.max)) {
    errors.expiresOn = 'grant.errorExpiresOn';
  }
  const length = reasonLength(form.reason);
  if (length < GRANT_REASON_MIN || length > GRANT_REASON_MAX) errors.reason = 'grant.errorReason';
  if (Object.keys(errors).length > 0 || !item || !form.personId) return { ok: false, errors };
  return {
    ok: true,
    args: {
      p_user_id: form.personId,
      p_product_id: isProduct ? item[2]! : null,
      p_event_id: isProduct ? null : item[2]!,
      p_reason: form.reason.trim(),
      p_expires_on: isProduct ? form.expiresOn : null,
    },
  };
}

const ERRORS: Record<string, MessageKey> = {
  user_not_found: 'grant.errorPerson',
  product_not_found: 'grant.errorProduct',
  event_unavailable: 'grant.errorEvent',
  sales_closed: 'grant.errorEvent',
  sold_out: 'grant.errorSoldOut',
  event_cancelled: 'eventCancel.eventCancelled',
  invalid_grant_reason: 'grant.errorReason',
  invalid_expires_on: 'grant.errorExpiresOn',
};

/** Błąd `grant_pass` → komunikat (§6). */
export function grantErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return ERRORS[error?.message ?? ''] ?? 'grant.errorGeneric';
}

/** Wynik `grant_pass`. */
export interface GrantResult {
  order_id: string;
  order_number: string;
  duplicate: boolean;
}

/** AC-1: przycisk w profilu osoby → formularz z wybraną osobą. */
export function grantUrlFor(personId: string): string {
  return `${GRANT_URL}?${new URLSearchParams({ osoba: personId })}`;
}

/** AC-1: `?osoba=<uuid>` w adresie formularza. */
export function grantPersonFromSearch(search: string): string | null {
  return personIdFromSearch(search);
}

/** AC-8: „Pokaż zamówienie” — lista zamówień z wyszukaniem po numerze (SPEC-006 AC-10). */
export function orderSearchUrl(orderNumber: string): string {
  return `/panel/zamowienia/?${new URLSearchParams({ numer: orderNumber })}`;
}

/** `/panel/zamowienia/?numer=SV-…` → numer do pola „Osoba lub nr zamówienia”; inny tekst → `null`. */
export function orderNumberFromSearch(search: string): string | null {
  return normalizeOrderNumber(new URLSearchParams(search).get('numer') ?? '');
}
