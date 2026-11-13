import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match) throw new Error(`Brak tokenu --${name}`);
  return match[1];
}

/** Kontrast wg WCAG 2.x */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokeny (SPEC-001 §6.1)', () => {
  it('AC-1: paleta jaśniejszej stali z tabeli §6.1', () => {
    expect({
      bg: token('color-bg'),
      surface: token('color-surface'),
      surfaceAlt: token('color-surface-alt'),
      border: token('color-border'),
      text: token('color-text'),
      textMuted: token('color-text-muted'),
      accent: token('color-accent'),
      accentHover: token('color-accent-hover'),
      dark: token('color-dark'),
      highlight: token('color-highlight'),
    }).toEqual({
      bg: '#f3f5f7',
      surface: '#ffffff',
      surfaceAlt: '#e8ecf0',
      border: '#cdd4db',
      text: '#1b2026',
      textMuted: '#4e5864',
      accent: '#3e5568',
      accentHover: '#2c3f4f',
      dark: '#252d34',
      highlight: '#a57a2c',
    });
  });

  it.each([
    ['color-text', 'color-bg'],
    ['color-text', 'color-surface'],
    ['color-text', 'color-surface-alt'],
    ['color-text-muted', 'color-bg'],
    ['color-text-muted', 'color-surface'],
    ['color-text-muted', 'color-surface-alt'],
    ['color-accent', 'color-bg'],
    ['color-accent', 'color-surface'],
    ['color-accent', 'color-surface-alt'],
    ['color-accent-hover', 'color-surface-alt'],
    ['color-on-dark', 'color-dark'],
  ])('AC-2: kontrast %s na %s ≥ 4.5 (WCAG AA)', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
