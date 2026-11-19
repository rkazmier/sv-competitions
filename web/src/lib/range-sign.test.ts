import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { validateCompletion } from './range-entry';
import {
  MAX_SIGNATURE_BYTES,
  entryDateTime,
  isAlreadyUploaded,
  isSignatureComplete,
  permitOrAddress,
  saveErrorKey,
  signaturePath,
  signaturePoints,
  type Stroke,
} from './range-sign';

const line = (n: number): Stroke => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

describe('podpis i zapis wpisu (SPEC-005 US-5, US-6)', () => {
  it('AC-13: dane wpisu — decyzja z organem albo adres, data i godzina w Europe/Warsaw', () => {
    expect(permitOrAddress({ full_name: 'Ewa', permit_number: 'AB 1', permit_authority: 'KWP Katowice', address: null })).toBe(
      'AB 1, KWP Katowice',
    );
    expect(permitOrAddress({ full_name: 'Ewa', permit_number: null, permit_authority: null, address: 'ul. Stalowa 1' })).toBe(
      'ul. Stalowa 1',
    );
    expect(entryDateTime('2026-11-18T09:32:00Z')).toBe('18.11.2026, 10:32');
    expect(t('rangeSign.rulesPlaceholder')).toBe('[TEKST DO UZUPEŁNIENIA]');
    expect(t('rangeSign.confirm')).toBe('Podpisując, potwierdzasz zapoznanie się z regulaminem strzelnicy.');
  });

  it('AC-14: pusty lub krótszy niż 20 punktów podpis nie wystarcza', () => {
    expect(isSignatureComplete([])).toBe(false);
    expect(isSignatureComplete([line(10), line(9)])).toBe(false);
    expect(signaturePoints([line(10), line(10)])).toBe(20);
    expect(isSignatureComplete([line(10), line(10)])).toBe(true);
  });

  it('AC-15: plik podpisu <RRRR>/<MM>/<id>.png (miesiąc Europe/Warsaw), limit 200 KB', () => {
    const id = '30000000-0000-0000-0000-000000000001';
    expect(signaturePath(id, new Date('2026-11-18T10:00:00Z'))).toBe(`2026/11/${id}.png`);
    // 31.12 po 23:00 UTC to już styczeń w Warszawie.
    expect(signaturePath(id, new Date('2026-12-31T23:30:00Z'))).toBe(`2027/01/${id}.png`);
    expect(MAX_SIGNATURE_BYTES).toBe(204800);
  });

  it('AC-16: komunikaty błędów zapisu; ponowne wysłanie tego samego pliku nie jest błędem', () => {
    expect(t(saveErrorKey({ message: 'pass_not_valid' }))).toBe('Uprawnienie zostało właśnie wykorzystane — wybierz inne.');
    expect(t(saveErrorKey({ message: 'upload_failed' }))).toBe('Nie udało się zapisać wpisu. Spróbuj ponownie.');
    expect(t(saveErrorKey(null))).toBe('Nie udało się zapisać wpisu. Spróbuj ponownie.');
    // SPEC-007 AC-17: dyżurny zniknął z listy w trakcie wpisu.
    expect(saveErrorKey({ message: 'range_officer_inactive' })).toBe('rangeSign.errorOfficerInactive');
    expect(isAlreadyUploaded({ statusCode: '409', message: 'Duplicate' })).toBe(true);
    expect(isAlreadyUploaded({ message: 'The resource already exists' })).toBe(true);
    expect(isAlreadyUploaded({ message: 'Failed to fetch' })).toBe(false);
  });

  it('AC-17: potwierdzenie wpisu', () => {
    expect(t('rangeSign.done', { name: 'Jan Kowalski', time: '10:32' })).toBe('Wpisano do książki: Jan Kowalski, 10:32.');
  });

  it('AC-18: osoba bez konta — imię i nazwisko oraz decyzja z organem albo adres', () => {
    const all = ['full_name', 'permit_or_address'];
    expect(validateCompletion(all, { full_name: 'Jan Gość' }).complete).toBe(false);
    expect(validateCompletion(all, { full_name: 'Jan Gość', permit_number: 'AB 1' }).errors.permit_authority).toBe('permitPair');
    const ok = validateCompletion(all, { full_name: ' Jan Gość ', address: 'ul. Stalowa 1, Katowice' });
    expect(ok.complete).toBe(true);
    expect(ok.values).toEqual({ full_name: 'Jan Gość', permit_number: null, permit_authority: null, address: 'ul. Stalowa 1, Katowice' });
    expect(t('rangeSign.noticePlaceholder')).toBe('[TEKST DO UZUPEŁNIENIA]');
  });
});
