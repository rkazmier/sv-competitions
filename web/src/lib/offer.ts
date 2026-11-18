/**
 * Oferta i zakup (SPEC-003 US-2, US-3: AC-5…AC-7, AC-10, AC-12…AC-15). Logika bez DOM:
 * teksty kart produktów, adres zakupu, stan strony powrotu z Tpay, karnety i historia płatności w `/konto/`.
 * Interfejs: lib/offer-ui.ts.
 */
import type { MessageKey } from '../i18n';
import { LOGIN_PAGE, withNext } from './auth';
import { todayInWarsaw } from './calendar';
import type { Product } from './products';
import type { PassUsage } from './range-history';

export const OFFER_PAGE = '/oferta/';
export const ORDER_PAGE = '/oferta/zamowienie/';
export const PAYMENT_STATUS_PAGE = '/konto/platnosc/';
export const SALES_TERMS_PAGE = '/regulamin-sprzedazy/';

/** Kolumny produktu na stronach publicznych (RLS: tylko aktywne). */
export const OFFER_COLUMNS = 'id, kind, name, description, price, entries, days, day_type, is_active, position';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identyfikator z parametru adresu (`?product=`, `?order=`) albo `null`. */
export function idParam(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Adres podsumowania zamówienia produktu. */
export const orderPath = (productId: string) => `${ORDER_PAGE}?product=${productId}`;

/** Adres podsumowania zamówienia wejściówki (AC-17). */
export const eventOrderPath = (eventId: string) => `${ORDER_PAGE}?event=${encodeURIComponent(eventId)}`;

/**
 * Stan sprzedaży wejściówki (AC-17…AC-19): po ostatnim dniu wydarzenia (Europe/Warsaw) — zamknięta;
 * przy limicie, gdy nie ma wolnych miejsc — wyprzedane. `seatsLeft = null` — bez limitu (albo nieznane).
 */
export type TicketSale = 'open' | 'soldOut' | 'closed';
export function ticketSale(lastDay: string, today: string, seatsLeft: number | null): TicketSale {
  if (today > lastDay) return 'closed';
  return seatsLeft !== null && seatsLeft <= 0 ? 'soldOut' : 'open';
}

/** „Kup” (AC-6, AC-7): zalogowany → podsumowanie; gość → logowanie z powrotem do podsumowania. */
export function buyHref(productId: string, signedIn: boolean): string {
  return signedIn ? orderPath(productId) : withNext(LOGIN_PAGE, orderPath(productId));
}

/** Informacje pod opisem produktu (AC-5) i w podsumowaniu (AC-7): ważność, aktywacja, dni tygodnia. */
export function productNotes(product: Pick<Product, 'kind' | 'day_type'>): MessageKey[] {
  const notes: MessageKey[] = ['offer.validity'];
  if (product.kind === 'days') notes.push('offer.daysNote');
  if (product.kind === 'single_entry') {
    notes.push(product.day_type === 'weekday' ? 'offer.weekdayNote' : 'offer.weekendNote');
  }
  return notes;
}

// ===== Powrót z Tpay (AC-10) =====

export const PAYMENT_POLL_INTERVAL_MS = 3000;
export const PAYMENT_POLL_LIMIT_MS = 60_000;

export type PaymentView = 'waiting' | 'paid' | 'slow';

/**
 * Co pokazać na `/konto/platnosc/` (AC-10): `paid` — przyjęta; `pending` przez maks. 60 s — czekamy,
 * potem (i dla innych stanów, np. anulowane — wpłata może jeszcze dojść, §5) — „Sprawdź „Moje konto””.
 */
export function paymentView(status: string, elapsedMs: number): PaymentView {
  if (status === 'paid') return 'paid';
  if (status === 'pending' && elapsedMs < PAYMENT_POLL_LIMIT_MS) return 'waiting';
  return 'slow';
}

// ===== Karnety (AC-12, AC-15) =====

export type PassKind = 'entries' | 'days' | 'single_entry' | 'event_ticket';

/** Wiersz `user_passes` z nazwą z zamówienia i zużyciami (RLS: własne). */
export interface UserPass {
  id: string;
  kind: PassKind;
  status: 'active' | 'used_up' | 'cancelled';
  entries_total: number | null;
  entries_left: number | null;
  first_used_on: string | null;
  valid_until: string | null;
  expires_on: string;
  created_at: string;
  orders: { item_name: string } | null;
  pass_usages: PassUsage[];
}

export const PASS_COLUMNS =
  'id, kind, status, entries_total, entries_left, first_used_on, valid_until, expires_on, created_at, ' +
  'orders(item_name), pass_usages(id, used_on, created_at, reverted_at)';

/** Data pierwszego użycia: aktywacja karnetu czasowego albo najwcześniejsze niecofnięte zużycie. */
export function firstUsedOn(pass: UserPass): string | null {
  if (pass.first_used_on) return pass.first_used_on;
  const days = pass.pass_usages.filter((usage) => !usage.reverted_at).map((usage) => usage.used_on).sort();
  return days[0] ?? null;
}

/** „Ważny do” (AC-12): czasowy aktywowany i wejściówka — `valid_until`; pozostałe — `expires_on`. */
export function passValidTo(pass: UserPass): string {
  return (pass.kind === 'days' && pass.first_used_on) || pass.kind === 'event_ticket'
    ? (pass.valid_until ?? pass.expires_on)
    : pass.expires_on;
}

/** Aktywne dnia `today` (AC-12) — w przeciwnym razie wykorzystane, wygasłe albo anulowane (AC-15). */
export function isPassActive(pass: UserPass, today: string): boolean {
  return pass.status === 'active' && today <= passValidTo(pass);
}

/** Podział na „Twoje karnety” i „Historia karnetów”, od najnowszych. */
export function splitPasses(
  passes: readonly UserPass[],
  today: string = todayInWarsaw(),
): { active: UserPass[]; history: UserPass[] } {
  const sorted = [...passes].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return {
    active: sorted.filter((pass) => isPassActive(pass, today)),
    history: sorted.filter((pass) => !isPassActive(pass, today)),
  };
}

/** Stan w „Historii karnetów” (AC-15). */
export function passHistoryState(pass: UserPass): MessageKey {
  if (pass.status === 'cancelled') return 'offer.passCancelled';
  if (pass.status === 'used_up') return 'offer.passUsedUp';
  return 'offer.passExpired';
}

// ===== Historia płatności (AC-13) =====

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refund_pending' | 'refunded';

export interface UserOrder {
  id: string;
  item_name: string;
  amount: number;
  payment_method: 'tpay' | 'on_site';
  status: OrderStatus;
  created_at: string;
}

export const ORDER_COLUMNS = 'id, item_name, amount, payment_method, status, created_at';

export const ORDER_STATUS_TEXT: Record<OrderStatus, MessageKey> = {
  paid: 'offer.statusPaid',
  pending: 'offer.statusPending',
  cancelled: 'offer.statusCancelled',
  refund_pending: 'offer.statusRefundPending',
  refunded: 'offer.statusRefunded',
};

export const PAYMENT_METHOD_TEXT: Record<UserOrder['payment_method'], MessageKey> = {
  tpay: 'offer.methodOnline',
  on_site: 'offer.methodOnSite',
};

/** Od najnowszych (AC-13). */
export function sortOrders(orders: readonly UserOrder[]): UserOrder[] {
  return [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
