/**
 * Regulamin sprzedaży (#154, SPEC-003 12-A): treść w i18n (`salesTerms.body`) jako podzbiór Markdown —
 * ta sama treść daje stronę `/regulamin-sprzedazy/` i PDF wersji (`sales-terms-pdf.ts`, SPEC-012 AC-4).
 *
 * Obsługiwane: `# ` i `## ` (nagłówki), `1. ` (lista numerowana; wcięcie ≥ 2 spacji = podpunkt),
 * `- ` (lista punktowana), akapity, `**pogrubienie**`, `*kursywa*`, `\*` (dosłowna gwiazdka).
 * Bloki rozdziela pusta linia.
 */

/** Fragment tekstu z formatowaniem. */
export interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface ListItem {
  spans: Span[];
  children: ListItem[];
}

export type Block =
  | { kind: 'h1' | 'h2' | 'p'; spans: Span[] }
  | { kind: 'ol' | 'ul'; items: ListItem[] };

/** Dzieli linię na fragmenty pogrubione / pochylone. Niedomknięty znacznik zostaje zwykłym tekstem. */
export function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  let text = '';
  const flush = () => {
    if (text) spans.push({ text, bold, italic });
    text = '';
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '*') {
      text += '*';
      i += 1;
    } else if (line.startsWith('**', i) && (bold || hasClosing(line, i + 2, '**'))) {
      flush();
      bold = !bold;
      i += 1;
    } else if (ch === '*' && (italic || hasClosing(line, i + 1, '*'))) {
      flush();
      italic = !italic;
    } else {
      text += ch;
    }
  }
  flush();
  return spans;
}

/** Czy od pozycji `from` występuje niepoprzedzony `\` znacznik zamykający. */
function hasClosing(line: string, from: number, marker: string): boolean {
  for (let i = from; i < line.length; i += 1) {
    if (line[i] === '\\') i += 1;
    else if (line.startsWith(marker, i) && (marker === '**' || line[i + 1] !== '*')) return true;
    else if (marker === '*' && line.startsWith('**', i)) i += 1;
  }
  return false;
}

const ORDERED = /^(\s*)\d+\.\s+(.*)$/;
const BULLET = /^(\s*)-\s+(.*)$/;

/** Zamienia treść regulaminu na bloki (nagłówki, listy, akapity). */
export function salesTermsBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const lines = raw.split('\n').filter((line) => line.trim());
    if (lines.length === 0) continue;
    const first = lines[0];
    if (first.startsWith('## ')) blocks.push({ kind: 'h2', spans: parseSpans(first.slice(3).trim()) });
    else if (first.startsWith('# ')) blocks.push({ kind: 'h1', spans: parseSpans(first.slice(2).trim()) });
    else if (ORDERED.test(first)) blocks.push({ kind: 'ol', items: listItems(lines, ORDERED) });
    else if (BULLET.test(first)) blocks.push({ kind: 'ul', items: listItems(lines, BULLET) });
    else blocks.push({ kind: 'p', spans: parseSpans(lines.map((line) => line.trim()).join(' ')) });
  }
  return blocks;
}

function listItems(lines: string[], pattern: RegExp): ListItem[] {
  const items: ListItem[] = [];
  for (const line of lines) {
    const match = pattern.exec(line) ?? ORDERED.exec(line);
    if (!match) {
      // kontynuacja punktu w kolejnej linii
      const last = items.at(-1);
      const target = last?.children.at(-1) ?? last;
      if (target) target.spans.push(...parseSpans(` ${line.trim()}`));
      continue;
    }
    const item: ListItem = { spans: parseSpans(match[2]), children: [] };
    const parent = items.at(-1);
    if (match[1].length >= 2 && parent) parent.children.push(item);
    else items.push(item);
  }
  return items;
}

const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];
const EFFECTIVE = /Regulamin obowiązuje od (\d{1,2}) (\p{L}+) (\d{4}) r\./u;

/** Data obowiązywania z treści regulaminu (§ 13): tekst „1 stycznia 2027 r.” i ISO „2027-01-01” (wersja, nazwa PDF). */
export function salesTermsEffectiveFrom(text: string): { label: string; iso: string } {
  const match = EFFECTIVE.exec(text);
  const month = match ? MONTHS.indexOf(match[2]) + 1 : 0;
  if (!match || month === 0) throw new Error('Brak daty obowiązywania w treści regulaminu sprzedaży');
  const [, day, monthName, year] = match;
  return {
    label: `${day} ${monthName} ${year} r.`,
    iso: `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`,
  };
}

/** Ścieżka PDF wersji regulaminu (SPEC-012 §5, AC-4). */
export function salesTermsPdfPath(iso: string): string {
  return `/regulamin-sprzedazy/regulamin-sprzedazy-${iso}.pdf`;
}

/** Adres strony polityki prywatności (SPEC-011). */
export const PRIVACY_POLICY_PATH = '/polityka-prywatnosci/';
const PRIVACY_POLICY_WORDS = /polityk\p{L}* prywatności/iu;

/** Fragment strony regulaminu: tekst z formatowaniem, opcjonalnie link. */
export interface LinkedSpan extends Span {
  href?: string;
}

/**
 * SPEC-011 AC-10: słowa „polityka prywatności” (w odmianie z tekstu) w § 12 ust. 1 jako link do
 * `/polityka-prywatnosci/`. Tylko strona — treść (i PDF wersji) bez zmian. Brak tych słów = błąd buildu,
 * żeby zmiana treści regulaminu nie usunęła linku po cichu.
 */
export function linkPrivacyPolicy(blocks: readonly Block[]): Block[] {
  const missing = () => new Error('Brak słów „polityka prywatności” w § 12 ust. 1 regulaminu sprzedaży');
  const heading = blocks.findIndex((b) => b.kind === 'h2' && spansText(b.spans).startsWith('§ 12.'));
  const list = heading >= 0 ? blocks[heading + 1] : undefined;
  if (list?.kind !== 'ol' || list.items.length === 0) throw missing();
  const item = list.items[0];
  const index = item.spans.findIndex((s) => PRIVACY_POLICY_WORDS.test(s.text));
  const span = item.spans[index];
  const match = span ? PRIVACY_POLICY_WORDS.exec(span.text) : null;
  if (!match) throw missing();
  const before = span.text.slice(0, match.index);
  const after = span.text.slice(match.index + match[0].length);
  const linked: LinkedSpan[] = [
    ...(before ? [{ ...span, text: before }] : []),
    { ...span, text: match[0], href: PRIVACY_POLICY_PATH },
    ...(after ? [{ ...span, text: after }] : []),
  ];
  const spans = [...item.spans.slice(0, index), ...linked, ...item.spans.slice(index + 1)];
  const items = [{ ...item, spans }, ...list.items.slice(1)];
  return blocks.map((b, i) => (i === heading + 1 ? { kind: 'ol', items } : b));
}

/** Zwykły tekst fragmentów (np. do porównań w testach). */
export function spansText(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('');
}
