import { describe, expect, it } from 'vitest';
import {
  disciplineOptions,
  formatTime,
  isScheduleRangeError,
  itemsOutOfRange,
  matchbookPath,
  rulebookOptions,
  sortSchedule,
  toRow,
  validateCompetition,
  validateScheduleItem,
  type CompetitionInput,
  type ScheduleItem,
} from './competitions';

const input: CompetitionInput = {
  name: 'Puchar Steel Valley',
  discipline_id: 'd1',
  starts_on: '2027-06-14',
  ends_on: '',
  description: '',
};

describe('zawody — formularz', () => {
  it('AC-17: wystarczą nazwa, dyscyplina i data początku', () => {
    expect(validateCompetition(input)).toEqual({});
    expect(toRow(input, '')).toEqual({
      name: 'Puchar Steel Valley',
      discipline_id: 'd1',
      starts_on: '2027-06-14',
      ends_on: null,
      description: null,
      rulebook_id: null,
    });
  });

  it('AC-17: brak pól wymaganych i za długa nazwa', () => {
    expect(validateCompetition({ ...input, name: '  ', discipline_id: '', starts_on: '' })).toEqual({
      name: 'required',
      discipline_id: 'required',
      starts_on: 'required',
    });
    expect(validateCompetition({ ...input, name: 'a'.repeat(151) }).name).toBe('tooLong');
    expect(validateCompetition({ ...input, description: 'a'.repeat(10001) }).description).toBe('tooLong');
  });

  it('AC-18: data końca wcześniejsza niż data początku', () => {
    expect(validateCompetition({ ...input, ends_on: '2027-06-13' }).ends_on).toBe('endBeforeStart');
    expect(validateCompetition({ ...input, ends_on: '2027-06-14' })).toEqual({});
    expect(validateCompetition({ ...input, ends_on: '2027-06-15' })).toEqual({});
  });
});

describe('zawody — listy wyboru', () => {
  const disciplines = [
    { id: 'b', name: 'Long Range', is_active: true },
    { id: 'h', name: 'Ukryta', is_active: false },
    { id: 'a', name: 'IPSC', is_active: true },
  ];

  it('AC-17: tylko aktywne dyscypliny, alfabetycznie', () => {
    expect(disciplineOptions(disciplines).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('AC-17 §7: ukryta dyscyplina zostaje przy istniejących zawodach', () => {
    expect(disciplineOptions(disciplines, 'h').map((d) => d.id)).toEqual(['a', 'b', 'h']);
  });

  const rulebooks = [
    { id: 'old', title: 'Stary', is_archived: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'arch', title: 'Archiwum', is_archived: true, created_at: '2026-12-01T00:00:00Z' },
    { id: 'new', title: 'Nowy', is_archived: false, created_at: '2026-06-01T00:00:00Z' },
  ];

  it('AC-19: tylko niezarchiwizowane regulaminy, od najnowszych', () => {
    expect(rulebookOptions(rulebooks).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('AC-19: zarchiwizowany regulamin wybrany wcześniej zostaje na liście', () => {
    expect(rulebookOptions(rulebooks, 'arch').map((r) => r.id)).toEqual(['arch', 'new', 'old']);
  });
});

const item = (id: string, day: string, time: string | null, position: number): ScheduleItem => ({
  id,
  day,
  time,
  description: id,
  position,
});

describe('zawody — harmonogram', () => {
  it('AC-21: po dniu i godzinie, bez godziny na początku dnia, remisy w kolejności dodania', () => {
    const sorted = sortSchedule([
      item('d2-0800', '2027-06-15', '08:00:00', 1),
      item('d1-1200', '2027-06-14', '12:00:00', 2),
      item('d1-none-b', '2027-06-14', null, 5),
      item('d1-0800', '2027-06-14', '08:00:00', 4),
      item('d1-none-a', '2027-06-14', null, 3),
      item('d1-0800-late', '2027-06-14', '08:00:00', 6),
    ]);
    expect(sorted.map((i) => i.id)).toEqual([
      'd1-none-a',
      'd1-none-b',
      'd1-0800',
      'd1-0800-late',
      'd1-1200',
      'd2-0800',
    ]);
  });

  it('AC-21: godzina bez sekund', () => {
    expect(formatTime('08:00:00')).toBe('08:00');
    expect(formatTime(null)).toBe('');
  });

  it('AC-21: opis wymagany, maks. 300 znaków', () => {
    const ok = { day: '2027-06-14', description: 'Rejestracja' };
    expect(validateScheduleItem(ok, '2027-06-14', null)).toBeNull();
    expect(validateScheduleItem({ ...ok, description: ' ' }, '2027-06-14', null)).toBe('descriptionRequired');
    expect(validateScheduleItem({ ...ok, description: 'a'.repeat(301) }, '2027-06-14', null)).toBe(
      'descriptionTooLong',
    );
    expect(validateScheduleItem({ ...ok, day: '' }, '2027-06-14', null)).toBe('dayRequired');
  });

  it('AC-22: dzień poza terminem zawodów', () => {
    const point = (day: string) => validateScheduleItem({ day, description: 'x' }, '2027-06-14', '2027-06-15');
    expect(point('2027-06-13')).toBe('dayOutOfRange');
    expect(point('2027-06-14')).toBeNull();
    expect(point('2027-06-15')).toBeNull();
    expect(point('2027-06-16')).toBe('dayOutOfRange');
    expect(validateScheduleItem({ day: '2027-06-15', description: 'x' }, '2027-06-14', null)).toBe('dayOutOfRange');
  });

  it('AC-22: zmiana dat zawodów — punkty, które wypadają poza termin', () => {
    const items = [item('a', '2027-06-14', null, 1), item('b', '2027-06-15', null, 2)];
    expect(itemsOutOfRange(items, '2027-06-14', '2027-06-15')).toEqual([]);
    expect(itemsOutOfRange(items, '2027-06-14', null)).toEqual(['b']);
    expect(itemsOutOfRange(items, '2027-06-15', '')).toEqual(['a']);
  });

  it('AC-22: błąd zakresu z wyzwalacza w bazie', () => {
    expect(isScheduleRangeError({ code: '23514', message: 'schedule_item_day_out_of_range' })).toBe(true);
    expect(isScheduleRangeError({ code: '23514', message: 'competitions_ends_on_check' })).toBe(false);
    expect(isScheduleRangeError(null)).toBe(false);
  });
});

describe('zawody — matchbook', () => {
  it('AC-20: ścieżka matchbooks/<competition_id>/<uuid>.pdf', () => {
    expect(matchbookPath('c1', 'f1')).toBe('matchbooks/c1/f1.pdf');
  });
});
