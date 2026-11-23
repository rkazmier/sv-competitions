/**
 * Zamówienia w panelu admina (`/panel/zamowienia/`, SPEC-003 US-6: AC-24…AC-27). Logika bez DOM:
 * filtry → argumenty `admin_list_orders`, suma, eksport CSV, kiedy pokazać „Anuluj i zwróć”, komunikaty błędów.
 * Prezent (SPEC-010 AC-14, AC-17…AC-21): filtr „Prezent”, powód i notatka anulowania, „Anuluj przyznanie” zamiast zwrotu i faktury.
 * Interfejs: lib/orders-admin-ui.ts.
 */
import { t, type MessageKey } from '../i18n';
import { orderStatusKey, PAYMENT_METHOD_TEXT, shortDateTime, type OrderStatus } from './offer';
import { normalizeOrderNumber } from './order-number';
import { priceInputValue } from './products';

export type PaymentMethod = 'tpay' | 'on_site';
/** Metoda zamówienia w panelu: płatność albo `gift` — przyznanie karnetu (SPEC-010). */
export type OrderMethod = PaymentMethod | 'gift';

/** Wiersz `admin_list_orders`. */
export interface AdminOrder {
  id: string;
  /** SPEC-006: numer zamówienia, np. `SV-2026-000123`. */
  order_number: string;
  created_at: string;
  item_name: string;
  amount: number;
  payment_method: OrderMethod;
  on_site_method: 'cash' | 'terminal' | null;
  status: OrderStatus;
  refund_note: string | null;
  user_id: string | null;
  person_name: string | null;
  person_email: string | null;
  seller_name: string | null;
  pass_used: boolean;
  invoice_requested: boolean;
  /** SPEC-010: powód przyznania i notatka anulowania (`order_grants`); `null` dla innych metod. */
  grant_reason: string | null;
  grant_cancel_note: string | null;
  /** SPEC-012 AC-5: wersja regulaminu i zgoda na korzystanie przed upływem 14 dni (zamówienia Tpay). */
  terms_version: string | null;
  early_performance_consent_at: string | null;
  /** SPEC-012 AC-14: stan e-maila `order_paid` (`email_outbox`); `null` — zamówienie bez e-maila. */
  email_status: EmailStatus | null;
  email_sent_at: string | null;
}

export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped';

const EMAIL_STATUS_TEXT: Record<EmailStatus, MessageKey> = {
  sent: 'orders.emailSent',
  pending: 'orders.emailPending',
  failed: 'orders.emailFailed',
  skipped: 'orders.emailSkipped',
};

/** SPEC-012 AC-11, AC-14: „E-mail z potwierdzeniem: wysłano 2.01.2027 14:06” / „w kolejce” / „nie wysłano”; bez e-maila — `null`. */
export function emailStatusText(order: Pick<AdminOrder, 'email_status' | 'email_sent_at'>): string | null {
  if (!order.email_status) return null;
  const date = order.email_sent_at ? shortDateTime(order.email_sent_at) : '';
  return t(EMAIL_STATUS_TEXT[order.email_status], { date });
}

/** SPEC-012 AC-11: „Wyślij ponownie” po 5 nieudanych próbach (`failed`). */
export function canResendEmail(order: Pick<AdminOrder, 'email_status'>): boolean {
  return order.email_status === 'failed';
}

export const ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'pending', 'cancelled', 'refund_pending', 'refunded'];
/** SPEC-010 AC-14: filtr „Metoda” — „Online”, „Na miejscu”, „Prezent”. */
export const PAYMENT_METHODS: readonly OrderMethod[] = ['tpay', 'on_site', 'gift'];

/** Wartości pól filtra (puste = bez filtra). `item` jak w sprzedaży: `product:<id>` albo `event:<id>`. */
export interface OrderFilters {
  from: string;
  to: string;
  status: string;
  method: string;
  item: string;
  person: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM = /^(product|event):([0-9a-f-]{36})$/i;

/** Domyślny widok: od pierwszego dnia bieżącego miesiąca do dziś. */
export function defaultFilters(today: string): OrderFilters {
  return { from: `${today.slice(0, 8)}01`, to: today, status: '', method: '', item: '', person: '' };
}

/** AC-24: filtry → argumenty `admin_list_orders` (niepoprawne wartości pomijane). */
export function filterArgs(filters: OrderFilters): Record<string, string | null> {
  const item = ITEM.exec(filters.item);
  return {
    p_from: DATE.test(filters.from) ? filters.from : null,
    p_to: DATE.test(filters.to) ? filters.to : null,
    p_status: (ORDER_STATUSES as readonly string[]).includes(filters.status) ? filters.status : null,
    p_method: (PAYMENT_METHODS as readonly string[]).includes(filters.method) ? filters.method : null,
    p_product_id: item?.[1] === 'product' ? item[2] : null,
    p_event_id: item?.[1] === 'event' ? item[2] : null,
    p_person: filters.person.trim() || null,
  };
}

/**
 * SPEC-006 AC-10, AC-11: pole „Osoba lub nr zamówienia” w formie numeru — baza pomija pozostałe filtry;
 * komunikat o wyniku. Tekst bez formy numeru (wyszukiwanie po osobie) — bez komunikatu.
 */
export function numberSearchKey(person: string, count: number): MessageKey | null {
  if (!normalizeOrderNumber(person)) return null;
  return count > 0 ? 'orders.numberResult' : 'orders.numberNotFound';
}

/** AC-24: suma kwot bieżącego widoku (grosze). */
export function ordersTotal(orders: readonly AdminOrder[]): number {
  return orders.reduce((sum, order) => sum + order.amount, 0);
}

export const isGift = (order: Pick<AdminOrder, 'payment_method'>) => order.payment_method === 'gift';

/**
 * AC-25, AC-26: co pokazać przy zamówieniu — przycisk zwrotu, informację o używanym karnecie albo nic.
 * SPEC-010 AC-17: prezent nie ma „Anuluj i zwróć” (zamiast tego `canCancelGrant`).
 */
export function refundAction(order: AdminOrder): 'refund' | 'used' | null {
  if (order.status !== 'paid' || isGift(order)) return null;
  return order.pass_used ? 'used' : 'refund';
}

/** SPEC-010 AC-18, AC-21: „Anuluj przyznanie” przy prezencie w stanie `paid` — także przy używanym karnecie. */
export function canCancelGrant(order: AdminOrder): boolean {
  return isGift(order) && order.status === 'paid';
}

/** SPEC-004 AC-14: opłacone bez faktury — „Dodaj dane do faktury”; z fakturą — informacja; pozostałe — nic. SPEC-010 AC-17: prezent — nic. */
export function invoiceAction(order: AdminOrder): 'add' | 'requested' | null {
  if (isGift(order)) return null;
  if (order.invoice_requested) return 'requested';
  return order.status === 'paid' ? 'add' : null;
}

/** SPEC-010 AC-14: szczegóły prezentu w kolumnie „Uwagi” — „Powód: …” i „Notatka anulowania: …” (jeśli jest). */
export function grantDetails(order: AdminOrder): string[] {
  if (!isGift(order)) return [];
  const lines: string[] = [];
  if (order.grant_reason) lines.push(t('orders.grantReason', { reason: order.grant_reason }));
  if (order.grant_cancel_note) lines.push(t('orders.grantCancelNote', { note: order.grant_cancel_note }));
  return lines;
}

/** Osoba w liście i CSV: imię i nazwisko, inaczej e-mail; bez konta — `null`. */
export function personLabel(order: AdminOrder): string | null {
  return order.person_name || order.person_email || null;
}

const dateTimeFormat = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Data i godzina zamówienia w Europe/Warsaw, np. „18.11.2026, 09:05”. */
export function orderDateTime(createdAt: string): string {
  return dateTimeFormat.format(new Date(createdAt));
}

/** Metoda płatności z rodzajem płatności na miejscu, np. „Na miejscu (gotówka)”. */
export function methodKeys(order: AdminOrder): MessageKey[] {
  const keys: MessageKey[] = [PAYMENT_METHOD_TEXT[order.payment_method]];
  if (order.on_site_method) keys.push(order.on_site_method === 'cash' ? 'orders.cash' : 'orders.terminal');
  return keys;
}

/** Status po polsku; anulowany prezent — „Anulowane” (SPEC-010, jak w `/konto/`). */
export function statusKey(order: Pick<AdminOrder, 'payment_method' | 'status'>): MessageKey {
  return orderStatusKey(order);
}

/** Komórka CSV: cudzysłowy, a tekst zaczynający się od `= + - @` poprzedzony apostrofem (formuły w arkuszu). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * AC-24, SPEC-006 AC-9: CSV bieżącego widoku (pierwsza kolumna — numer zamówienia) — średnik jako separator i BOM (polski Excel), kwota „120,00”.
 * `text` tłumaczy klucze komunikatów (nagłówki, status, metoda).
 */
export function ordersCsv(orders: readonly AdminOrder[], text: (key: MessageKey) => string): string {
  const header: MessageKey[] = [
    'orders.csvNumber', 'orders.colDate', 'orders.colItem', 'orders.colAmount', 'orders.colMethod', 'orders.colStatus',
    'orders.colPerson', 'orders.colSeller', 'orders.colNote', 'orders.csvGrantReason',
  ];
  const rows = orders.map((order) => [
    order.order_number,
    orderDateTime(order.created_at),
    order.item_name,
    priceInputValue(order.amount),
    methodKeys(order).map(text).join(' / '),
    text(statusKey(order)),
    personLabel(order) ?? text('orders.noAccount'),
    order.seller_name ?? '',
    // SPEC-010 AC-14: notatka anulowania prezentu w „Uwagi”, powód w osobnej kolumnie (pusta dla innych metod).
    order.refund_note ?? order.grant_cancel_note ?? '',
    order.grant_reason ?? '',
  ]);
  return '﻿' + [header.map(text), ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Nazwa pliku eksportu, np. `zamowienia-2026-11-01-2026-11-18.csv`. */
export function csvFileName(filters: OrderFilters): string {
  const range = [filters.from, filters.to].filter((date) => DATE.test(date)).join('-');
  return `zamowienia${range ? `-${range}` : ''}.csv`;
}

const REFUND_ERRORS: Record<string, MessageKey> = {
  pass_used: 'orders.passUsed',
  order_not_paid: 'orders.errorNotPaid',
  order_not_found: 'orders.errorNotPaid',
  refund_failed: 'orders.errorTpay',
};

const GRANT_CANCEL_ERRORS: Record<string, MessageKey> = {
  order_not_paid: 'orders.grantAlreadyCancelled',
  order_not_found: 'orders.grantAlreadyCancelled',
  invalid_note: 'orders.grantNoteTooLong',
};

/** SPEC-010 AC-21: błąd `cancel_pass_grant` → komunikat dla admina. */
export function grantCancelErrorKey(code: string | null | undefined): MessageKey {
  return GRANT_CANCEL_ERRORS[code ?? ''] ?? 'orders.grantCancelError';
}

/** Błąd `payments-refund` / `cancel_order` → komunikat dla admina. */
export function refundErrorKey(code: string | null | undefined): MessageKey {
  return REFUND_ERRORS[code ?? ''] ?? 'orders.errorGeneric';
}
