// SPEC-012 US-1, US-2: wersja regulaminu i zgoda w zamówieniu.
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { ORDER_COLUMNS, canOrder, needsConsent, orderTermsLines, shortDateTime, termsVersionSuffix } from './offer';
import { NBSP, formatPrice } from './products';
import { salesTermsVersions, shortDay } from './sales-terms';

describe('SPEC-012 US-1: wersja regulaminu', () => {
  it('AC-1: checkbox „Akceptuję regulamin sprzedaży (obowiązuje od 1.01.2027)”; bez wersji — bez daty (§7)', () => {
    expect(`${t('offer.acceptTerms')} ${t('offer.salesTermsLink')}${termsVersionSuffix('2027-01-01')}`).toBe(
      'Akceptuję regulamin sprzedaży (obowiązuje od 1.01.2027)',
    );
    expect(termsVersionSuffix(null)).toBe('');
  });

  it('AC-2: „Zamawiam i płacę 120,00 zł”, nieaktywny do zaznaczenia wymaganych checkboxów', () => {
    expect(t('offer.pay', { amount: formatPrice(12000) })).toBe(`Zamawiam i płacę 120,00${NBSP}zł`);
    expect(canOrder({ terms: false, consent: true })).toBe(false);
    expect(canOrder({ terms: true, consent: false })).toBe(false);
    expect(canOrder({ terms: true, consent: true })).toBe(true);
    expect(canOrder({ terms: true, consent: null })).toBe(true);
  });

  it('AC-3: komunikat terms_changed', () => {
    expect(t('offer.termsChanged')).toBe(
      'Regulamin sprzedaży właśnie się zmienił. Zapoznaj się z nową wersją i zaakceptuj ją ponownie.',
    );
  });

  it('AC-4: „Wersje regulaminu” od najnowszej z linkiem do PDF', () => {
    expect(t('salesTerms.versionsHeading')).toBe('Wersje regulaminu');
    expect(salesTermsVersions(['2027-01-01', '2028-03-15'])).toEqual([
      { date: '15.03.2028', href: '/regulamin-sprzedazy/regulamin-sprzedazy-2028-03-15.pdf' },
      { date: '1.01.2027', href: '/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf' },
    ]);
    expect(`${t('salesTerms.versionItem', { date: shortDay('2027-01-01') })} — ${t('salesTerms.versionPdf')}`).toBe(
      'Obowiązuje od 1.01.2027 — PDF',
    );
  });

  it('AC-5: „Regulamin z 1.01.2027” z PDF wersji i data zgody (Europe/Warsaw)', () => {
    expect(ORDER_COLUMNS).toContain('terms_version');
    expect(ORDER_COLUMNS).toContain('early_performance_consent_at');
    expect(orderTermsLines({ terms_version: '2027-01-01', early_performance_consent_at: '2027-01-02T13:05:00Z' })).toEqual({
      terms: { text: 'Regulamin z 1.01.2027', href: '/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf' },
      consent: 'Zgoda na korzystanie przed upływem 14 dni: 2.01.2027 14:05',
    });
    expect(orderTermsLines({ terms_version: null, early_performance_consent_at: null })).toEqual({ terms: null, consent: null });
    expect(shortDateTime('2027-07-02T22:30:00Z')).toBe('3.07.2027 00:30');
  });
});

describe('SPEC-012 US-2: zgoda na korzystanie przed upływem 14 dni', () => {
  it('AC-6: zgoda przy karnecie i wejściu jednorazowym, przy wejściówce — informacja', () => {
    expect(needsConsent({ kind: 'product' })).toBe(true);
    expect(needsConsent({ kind: 'ticket' })).toBe(false);
    expect(t('offer.consent')).toBe(
      'Chcę korzystać z karnetu przed upływem 14 dni na odstąpienie od umowy. Wiem, że po wykorzystaniu usługi w całości tracę prawo odstąpienia.',
    );
    expect(t('offer.consentHint')).toBe('Bez tej zgody kupisz karnet na strzelnicy.');
    expect(t('offer.ticketNoWithdrawal')).toBe('Wejściówki na wydarzenia nie podlegają odstąpieniu od umowy.');
  });

  it('AC-7: komunikat consent_required', () => {
    expect(t('offer.consentRequired')).toBe('Zaznacz zgodę na korzystanie przed upływem 14 dni.');
  });
});
