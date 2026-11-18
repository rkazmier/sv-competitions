import { describe, expect, it } from 'vitest';
import { dayTypeOf, itemArgs, saleErrorKey, saleItems, saleTime, saleTotals, type OnSiteSale, type TicketEvent } from './on-site-sales';

const P = (id: string, fields: Record<string, unknown>) =>
  ({ id, name: id, price: 1000, kind: 'entries', day_type: null, is_active: true, ...fields }) as never;

// 2026-11-18 — środa (dzień powszedni), 2026-11-21 — sobota.
const products = [
  P('karnet', { kind: 'entries' }),
  P('weekend', { kind: 'single_entry', day_type: 'weekend' }),
  P('weekday', { kind: 'single_entry', day_type: 'weekday' }),
  P('ukryty', { kind: 'entries', is_active: false }),
];
const ev = (id: string, starts_on: string, ends_on: string | null = null): TicketEvent => ({
  id,
  name: id,
  starts_on,
  ends_on,
  ticket_price: 5000,
});
const events = [ev('dzis', '2026-11-17', '2026-11-19'), ev('przyszle', '2026-11-25'), ev('minione', '2026-11-10')];
const ticket = (name: string) => `Wejściówka: ${name}`;
const values = (guest: boolean, today = '2026-11-18') =>
  saleItems(products, events, today, guest, ticket).map((item) => item.value);

describe('sprzedaż na miejscu (SPEC-003 US-5)', () => {
  it('AC-21: osobie z kontem — aktywne produkty i wejściówki na trwające lub przyszłe wydarzenia', () => {
    expect(values(false)).toEqual([
      'product:karnet',
      'product:weekend',
      'product:weekday',
      'event:dzis',
      'event:przyszle',
    ]);
    expect(saleItems(products, events, '2026-11-18', false, ticket).at(-1)).toEqual({
      value: 'event:przyszle',
      name: 'Wejściówka: przyszle',
      price: 5000,
    });
  });

  it('AC-22: osobie bez konta — tylko wejście pasujące do dziś i wejściówka na dzisiejsze wydarzenie', () => {
    expect(values(true)).toEqual(['product:weekday', 'event:dzis']);
    expect(values(true, '2026-11-21')).toEqual(['product:weekend']);
    expect(dayTypeOf('2026-11-22')).toBe('weekend');
    expect(dayTypeOf('2026-11-23')).toBe('weekday');
  });

  it('AC-21: wartość pola → argumenty create_on_site_order', () => {
    const id = '00000000-0000-0000-0000-0000000000f1';
    expect(itemArgs(`product:${id}`)).toEqual({ p_product_id: id, p_event_id: null });
    expect(itemArgs(`event:${id}`)).toEqual({ p_product_id: null, p_event_id: id });
    expect(itemArgs('')).toBeNull();
    expect(itemArgs('product:x')).toBeNull();
  });

  it('AC-21, AC-22: błędy bazy → komunikaty', () => {
    expect(saleErrorKey({ message: 'sold_out' })).toBe('sales.errorSoldOut');
    expect(saleErrorKey({ message: 'guest_product_not_allowed' })).toBe('sales.errorGuest');
    expect(saleErrorKey({ message: 'forbidden' })).toBe('sales.errorGeneric');
    expect(saleErrorKey(null)).toBe('sales.errorGeneric');
  });

  it('AC-23: sumy gotówki i terminala tylko z opłaconych, godzina w Europe/Warsaw', () => {
    const sale = (amount: number, on_site_method: 'cash' | 'terminal', status = 'paid'): OnSiteSale => ({
      id: String(amount),
      order_number: 'SV-2026-000001',
      created_at: '2026-11-18T08:05:00Z',
      item_name: 'X',
      amount,
      on_site_method,
      status,
      seller_name: 'Anna',
    });
    expect(saleTotals([sale(5000, 'cash'), sale(2000, 'cash'), sale(12000, 'terminal'), sale(900, 'cash', 'refunded')])).toEqual({
      cash: 7000,
      terminal: 12000,
    });
    expect(saleTotals([])).toEqual({ cash: 0, terminal: 0 });
    expect(saleTime('2026-11-18T08:05:00Z')).toBe('09:05');
  });
});
