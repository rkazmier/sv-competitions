/**
 * Panel faktur (`/panel/faktury/`, SPEC-004 US-3: AC-10…AC-16) — logika bez DOM: pola do skopiowania do e-mikrofirmy,
 * walidacja numerów, eksport CSV, ostrzeżenie o zwrocie, komunikaty błędów. Interfejs: lib/invoices-admin-ui.ts.
 */
import type { MessageKey } from '../i18n';
import type { InvoiceSource } from './invoice';
import { csvCell, type PaymentMethod } from './orders-admin';
import { priceInputValue } from './products';

export type InvoiceTab = 'todo' | 'issued';

/** Wiersz `admin_list_invoices`. */
export interface AdminInvoice {
  id: string;
  /** SPEC-006 AC-7: numer zamówienia, np. `SV-2026-000123`. */
  order_number: string;
  paid_at: string;
  item_name: string;
  amount: number;
  payment_method: PaymentMethod;
  on_site_method: 'cash' | 'terminal' | null;
  status: string;
  invoice_nip: string;
  invoice_company_name: string;
  invoice_company_address: string;
  invoice_data_source: InvoiceSource;
  invoice_number: string | null;
  ksef_number: string | null;
  invoice_issued_at: string | null;
  issued_by_name: string | null;
}

const warsawDate = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** AC-11: data sprzedaży = data zapłaty w Europe/Warsaw, np. „11.11.2026”. */
export function saleDate(paidAt: string): string {
  return warsawDate.format(new Date(paidAt));
}

/** AC-11: sposób zapłaty w brzmieniu do faktury. */
export function paymentKey(invoice: Pick<AdminInvoice, 'payment_method' | 'on_site_method'>): MessageKey {
  if (invoice.payment_method === 'tpay') return 'invoices.payTpay';
  return invoice.on_site_method === 'terminal' ? 'invoices.payTerminal' : 'invoices.payCash';
}

/** AC-11: etykiety pól do skopiowania do e-mikrofirmy (kolejność jak `invoiceValues`). */
export const FIELD_KEYS: readonly MessageKey[] = [
  'invoices.fieldNip', 'invoices.fieldBuyer', 'invoices.fieldAddress', 'invoices.fieldItem',
  'invoices.fieldAmount', 'invoices.fieldSaleDate', 'invoices.fieldPayment', 'invoices.fieldOrder',
];

/** AC-11: wartości do skopiowania, w kolejności `FIELD_KEYS` (numer zamówienia — `order_number`, SPEC-006 AC-7, AC-8). */
export function invoiceValues(invoice: AdminInvoice, text: (key: MessageKey) => string): string[] {
  return [
    invoice.invoice_nip,
    invoice.invoice_company_name,
    invoice.invoice_company_address,
    invoice.item_name,
    priceInputValue(invoice.amount),
    saleDate(invoice.paid_at),
    text(paymentKey(invoice)),
    invoice.order_number,
  ];
}

/** AC-16: zamówienie zwrócone (lub w trakcie zwrotu) — ostrzeżenie o korekcie w e-mikrofirmie. */
export function isRefunded(invoice: Pick<AdminInvoice, 'status'>): boolean {
  return invoice.status === 'refunded' || invoice.status === 'refund_pending';
}

/** AC-12: wzorzec numeru KSeF jak `is_valid_ksef_number` w bazie. */
const KSEF = /^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$/;

export type MarkCheck =
  | { ok: true; invoiceNumber: string; ksefNumber: string | null }
  | { ok: false; field: 'number' | 'ksef'; error: MessageKey };

/** AC-12: „Numer faktury”* 1–50 znaków, „Numer KSeF” opcjonalny (wzorzec, do 50 znaków). */
export function checkMark(invoiceNumber: string, ksefNumber: string): MarkCheck {
  const number = invoiceNumber.trim();
  if (number.length < 1 || [...number].length > 50) return { ok: false, field: 'number', error: 'invoices.numberError' };
  const ksef = ksefNumber.trim().toUpperCase();
  if (ksef && (ksef.length > 50 || !KSEF.test(ksef))) return { ok: false, field: 'ksef', error: 'invoices.ksefError' };
  return { ok: true, invoiceNumber: number, ksefNumber: ksef || null };
}

const ERRORS: Record<string, MessageKey> = {
  invoice_already_issued: 'invoices.errorChanged',
  invoice_not_issued: 'invoices.errorChanged',
  invoice_not_requested: 'invoices.errorChanged',
  order_not_paid: 'invoices.errorNotPaid',
  order_refunded: 'invoices.errorNotPaid',
  invalid_invoice_number: 'invoices.numberError',
  invalid_ksef_number: 'invoices.ksefError',
  invalid_nip: 'invoice.invalidDetails',
  invalid_company_name: 'invoice.invalidDetails',
  invalid_company_address: 'invoice.invalidDetails',
};

/** Błąd `mark_invoice_issued` / `unmark_invoice` / `set_order_invoice_details` → komunikat. */
export function invoiceErrorKey(message: string | null | undefined): MessageKey {
  return ERRORS[message ?? ''] ?? 'invoices.errorGeneric';
}

/** AC-15: CSV — kolumny z AC-11 + numer faktury i numer KSeF; UTF-8 z BOM, separator `;` (polski Excel). */
export function invoicesCsv(invoices: readonly AdminInvoice[], text: (key: MessageKey) => string): string {
  const keys: MessageKey[] = [...FIELD_KEYS, 'invoices.invoiceNumber', 'invoices.ksefNumber'];
  const rows = invoices.map((invoice) => [
    ...invoiceValues(invoice, text),
    invoice.invoice_number ?? '',
    invoice.ksef_number ?? '',
  ]);
  return '﻿' + [keys.map(text), ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** AC-15: argumenty `admin_list_invoices` (niepoprawne daty pomijane). */
export function listArgs(tab: InvoiceTab, from: string, to: string): Record<string, string | null> {
  return { p_tab: tab, p_from: DATE.test(from) ? from : null, p_to: DATE.test(to) ? to : null };
}

/** Nazwa pliku, np. `faktury-do-wystawienia-2026-11-01-2026-11-18.csv`. */
export function invoicesFileName(tab: InvoiceTab, from: string, to: string): string {
  const range = [from, to].filter((date) => DATE.test(date)).join('-');
  return `faktury-${tab === 'todo' ? 'do-wystawienia' : 'wystawione'}${range ? `-${range}` : ''}.csv`;
}
