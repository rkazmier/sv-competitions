import { describe, expect, it } from 'vitest';
import { formatDate, formatDateRange, formatMonthHeading } from './dates';

describe('formatDate', () => {
  it('formatuje dzień: 14 czerwca 2027', () => {
    expect(formatDate('2027-06-14')).toBe('14 czerwca 2027');
  });

  it('odrzuca nieprawidłową datę', () => {
    expect(() => formatDate('2027-02-30')).toThrow(RangeError);
    expect(() => formatDate('14.06.2027')).toThrow(RangeError);
  });
});

describe('formatDateRange', () => {
  it('jeden dzień: 14 czerwca 2027', () => {
    expect(formatDateRange('2027-06-14')).toBe('14 czerwca 2027');
    expect(formatDateRange('2027-06-14', null)).toBe('14 czerwca 2027');
    expect(formatDateRange('2027-06-14', '2027-06-14')).toBe('14 czerwca 2027');
  });

  it('ten sam miesiąc: 14–15 czerwca 2027', () => {
    expect(formatDateRange('2027-06-14', '2027-06-15')).toBe('14–15 czerwca 2027');
  });

  it('różne miesiące: 30 czerwca – 1 lipca 2027', () => {
    expect(formatDateRange('2027-06-30', '2027-07-01')).toBe('30 czerwca – 1 lipca 2027');
  });

  it('różne lata: 30 grudnia 2027 – 2 stycznia 2028', () => {
    expect(formatDateRange('2027-12-30', '2028-01-02')).toBe('30 grudnia 2027 – 2 stycznia 2028');
  });

  it('odrzuca koniec przed początkiem', () => {
    expect(() => formatDateRange('2027-06-15', '2027-06-14')).toThrow(RangeError);
  });
});

describe('formatMonthHeading', () => {
  it('nagłówek miesiąca: Czerwiec 2027', () => {
    expect(formatMonthHeading('2027-06-14')).toBe('Czerwiec 2027');
  });
});
