import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  addDays,
  blockedHref,
  blockedText,
  exceptionText,
  hoursError,
  hoursText,
  isNoteValid,
  normalizeNote,
  upcomingExceptions,
  weekRows,
  weekdayName,
  type HoursException,
} from './opening-hours';

const exception = (day: string, note: string | null = null, opens_at: string | null = null, closes_at: string | null = null): HoursException =>
  ({ day, note, opens_at, closes_at });

describe('godziny otwarcia (SPEC-012 US-7)', () => {
  it('AC-35: tydzień pn–nd, „Otwarte od–do” albo „Zamknięte”; dzień bez wiersza — nieustawiony', () => {
    const rows = weekRows([
      { weekday: 6, opens_at: '09:00:00', closes_at: '15:30:00' },
      { weekday: 1, opens_at: null, closes_at: null },
    ]);
    expect(rows.map((row) => weekdayName(row.weekday))).toEqual([
      'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela',
    ]);
    expect(hoursText(rows[5].hours!)).toBe('09:00–15:30');
    expect(hoursText(rows[0].hours!)).toBe('Zamknięte');
    expect(rows[1].hours).toBeNull();
  });

  it('AC-39: „Do” musi być późniejsza niż „Od”; otwarte wymaga obu godzin; „Zamknięte” bez godzin', () => {
    expect(t(hoursError(true, '10:00', '10:00')!)).toBe('Godzina zamknięcia musi być późniejsza niż otwarcia.');
    expect(hoursError(true, '18:00', '10:00')).toBe('openingHours.closeAfterOpen');
    expect(hoursError(true, '10:00', '')).toBe('openingHours.timesRequired');
    expect(hoursError(true, '10:00', '18:00')).toBeNull();
    expect(hoursError(false, '', '')).toBeNull();
  });

  it('AC-36: opis wyjątku do 100 znaków, pusty → brak opisu', () => {
    expect(isNoteValid('x'.repeat(100))).toBe(true);
    expect(isNoteValid('x'.repeat(101))).toBe(false);
    expect(normalizeNote('  Wigilia ')).toBe('Wigilia');
    expect(normalizeNote('   ')).toBeNull();
  });

  it('AC-36, AC-37: wyjątki od dziś na najbliższe 30 dni, rosnąco, z opisem', () => {
    const today = '2026-12-20';
    const list = upcomingExceptions(
      [exception('2027-01-19'), exception('2026-12-24', 'Wigilia'), exception('2026-12-19'), exception('2027-01-18', null, '12:00:00', '16:00:00')],
      today,
    );
    expect(list.map((e) => e.day)).toEqual(['2026-12-24', '2027-01-18']);
    expect(exceptionText(list[0])).toBe('24 grudnia 2026 (Wigilia): Zamknięte');
    expect(exceptionText(list[1])).toBe('18 stycznia 2027: 12:00–16:00');
    expect(addDays(today, 29)).toBe('2027-01-18');
  });

  it('AC-37: dni blokady — nazwa, data, link do miesiąca w kalendarzu', () => {
    const entry = { kind: 'competition' as const, id: 'c1', name: 'Puchar SV', starts_on: '2027-01-02', ends_on: '2027-01-03' };
    expect(blockedText(entry)).toBe('Puchar SV — 2–3 stycznia 2027');
    expect(blockedHref(entry, '2026-12-20')).toBe('/#miesiac-2027-01');
    expect(blockedHref({ ...entry, starts_on: '2026-11-28', ends_on: '2026-12-21' }, '2026-12-20')).toBe('/#miesiac-2026-12');
  });

  it('AC-38: teksty stopki i braku godzin', () => {
    expect(t('openingHours.link')).toBe('Godziny otwarcia');
    expect(t('openingHours.soon')).toBe('Godziny otwarcia wkrótce.');
  });
});
