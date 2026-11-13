import { describe, expect, it } from 'vitest';
import { isUpcoming, sortEntries, todayInWarsaw, upcomingByMonth, type CalendarEntry } from './calendar';

const entry = (kind: CalendarEntry['kind'], name: string, startsOn: string, endsOn: string | null = null): CalendarEntry => ({
  kind,
  id: `${kind}-${name}`,
  name,
  startsOn,
  endsOn,
  status: 'published',
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

describe('„dziś” w Europe/Warsaw (chwila budowania)', () => {
  it('AC-35: po północy w Polsce, gdy w UTC jest jeszcze poprzedni dzień (czas letni)', () => {
    expect(todayInWarsaw(new Date('2027-06-13T22:30:00Z'))).toBe('2027-06-14');
    expect(todayInWarsaw(new Date('2027-06-13T21:59:00Z'))).toBe('2027-06-13');
  });

  it('AC-35: zimą przesunięcie +1 h', () => {
    expect(todayInWarsaw(new Date('2027-01-31T23:00:00Z'))).toBe('2027-02-01');
    expect(todayInWarsaw(new Date('2027-01-31T22:59:00Z'))).toBe('2027-01-31');
  });

  it('AC-35: wpis nadchodzący, gdy koniec (lub początek bez końca) jest dziś lub później', () => {
    const today = '2027-06-14';
    expect(isUpcoming(entry('event', 'Dziś', '2027-06-14'), today)).toBe(true);
    expect(isUpcoming(entry('event', 'Wczoraj', '2027-06-13'), today)).toBe(false);
    expect(isUpcoming(entry('event', 'Trwa', '2027-06-10', '2027-06-14'), today)).toBe(true);
    expect(isUpcoming(entry('event', 'Skończone', '2027-06-10', '2027-06-13'), today)).toBe(false);
  });
});

describe('grupowanie kalendarza po miesiącach', () => {
  const today = '2027-06-14';

  it('AC-35: miesiące rosnąco z nagłówkami, minione wpisy pominięte, w miesiącu od najbliższych', () => {
    const months = upcomingByMonth(
      [
        entry('event', 'Lipcowe', '2027-07-02'),
        entry('competition', 'Puchar', '2027-06-20', '2027-06-21'),
        entry('event', 'Minione', '2027-06-01'),
        entry('event', 'Dzisiejsze', '2027-06-14'),
        entry('event', 'Styczeń', '2028-01-05'),
      ],
      today,
    );
    expect(months.map((m) => [m.key, m.heading, m.entries.map((e) => e.name)])).toEqual([
      ['2027-06', 'Czerwiec 2027', ['Dzisiejsze', 'Puchar']],
      ['2027-07', 'Lipiec 2027', ['Lipcowe']],
      ['2028-01', 'Styczeń 2028', ['Styczeń']],
    ]);
  });

  it('AC-35: wpis wielodniowy w miesiącu daty początku, także gdy kończy się w następnym', () => {
    const months = upcomingByMonth([entry('competition', 'Przełom', '2027-06-30', '2027-07-01')], today);
    expect(months.map((m) => m.key)).toEqual(['2027-06']);
  });

  it('AC-35: wpis, który zaczął się w poprzednim miesiącu i trwa, jest w bieżącym — na początku', () => {
    const months = upcomingByMonth(
      [entry('event', 'Dzisiejsze', '2027-06-14'), entry('event', 'Trwające', '2027-05-28', '2027-06-16')],
      today,
    );
    expect(months).toHaveLength(1);
    expect(months[0].key).toBe('2027-06');
    expect(months[0].entries.map((e) => e.name)).toEqual(['Trwające', 'Dzisiejsze']);
  });

  it('AC-35: w tym samym dniu najpierw zawody, potem wydarzenia, w obu grupach wg nazwy', () => {
    const [june] = upcomingByMonth(
      [
        entry('event', 'Bieg', '2027-06-20'),
        entry('competition', 'Zawody Z', '2027-06-20'),
        entry('event', 'Akademia', '2027-06-20'),
        entry('competition', 'Zawody A', '2027-06-20'),
      ],
      today,
    );
    expect(june.entries.map((e) => e.name)).toEqual(['Zawody A', 'Zawody Z', 'Akademia', 'Bieg']);
  });

  it('AC-36: brak nadchodzących wpisów — pusta lista miesięcy', () => {
    expect(upcomingByMonth([entry('event', 'Minione', '2027-06-01')], today)).toEqual([]);
  });
});
