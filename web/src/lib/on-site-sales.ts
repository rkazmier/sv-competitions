/**
 * Sprzedaż na miejscu (`/panel/sprzedaz/`, SPEC-003 US-5: AC-21…AC-23). Logika bez DOM:
 * co można sprzedać osobie z kontem i bez konta, komunikaty błędów `create_on_site_order`, sumy dzisiejszej sprzedaży.
 * Interfejs: lib/on-site-sales-ui.ts.
 */
import type { MessageKey } from '../i18n';
import type { Product } from './products';

export type OnSiteMethod = 'cash' | 'terminal';
export const ON_SITE_METHODS: readonly OnSiteMethod[] = ['cash', 'terminal'];

/** Minimalna długość zapytania (jak `staff_search_people`, SPEC-005 AC-6). */
export const SEARCH_MIN_LENGTH = 3;

/** Wynik `staff_search_people` — e-mail tylko częściowo. */
export interface PersonHit {
  id: string;
  full_name: string | null;
  email_hint: string | null;
}

/** Płatne wydarzenie w sprzedaży (`calendar_events`, AC-17…AC-19). */
export interface TicketEvent {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  ticket_price: number;
}

export const SALE_EVENT_COLUMNS = 'id, name, starts_on, ends_on, ticket_price';

/** Pozycja do sprzedaży: `product:<id>` albo `event:<id>` (wartość pola wyboru). */
export interface SaleItem {
  value: string;
  name: string;
  price: number;
}

/** Dzień tygodnia daty `YYYY-MM-DD` → `weekend` (sob.–niedz.) albo `weekday` (§5, także w święta). */
export function dayTypeOf(date: string): 'weekend' | 'weekday' {
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

/**
 * Co można sprzedać (AC-21, AC-22). Z kontem: aktywne produkty i wejściówki na wydarzenia, które jeszcze trwają.
 * Bez konta: tylko wejście jednorazowe pasujące do dzisiejszego dnia i wejściówka na wydarzenie trwające dziś.
 * Ostateczna kontrola — `create_on_site_order` w bazie.
 */
export function saleItems(
  products: readonly Pick<Product, 'id' | 'kind' | 'name' | 'price' | 'day_type' | 'is_active'>[],
  events: readonly TicketEvent[],
  today: string,
  guest: boolean,
  ticketName: (name: string) => string,
): SaleItem[] {
  const items: SaleItem[] = products
    .filter((p) => p.is_active && (!guest || (p.kind === 'single_entry' && p.day_type === dayTypeOf(today))))
    .map((p) => ({ value: `product:${p.id}`, name: p.name, price: p.price }));
  for (const event of events) {
    const lastDay = event.ends_on ?? event.starts_on;
    if (lastDay < today || (guest && event.starts_on > today)) continue;
    items.push({ value: `event:${event.id}`, name: ticketName(event.name), price: event.ticket_price });
  }
  return items;
}

/** Wartość pola wyboru → argumenty `create_on_site_order`. */
export function itemArgs(value: string): { p_product_id: string | null; p_event_id: string | null } | null {
  const match = /^(product|event):([0-9a-f-]{36})$/i.exec(value);
  if (!match) return null;
  return match[1] === 'product'
    ? { p_product_id: match[2], p_event_id: null }
    : { p_product_id: null, p_event_id: match[2] };
}

const ERRORS: Record<string, MessageKey> = {
  sold_out: 'sales.errorSoldOut',
  sales_closed: 'sales.errorSalesClosed',
  event_unavailable: 'sales.errorUnavailable',
  product_not_found: 'sales.errorUnavailable',
  guest_product_not_allowed: 'sales.errorGuest',
  user_not_found: 'sales.errorPerson',
};

/** Błąd `create_on_site_order` → komunikat dla obsługi. */
export function saleErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return ERRORS[error?.message ?? ''] ?? 'sales.errorGeneric';
}

/** Wiersz `staff_on_site_sales_today` (AC-23). */
export interface OnSiteSale {
  id: string;
  created_at: string;
  item_name: string;
  amount: number;
  on_site_method: OnSiteMethod;
  status: string;
  seller_name: string | null;
}

/** AC-23: sumy gotówki i terminala — tylko opłacone (zwrócone pieniądze nie są w kasie). */
export function saleTotals(sales: readonly OnSiteSale[]): Record<OnSiteMethod, number> {
  const totals: Record<OnSiteMethod, number> = { cash: 0, terminal: 0 };
  for (const sale of sales) {
    if (sale.status === 'paid') totals[sale.on_site_method] += sale.amount;
  }
  return totals;
}

const timeFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

/** Godzina sprzedaży w Europe/Warsaw, np. „09:05”. */
export function saleTime(createdAt: string): string {
  return timeFormat.format(new Date(createdAt));
}
