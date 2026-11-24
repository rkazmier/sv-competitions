/**
 * Oferta i zakup (SPEC-003 US-2, US-3: AC-5…AC-7, AC-10, AC-12…AC-15). Logika bez DOM:
 * teksty kart produktów, adres zakupu, stan strony powrotu z Tpay, karnety i historia płatności w `/konto/`.
 * Interfejs: lib/offer-ui.ts.
 */
import { t, type MessageKey } from '../i18n';
import { LOGIN_PAGE, withNext } from './auth';
import { todayInWarsaw } from './calendar';
import { formatPrice, type Product } from './products';
import type { PassUsage } from './range-history';
import { salesTermsPdfPath, shortDay } from './sales-terms';

export const OFFER_PAGE = '/oferta/';
export const ORDER_PAGE = '/oferta/zamowienie/';
export const PAYMENT_STATUS_PAGE = '/konto/platnosc/';
export const SALES_TERMS_PAGE = '/regulamin-sprzedazy/';

/** Kolumny produktu na stronach publicznych (RLS: tylko aktywne). */
export const OFFER_COLUMNS = 'id, kind, name, description, price, entries, day_type, is_active, position';

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

/** Informacje pod opisem produktu (AC-5) i w podsumowaniu (AC-7): ważność, dni tygodnia. */
export function productNotes(product: Pick<Product, 'kind' | 'day_type'>): MessageKey[] {
  const notes: MessageKey[] = ['offer.validity'];
  if (product.kind === 'single_entry') {
    notes.push(product.day_type === 'weekday' ? 'offer.weekdayNote' : 'offer.weekendNote');
  }
  return notes;
}

// ===== Regulamin i zgoda (SPEC-012 AC-1…AC-8) =====

const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `timestamptz` → „2.01.2027 14:05” (Europe/Warsaw). */
export function shortDateTime(value: string): string {
  const part = Object.fromEntries(warsawParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${Number(part.day)}.${part.month}.${part.year} ${part.hour}:${part.minute}`;
}

/** AC-1: dopisek po „regulamin sprzedaży” — „ (obowiązuje od 1.01.2027)”; bez obowiązującej wersji — nic (§7). */
export function termsVersionSuffix(version: string | null): string {
  return version ? ` ${t('offer.termsVersion', { date: shortDay(version) })}` : '';
}

/** AC-6: zgoda na korzystanie przed upływem 14 dni — przy produkcie (karnet, wejście jednorazowe), nie przy wejściówce. */
export const needsConsent = (item: { kind: 'product' | 'ticket' }) => item.kind === 'product';

/** AC-2: „Zamawiam i płacę” aktywny po zaznaczeniu wymaganych checkboxów. */
export function canOrder(checks: { terms: boolean; consent: boolean | null }): boolean {
  return checks.terms && checks.consent !== false;
}

/** Wersja regulaminu i zgoda zapisane w zamówieniu. */
export interface OrderTerms {
  terms_version: string | null;
  early_performance_consent_at: string | null;
}

/** AC-5: „Regulamin z 1.01.2027” (link do PDF wersji) i „Zgoda na korzystanie przed upływem 14 dni: 2.01.2027 14:05”. */
export function orderTermsLines(order: OrderTerms): { terms: { text: string; href: string } | null; consent: string | null } {
  const version = order.terms_version;
  return {
    terms: version ? { text: t('offer.orderTerms', { date: shortDay(version) }), href: salesTermsPdfPath(version) } : null,
    consent: order.early_performance_consent_at
      ? t('offer.orderConsent', { date: shortDateTime(order.early_performance_consent_at) })
      : null,
  };
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

export type PassKind = 'entries' | 'single_entry' | 'event_ticket';

/** Wiersz `user_passes` z nazwą z zamówienia i zużyciami (RLS: własne). */
export interface UserPass {
  id: string;
  kind: PassKind;
  status: 'active' | 'used_up' | 'cancelled';
  entries_total: number | null;
  entries_left: number | null;
  valid_until: string | null;
  expires_on: string;
  created_at: string;
  orders: { item_name: string } | null;
  pass_usages: PassUsage[];
}

export const PASS_COLUMNS =
  'id, kind, status, entries_total, entries_left, valid_until, expires_on, created_at, ' +
  'orders(item_name), pass_usages(id, used_on, created_at, reverted_at)';

/** Data pierwszego użycia: najwcześniejsze niecofnięte zużycie. */
export function firstUsedOn(pass: UserPass): string | null {
  const days = pass.pass_usages.filter((usage) => !usage.reverted_at).map((usage) => usage.used_on).sort();
  return days[0] ?? null;
}

/** „Ważny do” (AC-12): wejściówka — `valid_until`; pozostałe — `expires_on`. */
export function passValidTo(pass: UserPass): string {
  return pass.kind === 'event_ticket' ? (pass.valid_until ?? pass.expires_on) : pass.expires_on;
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

export interface UserOrder extends OrderTerms {
  id: string;
  /** SPEC-006 AC-12. */
  order_number: string;
  item_name: string;
  amount: number;
  /** `gift` — przyznanie przez admina (SPEC-010). */
  payment_method: 'tpay' | 'on_site' | 'gift';
  status: OrderStatus;
  created_at: string;
  /** SPEC-004 AC-7: status faktury (`invoice.ts`, `invoiceStatus`). */
  invoice_requested: boolean;
  invoice_number: string | null;
  /** SPEC-012 AC-20: kwota zwrotu (grosze); `null` — brak zwrotu albo starszy zwrot pełny. */
  refund_amount: number | null;
}

export const ORDER_COLUMNS =
  'id, order_number, item_name, amount, payment_method, status, created_at, invoice_requested, invoice_number, terms_version, early_performance_consent_at, refund_amount';

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
  gift: 'offer.methodGift',
};

/** Status zamówienia po polsku; SPEC-010 AC-13: anulowany prezent — „Anulowane” (nie „Nieopłacone — anulowane”). */
export function orderStatusKey(order: Pick<UserOrder, 'payment_method' | 'status'>): MessageKey {
  return order.payment_method === 'gift' && order.status === 'cancelled' ? 'offer.statusGiftCancelled' : ORDER_STATUS_TEXT[order.status];
}

type RefundFields = Pick<UserOrder, 'payment_method' | 'status' | 'amount' | 'refund_amount'>;

/** SPEC-012 AC-20: zwrot częściowy (`refund_amount` < `amount`) w toku albo wykonany. */
export function isPartialRefund(order: RefundFields): boolean {
  return (order.status === 'refunded' || order.status === 'refund_pending')
    && order.refund_amount !== null && order.refund_amount < order.amount;
}

/** SPEC-012 AC-20: „Zwrócone 66,67 zł z 100,00 zł” / „Zwrot w toku: 66,67 zł”; pozostałe — jak `orderStatusKey`. */
export function orderStatusText(order: RefundFields): string {
  if (!isPartialRefund(order)) return t(orderStatusKey(order));
  const refund = formatPrice(order.refund_amount!);
  return order.status === 'refunded'
    ? t('offer.statusRefundedPartial', { refund, amount: formatPrice(order.amount) })
    : t('offer.statusRefundPendingPartial', { refund });
}

/** Od najnowszych (AC-13). */
export function sortOrders(orders: readonly UserOrder[]): UserOrder[] {
  return [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
