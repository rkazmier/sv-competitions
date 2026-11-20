import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { dutyErrorKey, dutyFromRows, dutyLost, isForbidden, dutySourceNote, officerSearchQuery, orderChoices, sortOfficers, type RangeDuty } from './range-duty';

const duty = (patch: Partial<RangeDuty> = {}): RangeDuty => ({
  range_officer_id: 'o1',
  full_name: 'Anna Nowak',
  source: 'book',
  event_name: null,
  ...patch,
});

describe('dyżurny Prowadzący (SPEC-007 US-4)', () => {
  it('AC-15: brak wiersza z bazy — brak dyżurnego (pytanie „Kto prowadzi dziś strzelanie?”)', () => {
    expect(dutyFromRows([])).toBeNull();
    expect(dutyFromRows(null)).toBeNull();
    expect(dutyFromRows([duty()])).toEqual(duty());
    expect(t('rangeLog.shiftQuestion')).toBe('Kto prowadzi dziś strzelanie?');
  });

  it('AC-16: dopisek źródła — „(z grafiku)”, „(<nazwa>)”; zmiana w książce bez dopisku', () => {
    expect(dutySourceNote(duty())).toBeNull();
    const schedule = dutySourceNote(duty({ source: 'schedule' }))!;
    expect(t(schedule.key, schedule.params)).toBe('(z grafiku)');
    const event = dutySourceNote(duty({ source: 'event', event_name: 'Puchar Stali' }))!;
    expect(t(event.key, event.params)).toBe('(Puchar Stali)');
    expect(t('rangeLog.officerLabel')).toBe('Dyżurny:');
  });

  it('AC-17: prowadzący spoza listy przy zapisie — komunikat i ponowny wybór', () => {
    expect(t(dutyErrorKey({ message: 'range_officer_inactive' }))).toBe('Ten prowadzący nie jest już dostępny — wybierz innego.');
    expect(t(dutyErrorKey({ message: 'network' }))).toBe('Nie udało się zapisać. Spróbuj ponownie.');
  });

  it('AC-19: wyszukiwarka od 3 znaków po przycięciu; bez wyników — „Nie znaleziono prowadzącego.”', () => {
    expect(officerSearchQuery('  An ')).toBeNull();
    expect(officerSearchQuery(' Now ')).toBe('Now');
    expect(t('rangeLog.searchEmpty')).toBe('Nie znaleziono prowadzącego.');
    expect(t('rangeLog.searchLabel')).toBe('Szukaj prowadzącego');
  });

  it('AC-15: lista wyboru alfabetycznie po imieniu i nazwisku (polskie znaki)', () => {
    const sorted = sortOfficers([
      { id: '3', full_name: 'Żaneta Z' },
      { id: '1', full_name: 'Łukasz Ł' },
      { id: '2', full_name: 'Lena L' },
    ]);
    expect(sorted.map((officer) => officer.full_name)).toEqual(['Lena L', 'Łukasz Ł', 'Żaneta Z']);
  });

  it('AC-18, AC-21: osoba wpisywana pierwsza z dopiskiem, potem reszta alfabetycznie', () => {
    const ordered = orderChoices([
      { id: '1', full_name: 'Żaneta Z', is_person: false },
      { id: '2', full_name: 'Łukasz Ł', is_person: false },
      { id: '3', full_name: 'Zenon Wpisywany', is_person: true },
      { id: '4', full_name: 'Lena L', is_person: false },
    ]);
    expect(ordered.map((officer) => officer.id)).toEqual(['3', '4', '2', '1']);
    expect(t('rangeLog.officerIsPerson', { name: 'Zenon Wpisywany' })).toBe('Zenon Wpisywany (osoba wpisywana)');
    expect(orderChoices(null)).toEqual([]);
  });

  it('AC-18: „Prowadzący: …” + „Zmień”; prowadzący spoza listy przy zapisie wpisu — „wybierz innego”', () => {
    expect(t('rangeSign.officerLabel')).toBe('Prowadzący:');
    expect(t('rangeLog.change')).toBe('Zmień');
    expect(t('rangeSign.errorOfficerInactive')).toBe('Ten prowadzący nie jest już dostępny — wybierz innego.');
  });
});

describe('utrata dyżuru przez dyżurnego z konta (SPEC-008 AC-14)', () => {
  const client = (onDuty: boolean | 'error') =>
    ({
      rpc: () => Promise.resolve(onDuty === 'error' ? { data: null, error: new Error('x') } : { data: onDuty, error: null }),
    }) as unknown as SupabaseClient;

  it('AC-14: odmowa bazy (forbidden, 42501) = utrata dyżuru', async () => {
    expect(isForbidden({ code: '42501', message: 'forbidden' })).toBe(true);
    expect(isForbidden({ message: 'forbidden' })).toBe(true);
    expect(isForbidden({ code: 'P0001', message: 'pass_not_valid' })).toBe(false);
    expect(await dutyLost(client(true), { code: '42501' })).toBe(true);
  });

  it('AC-14: inny błąd (np. odrzucony plik podpisu) — decyduje is_range_duty_officer', async () => {
    expect(await dutyLost(client(false), { message: 'upload_failed' })).toBe(true);
    expect(await dutyLost(client(true), { message: 'upload_failed' })).toBe(false);
    expect(await dutyLost(client('error'), { message: 'upload_failed' })).toBe(false);
  });

  it('bez błędu — nic się nie dzieje', async () => {
    expect(await dutyLost(client(false), null)).toBe(false);
  });
});
