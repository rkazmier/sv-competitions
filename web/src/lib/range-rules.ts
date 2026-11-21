/** Rozdział regulaminu strzelnicy: tytuł (pusty dla wstępu) i punkty. */
export interface RulesChapter {
  title: string;
  points: string[];
}

/**
 * Dzieli tekst regulaminu strzelnicy (`rangeSign.rulesBody`, #39) na rozdziały.
 * Bloki rozdziela pusta linia; blok zaczynający się od „## ” otwiera nowy rozdział.
 * Podpunkty zostają w punkcie jako osobne linie (wyświetlane z `white-space: pre-line`).
 */
export function rulesChapters(text: string): RulesChapter[] {
  const chapters: RulesChapter[] = [];
  let current: RulesChapter = { title: '', points: [] };
  for (const raw of text.split(/\n\s*\n/)) {
    const block = raw.trim();
    if (!block) continue;
    if (block.startsWith('## ')) {
      if (current.title || current.points.length) chapters.push(current);
      current = { title: block.slice(3).trim(), points: [] };
    } else {
      current.points.push(block);
    }
  }
  if (current.title || current.points.length) chapters.push(current);
  return chapters;
}
