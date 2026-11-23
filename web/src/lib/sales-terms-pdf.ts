/**
 * PDF wersji regulaminu sprzedaży (#154, SPEC-012 AC-4, AC-10): A4 pionowo, nagłówek
 * „Regulamin sprzedaży — obowiązuje od …”, treść 1:1 z `salesTerms.body`, numer strony.
 * Plik `public/regulamin-sprzedazy/regulamin-sprzedazy-<RRRR-MM-DD>.pdf` generuje `npm run pdf:sales-terms`.
 * Wynik jest powtarzalny (stałe daty dokumentu) — test sprawdza, że plik w repo odpowiada treści.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { salesTermsBlocks, salesTermsEffectiveFrom, type ListItem, type Span } from './sales-terms';

export const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 10;
const LINE = 14;
const H2_SIZE = 12;
const INDENT = 22;
const TEXT = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);

export interface SalesTermsPdfInput {
  body: string;
  heading: (date: string) => string;
  pageLabel: (page: number, pages: number) => string;
  /** Inter 400 i 600 (OTF, jak w `range-pdf.ts`). Kursywy brak w fontach strony — tekst pochylony rysujemy zwykłym krojem. */
  fonts: { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array };
}

interface Word {
  text: string;
  font: PDFFont;
  /** Spacja przed słowem (fragmenty sklejone bez spacji, np. „**Ważność.**” + „ Uprawnienie”). */
  space: boolean;
}

export async function buildSalesTermsPdf(input: SalesTermsPdfInput): Promise<Uint8Array> {
  const effective = salesTermsEffectiveFrom(input.body);
  const heading = input.heading(effective.label);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fixed = new Date(`${effective.iso}T00:00:00Z`);
  doc.setTitle(heading);
  doc.setLanguage('pl-PL');
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  doc.setProducer('sv-competitions');
  doc.setCreator('sv-competitions');
  // `calt` wyłączone — jak w range-pdf.ts (zamienniki Inter mają w PDF złą szerokość).
  const regular = await doc.embedFont(input.fonts.regular, { subset: false, features: { calt: false } });
  const bold = await doc.embedFont(input.fonts.bold, { subset: false, features: { calt: false } });
  const [width, height] = A4;
  const bottom = MARGIN + 10;
  let page!: PDFPage;
  let y = 0;

  function newPage(): void {
    page = doc.addPage(A4);
    y = height - MARGIN;
  }

  function ensure(space: number): void {
    if (y - space < bottom) newPage();
  }

  /** Słowa z krojem; spacja przed słowem może pochodzić z poprzedniego fragmentu. */
  function words(spans: readonly Span[], forceBold = false): Word[] {
    const result: Word[] = [];
    let space = false;
    for (const span of spans) {
      const font = forceBold || span.bold ? bold : regular;
      for (const part of span.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          space = true;
          continue;
        }
        result.push({ text: part, font, space });
        space = false;
      }
    }
    return result;
  }

  /** Łamie słowa na linie i rysuje je od `x`; `prefix` (numer punktu) stoi w pierwszej linii na lewo od `x`. */
  function paragraph(
    spans: readonly Span[],
    x: number,
    size: number,
    lineHeight: number,
    opts: { prefix?: string; forceBold?: boolean } = {},
  ): void {
    const maxWidth = width - MARGIN - x;
    const spaceWidth = regular.widthOfTextAtSize(' ', size);
    const lines: { word: Word; x: number }[][] = [];
    let line: { word: Word; x: number }[] = [];
    let cursor = 0;
    for (const word of words(spans, opts.forceBold)) {
      const w = word.font.widthOfTextAtSize(word.text, size);
      // linię łamiemy tylko w miejscu spacji (fragment sklejony z poprzednim, np. „**Ważność.**”, zostaje w tej samej linii)
      if (line.length && word.space && cursor + spaceWidth + w > maxWidth) {
        lines.push(line);
        line = [];
        cursor = 0;
      }
      const start = line.length ? cursor + (word.space ? spaceWidth : 0) : 0;
      line.push({ word, x: start });
      cursor = start + w;
    }
    if (line.length) lines.push(line);
    lines.forEach((items, index) => {
      ensure(lineHeight);
      if (index === 0 && opts.prefix) {
        page.drawText(opts.prefix, { x: x - INDENT + 2, y: y - size, size, font: regular, color: TEXT });
      }
      for (const item of items) {
        page.drawText(item.word.text, { x: x + item.x, y: y - size, size, font: item.word.font, color: TEXT });
      }
      y -= lineHeight;
    });
  }

  function list(items: readonly ListItem[], x: number, ordered: boolean): void {
    items.forEach((item, i) => {
      paragraph(item.spans, x, SIZE, LINE, { prefix: ordered ? `${i + 1}.` : '•' });
      y -= 3;
      if (item.children.length) list(item.children, x + INDENT, true);
    });
  }

  newPage();
  paragraph([{ text: heading, bold: true, italic: false }], MARGIN, 15, 20);
  y -= 8;
  for (const block of salesTermsBlocks(input.body)) {
    switch (block.kind) {
      case 'h1':
        break; // tytuł jest w nagłówku PDF
      case 'h2':
        y -= 8;
        ensure(H2_SIZE + 4 + 3 * LINE); // nagłówek nie zostaje sam na dole strony
        paragraph(block.spans, MARGIN, H2_SIZE, H2_SIZE + 5, { forceBold: true });
        y -= 3;
        break;
      case 'p':
        paragraph(block.spans, MARGIN, SIZE, LINE);
        y -= 6;
        break;
      case 'ol':
      case 'ul':
        list(block.items, MARGIN + INDENT, block.kind === 'ol');
        y -= 3;
        break;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = input.pageLabel(i + 1, pages.length);
    const w = regular.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (width - w) / 2, y: MARGIN / 2, size: 8, font: regular, color: MUTED });
  });
  return doc.save({ useObjectStreams: false });
}
