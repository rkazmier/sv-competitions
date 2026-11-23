import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { PAYMENT_METHOD_TEXT } from './offer';
import {
  canCancelGrant,
  canResendEmail,
  csvCell,
  csvFileName,
  defaultFilters,
  emailStatusText,
  filterArgs,
  grantCancelErrorKey,
  grantDetails,
  invoiceAction,
  methodKeys,
  PAYMENT_METHODS,
  ordersCsv,
  numberSearchKey,
  ordersTotal,
  personLabel,
  refundAction,
  refundErrorKey,
  type AdminOrder,
} from './orders-admin';
import { formatPrice, NBSP } from './products';

const ID = '00000000-0000-0000-0000-0000000000f1';

const order = (fields: Partial<AdminOrder> = {}): AdminOrder => ({
  id: '00000000-0000-0000-0000-0000000000d1',
  order_number: 'SV-2026-000123',
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
  grant_reason: null,
  grant_cancel_note: null,
  terms_version: null,
  early_performance_consent_at: null,
  email_status: null,
  email_sent_at: null,
  ...fields,
});

describe('SPEC-012 AC-11, AC-14: stan e-maila z potwierdzeniem', () => {
  it('AC-14: „wysłano <data>” / „w kolejce” / „nie wysłano” (Europe/Warsaw)', () => {
    expect(emailStatusText(order({ email_status: 'sent', email_sent_at: '2027-01-02T13:06:00Z' }))).toBe(
      'E-mail z potwierdzeniem: wysłano 2.01.2027 14:06',
    );
    expect(emailStatusText(order({ email_status: 'pending' }))).toBe('E-mail z potwierdzeniem: w kolejce');
    expect(emailStatusText(order({ email_status: 'failed' }))).toBe('E-mail z potwierdzeniem: nie wysłano');
  });

  it('AC-13, AC-14: zamówienie bez e-maila (na miejscu, prezent, sprzed regulaminu) — bez informacji', () => {
    expect(emailStatusText(order({ payment_method: 'on_site' }))).toBeNull();
  });

  it('AC-11: „Wyślij ponownie” tylko po nieudanych próbach (failed)', () => {
    expect(canResendEmail(order({ email_status: 'failed' }))).toBe(true);
    for (const email_status of ['sent', 'pending', 'skipped', null] as const) {
      expect(canResendEmail(order({ email_status }))).toBe(false);
    }
  });
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

describe('SPEC-006 AC-10, AC-11: filtr „Osoba lub nr zamówienia”', () => {
  it('AC-10: numer zamówienia — komunikat o pominiętych filtrach albo o braku numeru', () => {
    expect(t('orders.person')).toBe('Osoba lub nr zamówienia');
    expect(numberSearchKey(' sv-2026-123 ', 1)).toBe('orders.numberResult');
    expect(t('orders.numberResult')).toBe('Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.');
    expect(numberSearchKey('SV-2026-000999', 0)).toBe('orders.numberNotFound');
    expect(t('orders.numberNotFound')).toBe('Brak zamówienia o tym numerze.');
  });

  it('AC-11: tekst bez formy numeru — wyszukiwanie po osobie bez komunikatu, wartość trafia do p_person', () => {
    expect(numberSearchKey('Jan Kowalski', 0)).toBeNull();
    expect(numberSearchKey('123', 3)).toBeNull();
    expect(filterArgs({ ...defaultFilters('2026-11-18'), person: ' Jan ' }).p_person).toBe('Jan');
  });
});

describe('AC-24: eksport CSV', () => {
  it('BOM, średnik, nagłówki z i18n, kwota z przecinkiem, metoda i status po polsku; SPEC-006 AC-9: numer zamówienia w 1. kolumnie', () => {
    const csv = ordersCsv(
      [order(), order({ payment_method: 'on_site', on_site_method: 'cash', status: 'refunded', user_id: null, person_name: null,
        person_email: null, seller_name: 'Anna', refund_note: 'Zwrot gotówki / na terminal' })],
      (key) => t(key),
    );
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('"Numer zamówienia";"Data";"Produkt";"Kwota";"Metoda";"Status";"Osoba";"Sprzedał(a)";"Uwagi";"Powód przyznania"');
    expect(lines[1]).toBe('"SV-2026-000123";"18.11.2026, 09:05";"Karnet 10 wejść";"1200,00";"Online";"Opłacone";"Jan Kowalski";"";"";""');
    expect(lines[2]).toContain('"Na miejscu / gotówka";"Zwrócone";"Bez konta";"Anna";"Zwrot gotówki / na terminal";""');
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

describe('SPEC-010: prezent w zamówieniach', () => {
  const gift = (fields: Partial<AdminOrder> = {}) =>
    order({ payment_method: 'gift', amount: 0, seller_name: 'Admin Adamski', grant_reason: 'Nagroda — zawody X', ...fields });

  it('AC-14: filtr „Metoda” — Online, Na miejscu, Prezent; `gift` trafia do p_method', () => {
    expect(PAYMENT_METHODS.map((method) => t(PAYMENT_METHOD_TEXT[method]))).toEqual(['Online', 'Na miejscu', 'Prezent']);
    expect(filterArgs({ ...defaultFilters('2026-11-21'), method: 'gift' }).p_method).toBe('gift');
  });

  it('AC-14: lista — kwota 0,00 zł, metoda „Prezent”, „Kto” = admin; szczegóły z powodem i notatką anulowania', () => {
    expect(formatPrice(gift().amount)).toBe(`0,00${NBSP}zł`);
    expect(methodKeys(gift()).map((key) => t(key))).toEqual(['Prezent']);
    expect(gift().seller_name).toBe('Admin Adamski');
    expect(grantDetails(gift())).toEqual(['Powód: Nagroda — zawody X']);
    expect(grantDetails(gift({ status: 'cancelled', grant_cancel_note: 'Pomyłka' }))).toEqual([
      'Powód: Nagroda — zawody X',
      'Notatka anulowania: Pomyłka',
    ]);
    expect(grantDetails(order())).toEqual([]);
  });

  it('AC-14: CSV — metoda „Prezent”, kolumna „Powód przyznania” (pusta dla innych metod); suma bez zmian', () => {
    const lines = ordersCsv([gift(), order()], (key) => t(key)).replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0].endsWith('"Uwagi";"Powód przyznania"')).toBe(true);
    expect(lines[1]).toContain('"0,00";"Prezent";"Opłacone";"Jan Kowalski";"Admin Adamski";"";"Nagroda — zawody X"');
    expect(lines[2].endsWith('"";""')).toBe(true);
    expect(ordersTotal([gift(), order()])).toBe(ordersTotal([order()]));
  });

  it('AC-17: prezent — bez „Anuluj i zwróć” i „Dodaj dane do faktury”', () => {
    expect(refundAction(gift())).toBeNull();
    expect(refundAction(gift({ pass_used: true }))).toBeNull();
    expect(invoiceAction(gift())).toBeNull();
  });

  it('AC-18: „Anuluj przyznanie” przy opłaconym prezencie, także używanym; nie przy innych metodach', () => {
    expect(canCancelGrant(gift())).toBe(true);
    expect(canCancelGrant(gift({ pass_used: true }))).toBe(true);
    expect(canCancelGrant(order())).toBe(false);
    expect(t('orders.cancelGrantText')).toBe(
      'Karnet zostanie anulowany. Niewykorzystane wejścia i dni przepadają, historia wejść zostaje. Tej operacji nie można cofnąć.',
    );
  });

  it('AC-19: po anulowaniu — „Przyznanie anulowane.”', () => {
    expect(t('orders.grantCancelled')).toBe('Przyznanie anulowane.');
  });

  it('AC-21: anulowany prezent — bez przycisku; ponowne wywołanie → „Przyznanie zostało już anulowane.”', () => {
    expect(canCancelGrant(gift({ status: 'cancelled' }))).toBe(false);
    expect(t(grantCancelErrorKey('order_not_paid'))).toBe('Przyznanie zostało już anulowane.');
    expect(grantCancelErrorKey('invalid_note')).toBe('orders.grantNoteTooLong');
    expect(grantCancelErrorKey(null)).toBe('orders.grantCancelError');
  });
});
