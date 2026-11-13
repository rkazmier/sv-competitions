import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CalendarEntry } from '../lib/calendar';
import { toCompetitionView, type CompetitionRow } from '../lib/competition-page';
import CalendarCard from './CalendarCard.astro';
import CompetitionDetails from './CompetitionDetails.astro';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const competition: CalendarEntry = {
  kind: 'competition',
  id: 'c1',
  name: 'Puchar <Stali>',
  startsOn: '2027-06-14',
  endsOn: '2027-06-15',
  status: 'published',
  label: 'Dyscyplina X',
  slug: '2027-06-14-puchar-stali',
};

const event: CalendarEntry = {
  kind: 'event',
  id: 'e1',
  name: 'Dzień otwarty',
  startsOn: '2027-06-14',
  endsOn: null,
  status: 'published',
  label: 'Kategoria Y',
  description: 'Pierwszy <script>alert(1)</script>\n\nDrugi',
  externalUrl: 'https://example.com/a?b=1&c=2',
};

describe('karta zawodów w kalendarzu', () => {
  it('AC-42: etykieta „Zawody Steel Valley”, termin, nazwa, dyscyplina, link do /zawody/<slug>/', async () => {
    const html = await container.renderToString(CalendarCard, { props: { entry: competition } });
    expect(html).toContain('Zawody Steel Valley');
    expect(html).toContain('14–15 czerwca 2027');
    expect(html).toContain('Puchar &lt;Stali&gt;');
    expect(html).toContain('Dyscyplina X');
    expect(html).toMatch(/href="\/zawody\/2027-06-14-puchar-stali\/"[^>]*>\s*Szczegóły zawodów/);
  });

  it('AC-44: zawody wyróżnione klasą z akcentem, rodzaj wpisu jako tekst', async () => {
    const html = await container.renderToString(CalendarCard, { props: { entry: competition } });
    expect(html).toMatch(/class="[^"]*entry-card--competition/);
    expect(html).toMatch(/<p class="entry-kind"[^>]*>Zawody Steel Valley<\/p>/);
  });
});

describe('karta wydarzenia w kalendarzu', () => {
  it('AC-43: kategoria jako etykieta, termin, nazwa, opis w akapitach bez HTML', async () => {
    const html = await container.renderToString(CalendarCard, { props: { entry: event } });
    expect(html).toMatch(/<p class="entry-kind"[^>]*>Kategoria Y<\/p>/);
    expect(html).toContain('14 czerwca 2027');
    expect(html).toContain('Dzień otwarty');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Pierwszy &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html.match(/class="entry-description"/g)).toHaveLength(2);
  });

  it('AC-43: „Szczegóły u organizatora” w nowej karcie z informacją dla czytników ekranu', async () => {
    const html = await container.renderToString(CalendarCard, { props: { entry: event } });
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Szczegóły u organizatora');
    expect(html).toContain('(otwiera się w nowej karcie)');
    expect(html).not.toContain('/zawody/');
  });
});

const row: CompetitionRow = {
  id: 'c1',
  slug: '2027-06-14-puchar',
  name: 'Puchar',
  starts_on: '2027-06-14',
  ends_on: '2027-06-15',
  description: 'Akapit <img src=x onerror=alert(1)>\n\nDrugi akapit',
  matchbook_path: 'matchbooks/c1/m.pdf',
  status: 'published',
  discipline: { name: 'Dyscyplina X' },
  rulebook: { file_path: 'rulebooks/r.pdf' },
  schedule_items: [
    { id: 's3', day: '2027-06-15', time: '08:00:00', description: 'Start dnia 2', position: 3 },
    { id: 's1', day: '2027-06-14', time: '09:00:00', description: 'Odprawa', position: 1 },
    { id: 's2', day: '2027-06-14', time: null, description: 'Rejestracja', position: 2 },
  ],
};
const publicUrl = (path: string) => `https://cdn.test/${path}`;

describe('strona zawodów', () => {
  it('AC-38: nazwa, termin, dyscyplina, opis w akapitach (escapowany), regulamin i matchbook', async () => {
    const html = await container.renderToString(CompetitionDetails, { props: { view: toCompetitionView(row, publicUrl) } });
    expect(html).toMatch(/<h1[^>]*>Puchar<\/h1>/);
    expect(html).toContain('14–15 czerwca 2027');
    expect(html).toContain('Dyscyplina X');
    expect(html).not.toContain('<img');
    expect(html).toContain('Akapit &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toMatch(/href="https:\/\/cdn.test\/rulebooks\/r.pdf"[^>]*>Regulamin \(PDF\)/);
    expect(html).toMatch(/href="https:\/\/cdn.test\/matchbooks\/c1\/m.pdf"[^>]*>Matchbook \(PDF\)/);
  });

  it('AC-38: harmonogram pogrupowany po dniach, w dniu punkty bez godziny na początku', async () => {
    const html = await container.renderToString(CompetitionDetails, { props: { view: toCompetitionView(row, publicUrl) } });
    const visible = html.replace(/<template[\s\S]*?<\/template>/, '').split('id="schedule-heading"')[1];
    const order = ['14 czerwca 2027', 'Rejestracja', '09:00', 'Odprawa', '15 czerwca 2027', '08:00', 'Start dnia 2'];
    const positions = order.map((text) => visible.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(visible.match(/<table/g)).toHaveLength(2);
  });

  it('AC-39: bez matchbooka i harmonogramu — „Matchbook wkrótce”, „Harmonogram wkrótce”', async () => {
    const view = toCompetitionView({ ...row, matchbook_path: null, schedule_items: [] }, publicUrl);
    const html = await container.renderToString(CompetitionDetails, { props: { view } });
    expect(html).toMatch(/<a[^>]*data-matchbook[^>]*hidden/);
    expect(html).toMatch(/<p[^>]*data-matchbook-soon(?![^>]*hidden)[^>]*>Matchbook wkrótce/);
    expect(html).toMatch(/<p[^>]*data-schedule-soon(?![^>]*hidden)[^>]*>Harmonogram wkrótce/);
  });
});
