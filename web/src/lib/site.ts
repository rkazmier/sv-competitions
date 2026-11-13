/**
 * Adres produkcyjny serwisu (CLAUDE.md). `link rel=canonical` i Open Graph zawsze wskazują produkcję (SPEC-001 AC-41),
 * także na stagingu — kopia stagingowa nie konkuruje z produkcją w wyszukiwarkach.
 */
export const PRODUCTION_URL = 'https://competitions.steel-valley.pl';

/** Domyślny obraz podglądu linku (1200 × 630, `public/`). */
export const DEFAULT_OG_IMAGE = '/og-default.png';

export const productionUrl = (path: string): string => new URL(path, PRODUCTION_URL).href;
