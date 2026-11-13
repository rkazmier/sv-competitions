import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi } from 'vitest';
import type { PublicData } from '../lib/public-data';

// Test strony `/` leży poza src/pages — pliki .ts w pages Astro traktuje jak endpointy.
const data: PublicData = { competitions: [], events: [], publicUrl: (path) => path };
vi.mock('../lib/public-data', () => ({ loadPublicData: async () => data }));

const { default: IndexPage } = await import('../pages/index.astro');

describe('kalendarz /', () => {
  it('AC-36: brak nadchodzących wpisów — „Brak zaplanowanych wydarzeń. Zajrzyj wkrótce.”', async () => {
    data.events = [
      {
        id: 'e1',
        name: 'Minione',
        starts_on: '2000-01-01',
        ends_on: null,
        description: null,
        external_url: 'https://example.com',
        status: 'published',
        category: { name: 'K' },
      },
    ];
    const container = await AstroContainer.create();
    const html = await container.renderToString(IndexPage);
    expect(html).toContain('Brak zaplanowanych wydarzeń. Zajrzyj wkrótce.');
    expect(html).not.toContain('Minione');
    expect(html).not.toContain('entry-card');
  });
});
