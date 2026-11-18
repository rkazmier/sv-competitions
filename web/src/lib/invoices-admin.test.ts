import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  FIELD_KEYS,
  checkMark,
  invoiceErrorKey,
  invoiceValues,
  invoicesCsv,
  invoicesFileName,
  isRefunded,
  listArgs,
  saleDate,
  type AdminInvoice,
} from './invoices-admin';

const invoice = (fields: Partial<AdminInvoice> = {}): AdminInvoice => ({
  id: '00000000-0000-0000-0000-0000000000d1',
  order_number: 'SV-2026-000123',
  paid_at: '2026-11-10T23:30:00Z',
  item_name: 'Karnet 10 wejść',
  amount: 12000,
  payment_method: 'tpay',
  on_site_method: null,
  status: 'paid',
  invoice_nip: '5260250274',
  invoice_company_name: 'Firma "Test" sp. z o.o.',
  invoice_company_address: 'ul. Prosta 1, 00-001 Warszawa',
  invoice_data_source: 'vat_whitelist',
  invoice_number: null,
  ksef_number: null,
  invoice_issued_at: null,
  issued_by_name: null,
  ...fields,
});

const text = (key: Parameters<typeof t>[0]) => t(key);

describe('AC-11: dane do skopiowania do e-mikrofirmy', () => {
  it('SPEC-006 AC-7: NIP, nabywca, adres, pozycja, kwota brutto, data sprzedaży (Europe/Warsaw), sposób zapłaty, numer zamówienia (order_number)', () => {
    expect(FIELD_KEYS.map(text)).toEqual([
      'NIP', 'Nazwa nabywcy', 'Adres', 'Nazwa pozycji', 'Kwota brutto', 'Data sprzedaży', 'Sposób zapłaty', 'Numer zamówienia',
    ]);
    expect(invoiceValues(invoice(), text)).toEqual([
      '5260250274', 'Firma "Test" sp. z o.o.', 'ul. Prosta 1, 00-001 Warszawa', 'Karnet 10 wejść', '120,00', '11.11.2026',
      'przelew/płatność online — Tpay', 'SV-2026-000123',
    ]);
  });

  it('sposób zapłaty na miejscu: gotówka albo karta — terminal', () => {
    expect(invoiceValues(invoice({ payment_method: 'on_site', on_site_method: 'cash' }), text)[6]).toBe('gotówka');
    expect(invoiceValues(invoice({ payment_method: 'on_site', on_site_method: 'terminal' }), text)[6]).toBe('karta — terminal');
  });

  it('data sprzedaży w lecie (czas letni)', () => {
    expect(saleDate('2026-06-30T22:30:00Z')).toBe('01.07.2026');
  });
});

describe('AC-12: numer faktury i numer KSeF', () => {
  it('numer faktury wymagany, 1–50 znaków, przycięty', () => {
    expect(checkMark('  FV 1/11/2026 ', '')).toEqual({ ok: true, invoiceNumber: 'FV 1/11/2026', ksefNumber: null });
    expect(checkMark('   ', '')).toMatchObject({ ok: false, field: 'number' });
    expect(checkMark('x'.repeat(51), '')).toMatchObject({ ok: false, field: 'number' });
  });

  it('numer KSeF opcjonalny, zgodny ze wzorcem (wielkość liter bez znaczenia)', () => {
    expect(checkMark('FV 1', '5260250274-20261118-0100a0b1c2d3-e4')).toMatchObject({
      ok: true,
      ksefNumber: '5260250274-20261118-0100A0B1C2D3-E4',
    });
    expect(checkMark('FV 1', '5260250274-2026111-0100A0B1C2D3-E4')).toMatchObject({ ok: false, field: 'ksef' });
  });

  it('błędy bazy → komunikaty', () => {
    expect(invoiceErrorKey('invoice_already_issued')).toBe('invoices.errorChanged');
    expect(invoiceErrorKey('order_not_paid')).toBe('invoices.errorNotPaid');
    expect(invoiceErrorKey('invalid_ksef_number')).toBe('invoices.ksefError');
    expect(invoiceErrorKey(null)).toBe('invoices.errorGeneric');
  });
});

describe('AC-15: eksport CSV', () => {
  it('kolumny z AC-11 + numer faktury i KSeF; BOM, separator „;”, cudzysłowy; SPEC-006 AC-8: numer zamówienia = order_number', () => {
    const csv = invoicesCsv([invoice({ invoice_number: 'FV 1/11/2026', ksef_number: '5260250274-20261118-0100A0B1C2D3-E4' })], text);
    expect(csv.startsWith('﻿"NIP";"Nazwa nabywcy";')).toBe(true);
    const [header, row] = csv.slice(1).trim().split('\r\n');
    expect(header!.endsWith('"Numer zamówienia";"Numer faktury";"Numer KSeF"')).toBe(true);
    expect(row).toBe(
      '"5260250274";"Firma ""Test"" sp. z o.o.";"ul. Prosta 1, 00-001 Warszawa";"Karnet 10 wejść";"120,00";"11.11.2026";' +
        '"przelew/płatność online — Tpay";"SV-2026-000123";"FV 1/11/2026";"5260250274-20261118-0100A0B1C2D3-E4"',
    );
  });

  it('zakres dat zapłaty → argumenty i nazwa pliku', () => {
    expect(listArgs('issued', '2026-11-01', 'x')).toEqual({ p_tab: 'issued', p_from: '2026-11-01', p_to: null });
    expect(invoicesFileName('todo', '2026-11-01', '2026-11-18')).toBe('faktury-do-wystawienia-2026-11-01-2026-11-18.csv');
    expect(invoicesFileName('issued', '', '')).toBe('faktury-wystawione.csv');
  });
});

describe('AC-16: zwroty', () => {
  it('zwrócone lub w trakcie zwrotu — ostrzeżenie o korekcie', () => {
    expect(isRefunded(invoice({ status: 'refunded' }))).toBe(true);
    expect(isRefunded(invoice({ status: 'refund_pending' }))).toBe(true);
    expect(isRefunded(invoice())).toBe(false);
    expect(t('invoices.refunded')).toBe('Zwrot — sprawdź, czy potrzebna jest korekta w e-mikrofirmie.');
  });
});
