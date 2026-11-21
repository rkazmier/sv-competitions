/**
 * Zamówienia w panelu admina (`/panel/zamowienia/`, SPEC-003 US-6: AC-24…AC-27). Logika bez DOM:
 * filtry → argumenty `admin_list_orders`, suma, eksport CSV, kiedy pokazać „Anuluj i zwróć”, komunikaty błędów.
 * Interfejs: lib/orders-admin-ui.ts.
 */
import type { MessageKey } from '../i18n';
import { ORDER_STATUS_TEXT, PAYMENT_METHOD_TEXT, type OrderStatus } from './offer';
import { normalizeOrderNumber } from './order-number';
import { priceInputValue } from './products';

export type PaymentMethod = 'tpay' | 'on_site';

/** Wiersz `admin_list_orders`. */
export interface AdminOrder {
  id: string;
  /** SPEC-006: numer zamówienia, np. `SV-2026-000123`. */
  order_number: string;
  created_at: string;
  item_name: string;
  amount: number;
  /** `gift` — przyznanie karnetu (SPEC-010); filtr „Prezent” — #145. */
  payment_method: PaymentMethod | 'gift';
  on_site_method: 'cash' | 'terminal' | null;
  status: OrderStatus;
  refund_note: string | null;
  user_id: string | null;
  person_name: string | null;
  person_email: string | null;
  seller_name: string | null;
  pass_used: boolean;
  invoice_requested: boolean;
}

export const ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'pending', 'cancelled', 'refund_pending', 'refunded'];
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['tpay', 'on_site'];

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

/** AC-25, AC-26: co pokazać przy zamówieniu — przycisk zwrotu, informację o używanym karnecie albo nic. */
export function refundAction(order: AdminOrder): 'refund' | 'used' | null {
  if (order.status !== 'paid') return null;
  return order.pass_used ? 'used' : 'refund';
}

/** SPEC-004 AC-14: opłacone bez faktury — „Dodaj dane do faktury”; z fakturą — informacja; pozostałe — nic. */
export function invoiceAction(order: AdminOrder): 'add' | 'requested' | null {
  if (order.invoice_requested) return 'requested';
  return order.status === 'paid' ? 'add' : null;
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

export function statusKey(status: OrderStatus): MessageKey {
  return ORDER_STATUS_TEXT[status];
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
    'orders.colPerson', 'orders.colSeller', 'orders.colNote',
  ];
  const rows = orders.map((order) => [
    order.order_number,
    orderDateTime(order.created_at),
    order.item_name,
    priceInputValue(order.amount),
    methodKeys(order).map(text).join(' / '),
    text(statusKey(order.status)),
    personLabel(order) ?? text('orders.noAccount'),
    order.seller_name ?? '',
    order.refund_note ?? '',
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

/** Błąd `payments-refund` / `cancel_order` → komunikat dla admina. */
export function refundErrorKey(code: string | null | undefined): MessageKey {
  return REFUND_ERRORS[code ?? ''] ?? 'orders.errorGeneric';
}
