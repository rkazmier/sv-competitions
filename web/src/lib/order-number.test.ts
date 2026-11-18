import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { normalizeOrderNumber } from './order-number';

describe('AC-10: rozpoznanie numeru zamówienia w filtrze', () => {
  it.each([
    ['SV-2026-000123', 'SV-2026-000123'],
    ['sv-2026-123', 'SV-2026-000123'],
    ['SV-2026-123', 'SV-2026-000123'],
    ['  sv-2026-000123  ', 'SV-2026-000123'],
    ['SV-2026-0000123', 'SV-2026-000123'],
    ['SV-2031-1000000', 'SV-2031-1000000'],
  ])('„%s” → %s', (text, number) => {
    expect(normalizeOrderNumber(text)).toBe(number);
  });
});

describe('AC-11: tekst bez formy numeru to wyszukiwanie po osobie', () => {
  it.each(['Jan Kowalski', 'jan@example.test', '123', '3f2b8c1e-0000-0000-0000-000000000000', 'SV-26-123', 'SV-2026-', 'SV 2026 123', ''])(
    '„%s” → null',
    (text) => {
      expect(normalizeOrderNumber(text)).toBeNull();
    },
  );
});

describe('SPEC-006 §6: teksty z numerem zamówienia', () => {
  it('AC-9, AC-12, AC-13, AC-15: kolumny i komunikaty', () => {
    expect(t('orders.colNumber')).toBe('Nr zamówienia');
    expect(t('orders.csvNumber')).toBe('Numer zamówienia');
    expect(t('offer.orderNumber', { number: 'SV-2026-000123' })).toBe('Nr: SV-2026-000123');
    expect(t('offer.paymentOrder', { number: 'SV-2026-000123' })).toBe('Zamówienie SV-2026-000123');
    expect(t('sales.colNumber')).toBe('Nr zamówienia');
    expect(t('sales.saved', { number: 'SV-2026-000123' })).toBe('Sprzedaż zarejestrowana: SV-2026-000123.');
  });
});
