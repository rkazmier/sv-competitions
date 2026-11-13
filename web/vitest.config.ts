/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// `getViteConfig` — testy komponentów .astro przez Container API (renderowanie do HTML bez przeglądarki).
export default getViteConfig({
  test: { include: ['src/**/*.test.ts'] },
});
