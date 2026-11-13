import { defineConfig } from 'astro/config';

// Adres witryny z jednej zmiennej (workflowy deploy ustawiają PUBLIC_SITE_URL).
// Własne domeny (produkcja, staging) → ścieżka bazowa '/'.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  output: 'static',
});
