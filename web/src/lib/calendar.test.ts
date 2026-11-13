import { describe, expect, it } from 'vitest';
import { sortEntries, type CalendarEntry } from './calendar';

const entry = (kind: CalendarEntry['kind'], name: string, startsOn: string): CalendarEntry => ({
  kind,
  id: `${kind}-${name}`,
  name,
  startsOn,
  endsOn: null,
  status: 'draft',
  label: '',
});

describe('kolejność wpisów kalendarza', () => {
  it('AC-6: od najbliższych, w tym samym dniu zawody przed wydarzeniami, potem wg nazwy', () => {
    const sorted = sortEntries([
      entry('event', 'Szkolenie', '2027-06-14'),
      entry('competition', 'Zawody B', '2027-06-14'),
      entry('event', 'Dzień otwarty', '2027-05-01'),
      entry('competition', 'Ąkademia', '2027-06-14'),
      entry('event', 'Turniej', '2027-06-14'),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(['Dzień otwarty', 'Ąkademia', 'Zawody B', 'Szkolenie', 'Turniej']);
  });
});
