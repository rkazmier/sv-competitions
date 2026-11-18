/**
 * PDF książki rejestru pobytu (SPEC-005 AC-27) — generowany w przeglądarce (pdf-lib, SPEC-005 §8):
 * A4 poziomo, nagłówek „Książka rejestru pobytu na strzelnicy Steel Valley”, zakres dat, kolumny z AC-26
 * z obrazami podpisów, adnotacje pod wpisem, numer strony. Polskie znaki — osadzony font Inter (public/fonts/*.otf — te same podzbiory co WOFF2 strony).
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  COLUMN_KEYS,
  annotationText,
  entryCells,
  rangeLabel,
  wrapText,
  type ReviewEntry,
  type ReviewFilters,
  type Translate,
} from './range-review';

export const PAGE_SIZE: [number, number] = [841.89, 595.28];
const MARGIN = 36;
const COLUMN_WIDTHS = [90, 150, 230, 140, 159.89];
const SIZE = 9;
const LINE = 11.5;
const NOTE_SIZE = 8;
const NOTE_LINE = 10;
const PAD = 4;
const SIGNATURE_HEIGHT = 36;
const TEXT = rgb(0.1, 0.1, 0.1);
const RULE = rgb(0.7, 0.7, 0.7);

export interface RangeLogPdfInput {
  entries: readonly ReviewEntry[];
  filters: Pick<ReviewFilters, 'from' | 'to'>;
  /** Inter 400 i 600 jako OTF: pdf-lib osadza plik bez konwersji (czytniki PDF nie znają WOFF2); bez podzbioru — podzbiór CFF z fontkit jest nieczytelny. */
  fonts: { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array };
  /** Obraz podpisu (PNG) — błąd przerywa eksport (książka bez podpisu byłaby niepełna). */
  signature: (entry: ReviewEntry) => Promise<ArrayBuffer | Uint8Array>;
  text: Translate;
}

export async function buildRangeLogPdf(input: RangeLogPdfInput): Promise<Uint8Array> {
  const { entries, filters, text } = input;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${text('rangeReview.pdfTitle')} ${rangeLabel(filters)}`);
  // `calt` wyłączone: zamienniki Inter (np. dwukropek między cyframi) dostają w PDF złą szerokość („10:  00”).
  const regular = await doc.embedFont(input.fonts.regular, { subset: false, features: { calt: false } });
  const bold = await doc.embedFont(input.fonts.bold, { subset: false, features: { calt: false } });
  const [width, height] = PAGE_SIZE;
  const columnX = COLUMN_WIDTHS.map((_, i) => MARGIN + COLUMN_WIDTHS.slice(0, i).reduce((a, b) => a + b, 0));
  const bottom = MARGIN + 18;

  let page!: PDFPage;
  let y = 0;

  function draw(target: PDFPage, value: string, x: number, top: number, font: PDFFont, size: number): void {
    target.drawText(value, { x, y: top - size, size, font, color: TEXT });
  }

  function rule(top: number): void {
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: width - MARGIN, y: top }, thickness: 0.5, color: RULE });
  }

  function newPage(): void {
    page = doc.addPage(PAGE_SIZE);
    y = height - MARGIN;
    draw(page, text('rangeReview.pdfTitle'), MARGIN, y, bold, 14);
    draw(page, text('rangeReview.pdfRange', { range: rangeLabel(filters) }), MARGIN, y - 20, regular, 10);
    y -= 42;
    COLUMN_KEYS.forEach((key, i) => draw(page, text(key), columnX[i] + PAD, y - PAD, bold, SIZE));
    y -= LINE + 2 * PAD;
    rule(y);
  }

  newPage();
  if (entries.length === 0) draw(page, text('rangeReview.empty'), MARGIN, y - PAD, regular, SIZE);

  for (const entry of entries) {
    const cells = entryCells(entry).map((cell, i) =>
      wrapText(cell, COLUMN_WIDTHS[i] - 2 * PAD, (value) => regular.widthOfTextAtSize(value, SIZE)),
    );
    const notes = entry.annotations.flatMap((annotation) =>
      wrapText(annotationText(annotation, text), width - 2 * MARGIN - 4 * PAD, (value) =>
        regular.widthOfTextAtSize(value, NOTE_SIZE),
      ),
    );
    const rowHeight = Math.max(...cells.map((lines) => lines.length * LINE), SIGNATURE_HEIGHT) + 2 * PAD;
    const notesHeight = notes.length ? notes.length * NOTE_LINE + PAD : 0;
    if (y - rowHeight - notesHeight < bottom) newPage();

    cells.forEach((lines, i) => lines.forEach((line, n) => draw(page, line, columnX[i] + PAD, y - PAD - n * LINE, regular, SIZE)));
    const image = await doc.embedPng(await input.signature(entry));
    const scale = Math.min((COLUMN_WIDTHS[4] - 2 * PAD) / image.width, SIGNATURE_HEIGHT / image.height);
    page.drawImage(image, { x: columnX[4] + PAD, y: y - PAD - image.height * scale, width: image.width * scale, height: image.height * scale });
    y -= rowHeight;
    notes.forEach((line, n) => draw(page, line, MARGIN + 2 * PAD, y - n * NOTE_LINE, regular, NOTE_SIZE));
    y -= notesHeight;
    rule(y);
  }

  const pages = doc.getPages();
  pages.forEach((target, i) => {
    const label = text('rangeReview.pdfPage', { page: String(i + 1), pages: String(pages.length) });
    draw(target, label, width - MARGIN - regular.widthOfTextAtSize(label, NOTE_SIZE), MARGIN, regular, NOTE_SIZE);
  });
  return doc.save();
}
