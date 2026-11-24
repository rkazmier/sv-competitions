import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { NBSP } from './products';
import { isCommentValid, withdrawalErrorKey, withdrawalQuote, withdrawalStatement } from './withdrawal';

describe('SPEC-012 US-9: odstąpienie od umowy z konta', () => {
  it('AC-46: przycisk „Odstąp od umowy”', () => {
    expect(t('offer.withdraw')).toBe('Odstąp od umowy');
  });

  it('AC-47: treść oświadczenia, wyliczenie na dziś, uwaga i przyciski', () => {
    expect(withdrawalStatement('Karnet 3 wejść', 'SV-2027-000123', '2027-01-02')).toBe(
      'Odstępuję od umowy zakupu Karnet 3 wejść (zamówienie SV-2027-000123, opłacone 2.01.2027).',
    );
    expect(withdrawalQuote({ amount: 10000, used: 1, total: 3, used_value: 3333, refund_amount: 6667 })).toBe(
      `Cena 100,00${NBSP}zł, wykorzystano 1 z 3 wejść (33,33${NBSP}zł). Zwrot: 66,67${NBSP}zł.`,
    );
    expect(t('offer.withdrawEffect')).toBe('Od chwili wysłania karnet przestaje działać.');
    expect([t('offer.withdrawSubmit'), t('offer.withdrawBack')]).toEqual(['Wyślij oświadczenie', 'Wróć']);
  });

  it('AC-47: uwagi opcjonalne, do 500 znaków', () => {
    expect(isCommentValid('')).toBe(true);
    expect(isCommentValid('x'.repeat(500))).toBe(true);
    expect(isCommentValid('x'.repeat(501))).toBe(false);
  });

  it('AC-48: komunikat po wysłaniu', () => {
    expect(t('offer.withdrawSent', { amount: `66,67${NBSP}zł` })).toBe(`Oświadczenie wysłane. Zwrot 66,67${NBSP}zł otrzymasz w ciągu 14 dni.`);
  });

  it('AC-50: drugie zgłoszenie i zgłoszenie po oknie', () => {
    expect(t(withdrawalErrorKey('withdrawal_exists'))).toBe('Oświadczenie o odstąpieniu od tej umowy zostało już wysłane.');
    expect(t(withdrawalErrorKey('withdrawal_window_closed'))).toBe('Termin na odstąpienie minął.');
    expect(t(withdrawalErrorKey('withdrawal_nothing_to_refund'))).toBe('Usługa wykonana w całości — prawo odstąpienia wygasło.');
    expect(withdrawalErrorKey('withdrawal_not_available')).toBe('offer.withdrawNotAvailable');
    expect(withdrawalErrorKey(undefined)).toBe('offer.withdrawError');
  });
});
