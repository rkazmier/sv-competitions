import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { checkNip, invoiceArgs, invoiceStatus, isValidNip, lookupView, normalizeNip, validateManual } from './invoice';

const NOW = new Date('2026-11-18T10:00:00.000Z');

describe('SPEC-004: NIP', () => {
  it('AC-2: normalizacja — myślniki, spacje, prefiks PL', () => {
    expect(normalizeNip('PL 526-025-09-95')).toBe('5260250995');
    expect(normalizeNip('pl5260250995')).toBe('5260250995');
    expect(normalizeNip('526 025 09 95')).toBe('5260250995');
  });

  it('AC-2: suma kontrolna', () => {
    expect(isValidNip('5260250995')).toBe(true);
    expect(isValidNip('5260250996')).toBe(false);
    expect(isValidNip('526025099')).toBe(false);
    // reszta 10 — NIP nieprawidłowy
    expect(isValidNip('1234567890')).toBe(false);
  });

  it('AC-2: błędny NIP → „Nieprawidłowy NIP.”', () => {
    expect(checkNip('PL 526-025-09-95')).toEqual({ ok: true, nip: '5260250995' });
    const wrong = checkNip('526-025-09-96');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(t(wrong.error)).toBe('Nieprawidłowy NIP.');
    expect(checkNip('')).toEqual({ ok: false, error: 'invoice.invalidNip' });
  });

  it('§7: NIP zagraniczny → komunikat o kontakcie ze strzelnicą', () => {
    expect(checkNip('DE123456789')).toEqual({ ok: false, error: 'invoice.foreignNip' });
    expect(t('invoice.foreignNip')).toBe('Faktury dla firm zagranicznych — skontaktuj się ze strzelnicą.');
  });
});

describe('SPEC-004: wynik company-lookup', () => {
  it('AC-3: firma znaleziona — dane do potwierdzenia ze źródłem i datą pobrania', () => {
    const view = lookupView('5260250995', { found: true, name: ' Firma ', address: 'ul. Prosta 1, Warszawa', source: 'regon' }, null, NOW);
    expect(view).toEqual({
      kind: 'found',
      details: {
        nip: '5260250995',
        company_name: 'Firma',
        company_address: 'ul. Prosta 1, Warszawa',
        data_source: 'regon',
        fetched_at: NOW.toISOString(),
      },
    });
  });

  it('AC-4: brak w rejestrach, brak odpowiedzi, limit zapytań → wpis ręczny', () => {
    expect(lookupView('5260250995', { found: false, name: null, address: null, source: null }, null, NOW)).toEqual({ kind: 'manual' });
    expect(lookupView('5260250995', null, null, NOW)).toEqual({ kind: 'manual' });
    expect(lookupView('5260250995', null, 'rate_limited', NOW)).toEqual({ kind: 'manual' });
    expect(lookupView('5260250995', null, 'lookup_failed', NOW)).toEqual({ kind: 'manual' });
    expect(t('invoice.notFound')).toBe('Nie znaleźliśmy firmy w rejestrze. Wpisz dane ręcznie.');
  });

  it('AC-2: odmowa company-lookup (invalid_nip, foreign_nip) → komunikat przy NIP', () => {
    expect(lookupView('1', null, 'invalid_nip', NOW)).toEqual({ kind: 'error', message: 'invoice.invalidNip' });
    expect(lookupView('1', null, 'foreign_nip', NOW)).toEqual({ kind: 'error', message: 'invoice.foreignNip' });
  });

  it('AC-4: Nazwa 2–250 znaków, Adres 5–300 znaków (po trim)', () => {
    expect(validateManual('AB', '12345')).toEqual({ name: true, address: true });
    expect(validateManual(' A ', '1234')).toEqual({ name: false, address: false });
    expect(validateManual('x'.repeat(251), 'x'.repeat(301))).toEqual({ name: false, address: false });
  });
});

describe('SPEC-004: zapis i status', () => {
  it('AC-5, AC-9: argumenty set_order_invoice_details', () => {
    const details = { nip: '5260250995', company_name: 'Firma', company_address: 'ul. Prosta 1', data_source: 'manual', fetched_at: null } as const;
    expect(invoiceArgs('order-1', details, false)).toEqual({
      p_order_id: 'order-1',
      p_nip: '5260250995',
      p_company_name: 'Firma',
      p_company_address: 'ul. Prosta 1',
      p_data_source: 'manual',
      p_fetched_at: null,
      p_save_billing_details: false,
    });
  });

  it('AC-7: „Faktura: w przygotowaniu” albo „Faktura: <numer>”', () => {
    expect(invoiceStatus({ invoice_requested: false, invoice_number: null })).toBeNull();
    expect(invoiceStatus({ invoice_requested: true, invoice_number: null })).toEqual({ key: 'invoice.statusPending' });
    expect(t('invoice.statusPending')).toBe('Faktura: w przygotowaniu');
    const issued = invoiceStatus({ invoice_requested: true, invoice_number: 'FV 1/11/2026' });
    expect(issued).toEqual({ key: 'invoice.statusIssued', number: 'FV 1/11/2026' });
    expect(t('invoice.statusIssued', { number: 'FV 1/11/2026' })).toBe('Faktura: FV 1/11/2026');
  });
});
