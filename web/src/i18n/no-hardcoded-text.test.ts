import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AC-3: w szablonach .astro nie ma tekstów wpisanych na sztywno — teksty widoczne dla
 * użytkownika (treść elementów i atrybuty dostępności) pochodzą z `t()`.
 */
const srcDir = fileURLToPath(new URL('..', import.meta.url));
const TEXT_ATTRS = /\s(?:aria-label|aria-description|title|alt|placeholder)="([^"]*)"/g;
const LETTER = /\p{L}/u;

function astroFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return astroFiles(path);
    return entry.name.endsWith('.astro') ? [path] : [];
  });
}

function hardcodedTexts(source: string): string[] {
  const template = source
    .replace(/^---[\s\S]*?\n---/, '') // frontmatter
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Usuwamy wyrażenia {…} (także zagnieżdżone), zostawiając sam szablon
  let markup = '';
  let depth = 0;
  for (const char of template) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (depth === 0) markup += char;
  }
  const found = [...markup.matchAll(TEXT_ATTRS)].map((m) => m[1]).filter((v) => LETTER.test(v));
  const text = markup.replace(/<[^>]*>/g, '\n');
  return [...found, ...text.split('\n').map((s) => s.trim()).filter((s) => LETTER.test(s))];
}

describe('i18n', () => {
  it('AC-3: wykrywa tekst wpisany na sztywno', () => {
    expect(hardcodedTexts('---\nconst a = 1;\n---\n<p>Zawody</p><a aria-label="Menu">{t("x")}</a>')).toEqual([
      'Menu',
      'Zawody',
    ]);
  });

  it.each(astroFiles(srcDir).map((file) => [relative(srcDir, file), file]))(
    'AC-3: %s nie zawiera tekstów poza plikiem i18n',
    (_name, file) => {
      expect(hardcodedTexts(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );
});
