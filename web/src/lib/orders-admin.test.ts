import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  csvCell,
  csvFileName,
  defaultFilters,
  filterArgs,
  invoiceAction,
  ordersCsv,
  ordersTotal,
  personLabel,
  refundAction,
  refundErrorKey,
  type AdminOrder,
} from './orders-admin';

const ID = '00000000-0000-0000-0000-0000000000f1';

const order = (fields: Partial<AdminOrder> = {}): AdminOrder => ({
  id: '00000000-0000-0000-0000-0000000000d1',
  created_at: '2026-11-18T08:05:00Z',
  item_name: 'Karnet 10 wejść',
  amount: 120000,
  payment_method: 'tpay',
  on_site_method: null,
  status: 'paid',
  refund_note: null,
  user_id: '00000000-0000-0000-0000-0000000000c1',
  person_name: 'Jan Kowalski',
  person_email: 'jan@example.test',
  seller_name: null,
  pass_used: false,
  invoice_requested: false,
  ...fields,
});

describe('AC-24: filtry zamówień', () => {
  it('domyślnie od 1. dnia bieżącego miesiąca do dziś', () => {
    expect(defaultFilters('2026-11-18')).toMatchObject({ from: '2026-11-01', to: '2026-11-18', status: '', person: '' });
  });

  it('pola → argumenty admin_list_orders; puste i niepoprawne pomijane', () => {
    expect(
      filterArgs({ from: '2026-11-01', to: '', status: 'paid', method: 'on_site', item: `product:${ID}`, person: ' Jan ' }),
    ).toEqual({
      p_from: '2026-11-01',
      p_to: null,
      p_status: 'paid',
      p_method: 'on_site',
      p_product_id: ID,
      p_event_id: null,
      p_person: 'Jan',
    });
    expect(filterArgs({ from: 'x', to: '2026-13', status: 'drop', method: 'card', item: `event:${ID}`, person: '  ' })).toEqual({
      p_from: null,
      p_to: null,
      p_status: null,
      p_method: null,
      p_product_id: null,
      p_event_id: ID,
      p_person: null,
    });
  });

  it('suma kwot bieżącego widoku', () => {
    expect(ordersTotal([order(), order({ amount: 5000, status: 'refunded' })])).toBe(125000);
    expect(ordersTotal([])).toBe(0);
  });

  it('osoba: imię i nazwisko, inaczej e-mail; bez konta — null', () => {
    expect(personLabel(order())).toBe('Jan Kowalski');
    expect(personLabel(order({ person_name: null }))).toBe('jan@example.test');
    expect(personLabel(order({ person_name: null, person_email: null, user_id: null }))).toBeNull();
  });
});

describe('AC-24: eksport CSV', () => {
  it('BOM, średnik, nagłówki z i18n, kwota z przecinkiem, metoda i status po polsku', () => {
    const csv = ordersCsv(
      [order(), order({ payment_method: 'on_site', on_site_method: 'cash', status: 'refunded', user_id: null, person_name: null,
        person_email: null, seller_name: 'Anna', refund_note: 'Zwrot gotówki / na terminal' })],
      (key) => t(key),
    );
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('"Data";"Produkt";"Kwota";"Metoda";"Status";"Osoba";"Sprzedał(a)";"Uwagi"');
    expect(lines[1]).toBe('"18.11.2026, 09:05";"Karnet 10 wejść";"1200,00";"Online";"Opłacone";"Jan Kowalski";"";""');
    expect(lines[2]).toContain('"Na miejscu / gotówka";"Zwrócone";"Bez konta";"Anna";"Zwrot gotówki / na terminal"');
  });

  it('cudzysłowy podwojone, formuły arkusza zneutralizowane', () => {
    expect(csvCell('Karnet "VIP"')).toBe('"Karnet ""VIP"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-10')).toBe(`"'-10"`);
  });

  it('nazwa pliku z zakresu dat', () => {
    expect(csvFileName(defaultFilters('2026-11-18'))).toBe('zamowienia-2026-11-01-2026-11-18.csv');
    expect(csvFileName({ ...defaultFilters('2026-11-18'), from: '', to: '' })).toBe('zamowienia.csv');
  });
});

describe('AC-25, AC-26: „Anuluj i zwróć”', () => {
  it('AC-25: opłacone bez zużycia — przycisk zwrotu', () => {
    expect(refundAction(order())).toBe('refund');
  });

  it('AC-26: uprawnienie używane — bez przycisku, informacja', () => {
    expect(refundAction(order({ pass_used: true }))).toBe('used');
    expect(t('orders.passUsed')).toBe('Karnet był używany — zwrot poza systemem.');
  });

  it('AC-25: inne stany — bez akcji', () => {
    for (const status of ['pending', 'cancelled', 'refund_pending', 'refunded'] as const) {
      expect(refundAction(order({ status }))).toBeNull();
    }
  });

  it('błędy zwrotu → komunikaty', () => {
    expect(refundErrorKey('pass_used')).toBe('orders.passUsed');
    expect(refundErrorKey('refund_failed')).toBe('orders.errorTpay');
    expect(refundErrorKey(undefined)).toBe('orders.errorGeneric');
  });
});

describe('SPEC-004 AC-14: dane do faktury po zakupie', () => {
  it('„Dodaj dane do faktury” tylko przy opłaconym zamówieniu bez faktury', () => {
    expect(invoiceAction(order())).toBe('add');
    expect(invoiceAction(order({ invoice_requested: true }))).toBe('requested');
    expect(invoiceAction(order({ status: 'refunded' }))).toBeNull();
    expect(invoiceAction(order({ status: 'pending' }))).toBeNull();
  });
});
