import { describe, expect, it } from 'vitest';
import {
  SHIFT_STORAGE_KEY,
  clearShiftOfficer,
  currentShiftOfficer,
  currentShiftOfficerId,
  saveShiftOfficer,
  warsawDay,
  type RangeOfficer,
} from './range-shift';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

const officers: RangeOfficer[] = [
  { id: 'o1', full_name: 'Anna Nowak' },
  { id: 'o2', full_name: 'Piotr Prowadzący' },
];

describe('prowadzący na zmianę (SPEC-005 US-2)', () => {
  it('AC-3: dzień liczony w Europe/Warsaw, nie w UTC ani w strefie urządzenia', () => {
    // 22:30 UTC zimą = 23:30 w Warszawie (ten sam dzień); 23:30 UTC = 00:30 następnego dnia.
    expect(warsawDay(new Date('2026-11-18T22:30:00Z'))).toBe('2026-11-18');
    expect(warsawDay(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
    // Czas letni: 22:30 UTC = 00:30 następnego dnia.
    expect(warsawDay(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });

  it('AC-3: bez wyboru na tym urządzeniu — brak prowadzącego (pytanie „Kto prowadzi strzelanie?”)', () => {
    expect(currentShiftOfficer(memoryStorage(), officers)).toBeNull();
  });

  it('AC-3: wybór zapamiętany do końca dnia, następnego dnia trzeba wybrać ponownie', () => {
    const storage = memoryStorage();
    saveShiftOfficer(storage, 'o2', new Date('2026-11-18T06:00:00Z'));
    expect(currentShiftOfficer(storage, officers, new Date('2026-11-18T22:59:00Z'))).toEqual(officers[1]);
    expect(currentShiftOfficer(storage, officers, new Date('2026-11-18T23:01:00Z'))).toBeNull();
    expect(storage.getItem(SHIFT_STORAGE_KEY)).toBeNull();
  });

  it('AC-3: na urządzeniu zapisany tylko identyfikator i dzień (bez imienia i nazwiska)', () => {
    const storage = memoryStorage();
    saveShiftOfficer(storage, 'o1', new Date('2026-11-18T08:00:00Z'));
    expect(JSON.parse(storage.getItem(SHIFT_STORAGE_KEY)!)).toEqual({ id: 'o1', day: '2026-11-18' });
  });

  it('AC-3, §7: prowadzący ukryty w trakcie zmiany — wybór kasowany, trzeba wybrać ponownie', () => {
    const storage = memoryStorage();
    const now = new Date('2026-11-18T08:00:00Z');
    saveShiftOfficer(storage, 'o2', now);
    expect(currentShiftOfficer(storage, [officers[0]], now)).toBeNull();
    expect(currentShiftOfficerId(storage, now)).toBeNull();
  });

  it('AC-3: uszkodzony zapis traktowany jak brak wyboru', () => {
    const storage = memoryStorage();
    storage.setItem(SHIFT_STORAGE_KEY, '{nie-json');
    expect(currentShiftOfficerId(storage)).toBeNull();
    storage.setItem(SHIFT_STORAGE_KEY, JSON.stringify({ id: 1, day: warsawDay() }));
    expect(currentShiftOfficerId(storage)).toBeNull();
    expect(storage.getItem(SHIFT_STORAGE_KEY)).toBeNull();
  });

  it('AC-4: kolejne wpisy dziedziczą tego samego prowadzącego; nazwisko z aktualnej listy', () => {
    const storage = memoryStorage();
    const now = new Date('2026-11-18T08:00:00Z');
    saveShiftOfficer(storage, 'o1', now);
    expect(currentShiftOfficerId(storage, now)).toBe('o1');
    expect(currentShiftOfficerId(storage, new Date('2026-11-18T15:00:00Z'))).toBe('o1');
    const renamed = [{ id: 'o1', full_name: 'Anna Nowak-Kowalska' }];
    expect(currentShiftOfficer(storage, renamed, now)?.full_name).toBe('Anna Nowak-Kowalska');
  });

  it('AC-4: „Zmień” kasuje wybór', () => {
    const storage = memoryStorage();
    saveShiftOfficer(storage, 'o1');
    clearShiftOfficer(storage);
    expect(currentShiftOfficerId(storage)).toBeNull();
  });
});
