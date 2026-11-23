import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { formatShortDateRange } from './dates';
import {
  closureDays,
  closureErrorKey,
  closurePeriodError,
  extensionsByPass,
  extensionText,
  isClosureReasonValid,
  sortClosures,
  type RangeClosure,
} from './range-closures';

describe('zamknięcia strzelnicy (SPEC-012 US-6)', () => {
  it('AC-30: liczba dni zamknięcia — obie daty włącznie, także przez zmianę czasu', () => {
    expect(closureDays('2027-02-03', '2027-02-12')).toBe(10);
    expect(closureDays('2027-03-25', '2027-04-01')).toBe(8);
  });

  it('AC-30: „Do” nie później niż dziś, „Od” nie później niż „Do”, obie daty wymagane', () => {
    expect(closurePeriodError('', '2027-02-12', '2027-02-20')).toBe('rangeClosures.datesRequired');
    expect(closurePeriodError('2027-02-12', '2027-02-03', '2027-02-20')).toBe('rangeClosures.rangeInvalid');
    expect(closurePeriodError('2027-02-13', '2027-02-21', '2027-02-20')).toBe('rangeClosures.notEnded');
    expect(closurePeriodError('2027-02-13', '2027-02-20', '2027-02-20')).toBeNull();
  });

  it('AC-31: zamknięcie krótsze niż 8 kolejnych dni — komunikat closure_too_short', () => {
    expect(closurePeriodError('2027-02-03', '2027-02-09', '2027-02-20')).toBe('rangeClosures.tooShort');
    expect(t('rangeClosures.tooShort')).toBe('Przedłużenie przysługuje przy zamknięciu dłuższym niż 7 kolejnych dni.');
  });

  it('AC-31: kody błędów bazy → komunikaty (nakładanie, za krótkie, inne)', () => {
    expect(t(closureErrorKey('closure_overlap'))).toBe('Ten okres nakłada się na zapisane zamknięcie.');
    expect(closureErrorKey('closure_too_short')).toBe('rangeClosures.tooShort');
    expect(closureErrorKey('closure_not_ended')).toBe('rangeClosures.notEnded');
    expect(closureErrorKey('invalid_closure_reason')).toBe('rangeClosures.reasonInvalid');
    expect(closureErrorKey('cokolwiek')).toBe('rangeClosures.error');
    expect(closureErrorKey(null)).toBe('rangeClosures.error');
  });

  it('AC-30: przyczyna 3–200 znaków po przycięciu', () => {
    expect(isClosureReasonValid(' ab ')).toBe(false);
    expect(isClosureReasonValid('Remont')).toBe(true);
    expect(isClosureReasonValid('x'.repeat(200))).toBe(true);
    expect(isClosureReasonValid('x'.repeat(201))).toBe(false);
  });

  it('AC-30: tekst podglądu przed zapisem', () => {
    expect(t('rangeClosures.preview', { days: 10, count: 37 })).toBe(
      'Zamknięcie: 10 dni. Ważność przedłuży się o 10 dni dla 37 uprawnień.',
    );
    expect(t('rangeClosures.confirm')).toBe('Zapisz i przedłuż');
    expect(t('rangeClosures.back')).toBe('Wróć');
    expect(t('panel.menu.rangeClosures')).toBe('Zamknięcia');
  });

  it('AC-33: „Przedłużono o 10 dni (zamknięcie strzelnicy 3–12.02.2027).”', () => {
    expect(extensionText({ days: 10, starts_on: '2027-02-03', ends_on: '2027-02-12' })).toBe(
      'Przedłużono o 10 dni (zamknięcie strzelnicy 3–12.02.2027).',
    );
  });

  it('AC-33: krótki zapis okresu — przez miesiące i lata', () => {
    expect(formatShortDateRange('2027-01-28', '2027-02-06')).toBe('28.01–6.02.2027');
    expect(formatShortDateRange('2026-12-28', '2027-01-06')).toBe('28.12.2026–6.01.2027');
    expect(() => formatShortDateRange('2027-02-06', '2027-01-28')).toThrow(RangeError);
  });

  it('AC-33: przedłużenia pogrupowane według uprawnienia', () => {
    const map = extensionsByPass([
      { user_pass_id: 'a', days: 10, starts_on: '2027-02-03', ends_on: '2027-02-12' },
      { user_pass_id: 'b', days: 8, starts_on: '2027-02-03', ends_on: '2027-02-12' },
      { user_pass_id: 'a', days: 9, starts_on: '2027-05-01', ends_on: '2027-05-09' },
    ]);
    expect(map.get('a')?.map((e) => e.days)).toEqual([10, 9]);
    expect(map.get('b')).toHaveLength(1);
    expect(map.get('c')).toBeUndefined();
  });

  it('AC-34: lista od najnowszych', () => {
    const closure = (id: string, created_at: string): RangeClosure => ({
      id, created_at, starts_on: '2027-02-03', ends_on: '2027-02-12', reason: 'Remont', days: 10, passes_count: 1, author: null,
    });
    expect(sortClosures([closure('old', '2027-02-13T10:00:00Z'), closure('new', '2027-06-01T10:00:00Z')]).map((c) => c.id))
      .toEqual(['new', 'old']);
  });
});
