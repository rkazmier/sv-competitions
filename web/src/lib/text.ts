/**
 * Zwykły tekst z bazy (opisy zawodów i wydarzeń, SPEC-001 §5): bez HTML, puste linie = akapity.
 * Funkcje zwracają tekst — escapowanie robi szablon Astro (`{…}`) albo `textContent` w przeglądarce.
 */

/** Akapity: rozdzielone co najmniej jedną pustą linią; pojedyncze złamania linii zostają w akapicie. */
export function toParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** §7: link zewnętrzny tylko `http(s)://` (jak `check` w bazie) — inne schematy, np. `javascript:`, odrzucamy. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Początek tekstu do `meta description` (AC-41): jedna linia, maks. `max` znaków, cięcie na granicy słowa. */
export function excerpt(text: string | null | undefined, max = 160): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}
