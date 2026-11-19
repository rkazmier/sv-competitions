import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  dayHint,
  dutySourceLabel,
  formatScheduleDay,
  nextDayCount,
  scheduleErrorKey,
  scheduleRows,
  setLabelKey,
  type ScheduleDay,
} from './range-duty-schedule';

const day = (patch: Partial<ScheduleDay> = {}): ScheduleDay => ({
  day: '2026-11-20',
  range_officer_id: null,
  full_name: null,
  source: null,
  event_name: null,
  schedule_range_officer_id: null,
  schedule_full_name: null,
  schedule_on_list: null,
  ...patch,
});
const scheduled = { schedule_range_officer_id: 's1', schedule_full_name: 'Bogdan Grafikowy', schedule_on_list: true };
const text = (message: { key: Parameters<typeof t>[0]; params?: Record<string, string> } | null) =>
  message ? t(message.key, message.params) : null;

describe('grafik dyżurów (SPEC-007 US-6)', () => {
  it('AC-22: 30 dni, „Pokaż kolejne 30 dni” — maks. 90 dni naprzód (91 dni z dziś)', () => {
    expect(nextDayCount(30)).toBe(60);
    expect(nextDayCount(60)).toBe(90);
    expect(nextDayCount(90)).toBe(91);
    expect(nextDayCount(91)).toBe(91);
    expect(t('rangeDutySchedule.showMore')).toBe('Pokaż kolejne 30 dni');
    expect(t('panel.menu.rangeDutySchedule')).toBe('Dyżury');
    expect(scheduleRows(null)).toEqual([]);
  });

  it('AC-22: data z dniem tygodnia', () => {
    expect(formatScheduleDay('2026-11-20')).toBe('piątek, 20 listopada');
    expect(formatScheduleDay('2026-11-23')).toBe('poniedziałek, 23 listopada');
  });

  it('AC-22: źródło — „z grafiku”, nazwa zawodów lub wydarzenia, „zmiana w książce”; bez dyżurnego — brak', () => {
    const schedule = { range_officer_id: 's1', full_name: 'Bogdan Grafikowy' };
    expect(text(dutySourceLabel(day({ ...schedule, source: 'schedule' })))).toBe('z grafiku');
    expect(text(dutySourceLabel(day({ ...schedule, source: 'event', event_name: 'Puchar Stali' })))).toBe('Puchar Stali');
    expect(text(dutySourceLabel(day({ ...schedule, source: 'book' })))).toBe('zmiana w książce');
    expect(dutySourceLabel(day())).toBeNull();
    expect(t('rangeDutySchedule.noDuty')).toBe('Brak dyżurnego');
  });

  it('AC-22: „Ustaw” bez wpisu w grafiku, „Zmień” z wpisem; „Usuń z grafiku”', () => {
    expect(t(setLabelKey(day()))).toBe('Ustaw');
    expect(t(setLabelKey(day(scheduled)))).toBe('Zmień');
    expect(t('rangeDutySchedule.clear')).toBe('Usuń z grafiku');
  });

  it('AC-23: dzień spoza grafiku (invalid_day) i prowadzący spoza listy — komunikaty', () => {
    expect(t(scheduleErrorKey({ message: 'invalid_day' }))).toBe('Grafik obejmuje dni od dziś do 90 dni naprzód. Odśwież stronę.');
    expect(t(scheduleErrorKey({ message: 'range_officer_inactive' }))).toBe('Ten prowadzący nie jest już dostępny — wybierz innego.');
    expect(t(scheduleErrorKey({ message: 'network' }))).toBe('Nie udało się zapisać. Spróbuj ponownie.');
  });

  it('AC-24: wpis w grafiku, a obowiązuje dyżurny zawodów lub wydarzenia — podpowiedź', () => {
    const event = day({ ...scheduled, range_officer_id: 'e1', full_name: 'Ewa Zawodowa', source: 'event', event_name: 'Puchar Stali' });
    expect(text(dayHint(event))).toBe('W tym dniu obowiązuje dyżurny z „Puchar Stali”. Wpis z grafiku zadziała, jeśli tam zostanie usunięty.');
    expect(dayHint(day({ range_officer_id: 'e1', full_name: 'Ewa Zawodowa', source: 'event', event_name: 'Puchar Stali' }))).toBeNull();
    expect(dayHint(day({ ...scheduled, range_officer_id: 's1', full_name: 'Bogdan Grafikowy', source: 'schedule' }))).toBeNull();
  });

  it('AC-25: dziś obowiązuje zmiana z książki — podpowiedź także po zmianie lub usunięciu wpisu grafiku', () => {
    const book = { range_officer_id: 'b1', full_name: 'Adam Książkowy', source: 'book' as const };
    expect(text(dayHint(day({ ...book, ...scheduled })))).toBe('Dziś obowiązuje zmiana z książki: Adam Książkowy.');
    expect(text(dayHint(day(book)))).toBe('Dziś obowiązuje zmiana z książki: Adam Książkowy.');
  });

  it('AC-17: prowadzący z grafiku nie jest już na liście — podpowiedź „wybierz innego”', () => {
    expect(text(dayHint(day({ ...scheduled, schedule_on_list: false })))).toBe(
      'W grafiku: Bogdan Grafikowy — ten prowadzący nie jest już dostępny. Wybierz innego.',
    );
  });
});
