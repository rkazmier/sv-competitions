import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  csvDateTime,
  defaultFilters,
  entryCells,
  exportFileName,
  fetchSignatures,
  filterArgs,
  hasDateRange,
  rangeLabel,
  rangeLogCsv,
  wrapText,
  type ReviewEntry,
} from './range-review';

const OFFICER = '00000000-0000-0000-0000-0000000000d1';

const entries: ReviewEntry[] = [
  {
    id: 'e1',
    entered_at: '2026-03-10T22:30:00Z',
    full_name: 'Jan Kowalski',
    permit_number: 'AB/123',
    permit_authority: 'KWP Katowice',
    address: null,
    range_officer_name: 'Piotr Prowadzący',
    signature_path: '2026/03/e1.png',
    annotations: [{ body: 'Literówka; "numer"', created_at: '2026-03-11T09:00:00Z', author: 'Anna Admin' }],
  },
  {
    id: 'e2',
    entered_at: '2026-07-01T08:05:00Z',
    full_name: '=Ewa Nowak',
    permit_number: null,
    permit_authority: null,
    address: 'ul. Polna 1, Gliwice',
    range_officer_name: 'Ewa Prowadząca',
    signature_path: '2026/07/e2.png',
    annotations: [],
  },
];

describe('przegląd książki (SPEC-005 US-9)', () => {
  it('AC-26: filtry → argumenty admin_range_log, niepoprawne wartości pomijane', () => {
    expect(filterArgs({ from: '2026-03-10', to: '2026-03-12', person: ' kowal ', officer: OFFICER }, 'view')).toEqual({
      p_format: 'view',
      p_from: '2026-03-10',
      p_to: '2026-03-12',
      p_person: 'kowal',
      p_officer_id: OFFICER,
    });
    expect(filterArgs({ from: '10.03.2026', to: '', person: '  ', officer: 'x' }, 'csv')).toEqual({
      p_format: 'csv',
      p_from: null,
      p_to: null,
      p_person: null,
      p_officer_id: null,
    });
    expect(defaultFilters('2026-11-18')).toEqual({ from: '2026-11-18', to: '2026-11-18', person: '', officer: '' });
  });

  it('AC-26: kolumny książki — data i godzina, osoba, decyzja i organ albo adres, prowadzący', () => {
    expect(entryCells(entries[0])).toEqual(['10.03.2026, 23:30', 'Jan Kowalski', 'AB/123, KWP Katowice', 'Piotr Prowadzący']);
    expect(entryCells(entries[1])[2]).toBe('ul. Polna 1, Gliwice');
  });

  it('AC-27: eksport wymaga dnia lub zakresu dat', () => {
    expect(hasDateRange({ from: '2026-03-10', to: '2026-03-10' })).toBe(true);
    expect(hasDateRange({ from: '2026-03-12', to: '2026-03-10' })).toBe(false);
    expect(hasDateRange({ from: '', to: '2026-03-10' })).toBe(false);
    expect(rangeLabel({ from: '2026-03-10', to: '2026-03-10' })).toBe('10.03.2026');
    expect(rangeLabel({ from: '2026-03-10', to: '2026-03-12' })).toBe('10.03.2026 – 12.03.2026');
    expect(exportFileName({ from: '2026-03-10', to: '2026-03-12' }, 'pdf')).toBe('ksiazka-2026-03-10-2026-03-12.pdf');
    expect(exportFileName({ from: '2026-03-10', to: '2026-03-10' }, 'csv')).toBe('ksiazka-2026-03-10.csv');
  });

  it('AC-28: data i godzina w Europe/Warsaw jako RRRR-MM-DD GG:MM (zima i lato)', () => {
    expect(csvDateTime('2026-03-10T22:30:00Z')).toBe('2026-03-10 23:30');
    expect(csvDateTime('2026-07-01T08:05:00Z')).toBe('2026-07-01 10:05');
    expect(csvDateTime('2026-03-10T23:30:00Z')).toBe('2026-03-11 00:30');
  });

  it('AC-28: CSV — BOM, średnik, kolumny z AC-26, podpis „tak”, adnotacje, ochrona przed formułami', () => {
    const csv = rangeLogCsv(entries, t);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '"Data i godzina";"Imię i nazwisko";"Nr decyzji i organ wydający / Adres zamieszkania";"Prowadzący strzelanie";"Podpis";"Adnotacje"',
    );
    expect(lines[1]).toBe(
      '"2026-03-10 23:30";"Jan Kowalski";"AB/123, KWP Katowice";"Piotr Prowadzący";"tak";"Anna Admin, 11.03.2026, 10:00: Literówka; ""numer"""',
    );
    expect(lines[2]).toBe('"2026-07-01 10:05";"\'=Ewa Nowak";"ul. Polna 1, Gliwice";"Ewa Prowadząca";"tak";""');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
  });

  it('AC-27: łamanie tekstu kolumny PDF do szerokości (także zbyt długie słowa)', () => {
    const measure = (text: string) => text.length;
    expect(wrapText('ul. Stalowa 12, Gliwice', 12, measure)).toEqual(['ul. Stalowa', '12, Gliwice']);
    expect(wrapText('ABCDEFGHIJ', 4, measure)).toEqual(['ABCD', 'EFGH', 'IJ']);
    expect(wrapText('', 4, measure)).toEqual(['']);
  });
});

describe('fetchSignatures (SPEC-005 AC-27, linki 60 s)', () => {
  it('podpisuje porcjami tuż przed pobraniem, pobiera równolegle w porcji, bez duplikatów', async () => {
    const log: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await fetchSignatures(
      ['a', 'b', 'c', 'a', 'd', 'e'],
      async (batch) => {
        log.push(`sign:${batch.join(',')}`);
        return new Map(batch.map((path) => [path, `url:${path}`]));
      },
      async (url) => {
        log.push(`get:${url}`);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return url.toUpperCase();
      },
      2,
    );
    expect([...result]).toEqual([
      ['a', 'URL:A'],
      ['b', 'URL:B'],
      ['c', 'URL:C'],
      ['d', 'URL:D'],
      ['e', 'URL:E'],
    ]);
    expect(log).toEqual(['sign:a,b', 'get:url:a', 'get:url:b', 'sign:c,d', 'get:url:c', 'get:url:d', 'sign:e', 'get:url:e']);
    expect(maxInFlight).toBe(2);
  });

  it('brak linku lub błąd pobrania przerywa eksport; pusta lista — bez wywołań', async () => {
    await expect(fetchSignatures(['a'], async () => new Map(), async () => 1)).rejects.toThrow('signature_missing');
    await expect(
      fetchSignatures(['a'], async () => new Map([['a', 'u']]), () => Promise.reject(new Error('HTTP 404'))),
    ).rejects.toThrow('HTTP 404');
    const sign = () => Promise.reject(new Error('unexpected'));
    expect((await fetchSignatures([], sign, async () => 1)).size).toBe(0);
  });
});
