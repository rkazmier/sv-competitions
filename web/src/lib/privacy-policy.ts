/**
 * Polityka prywatności (SPEC-011): treść w i18n (`privacyPolicy.sections`) w tym samym podzbiorze Markdown
 * co regulamin sprzedaży (`salesTermsBlocks`) oraz linki `[tekst](adres)` — tylko `https:` i `mailto:`.
 * Tekst jest w repo; komponent renderuje linki jako `<a>`, bez `set:html`.
 */
import { salesTermsBlocks, type Block } from './sales-terms';

export type { Block, ListItem, Span } from './sales-terms';

/** Fragment tekstu: zwykły tekst albo link. */
export interface TextPart {
  text: string;
  href?: string;
  /** Link zewnętrzny (`https:`) — otwierany w nowej karcie (AC-2). */
  external?: boolean;
}

const LINK = /\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g;

/** Dzieli tekst na zwykłe fragmenty i linki `[tekst](adres)`. */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const href = match[2];
    parts.push({ text: match[1], href, external: href.startsWith('https://') });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Bloki polityki: nagłówki punktów (`h2`), akapity i listy. */
export function privacyPolicyBlocks(text: string): Block[] {
  return salesTermsBlocks(text);
}
