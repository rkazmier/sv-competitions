import { describe, expect, it } from 'vitest';
import { isUniqueViolation, nameKey, sortItems, validateName, type DictionaryItem } from './dictionary';

const items: DictionaryItem[] = [
  { id: '1', name: 'Long Range', is_active: true },
  { id: '2', name: 'Szkolenie', is_active: true },
];

describe('lista słownikowa — walidacja nazwy', () => {
  it('AC-8: nowa nazwa jest poprawna', () => {
    expect(validateName('IPSC', items)).toBeNull();
  });

  it('AC-9: „long range ” (inna wielkość liter, spacje) to duplikat „Long Range”', () => {
    expect(validateName('long range ', items)).toBe('duplicate');
    expect(validateName('  LONG RANGE', items)).toBe('duplicate');
  });

  it('AC-46: „szkolenie ” to duplikat „Szkolenie”', () => {
    expect(validateName('szkolenie ', items)).toBe('duplicate');
  });

  it('AC-10: zmiana wielkości liter własnej nazwy nie jest duplikatem', () => {
    expect(validateName('LONG range', items, '1')).toBeNull();
    expect(validateName('Szkolenie', items, '1')).toBe('duplicate');
  });

  it('AC-8: pusta nazwa i nazwa ponad 80 znaków są odrzucane', () => {
    expect(validateName('   ', items)).toBe('required');
    expect(validateName('x'.repeat(80), items)).toBeNull();
    expect(validateName(` ${'ż'.repeat(81)} `, items)).toBe('tooLong');
  });

  it('AC-9: klucz porównania jak indeks w bazie (lower(trim))', () => {
    expect(nameKey('  Łódź ')).toBe('łódź');
  });

  it('AC-9: błąd 23505 z bazy to duplikat', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('AC-11: ukryte na końcu listy, w grupie alfabetycznie', () => {
    const sorted = sortItems([
      { id: 'a', name: 'Zielone', is_active: false },
      { id: 'b', name: 'Żelazo', is_active: true },
      { id: 'c', name: 'Action Air', is_active: true },
      { id: 'd', name: 'Biathlon', is_active: false },
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['Action Air', 'Żelazo', 'Biathlon', 'Zielone']);
  });
});
