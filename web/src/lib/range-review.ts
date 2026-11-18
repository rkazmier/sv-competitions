/**
 * Przegląd książki przez admina (`/panel/ksiazka/przeglad/`, SPEC-005 US-9: AC-26…AC-29). Logika bez DOM:
 * filtry → argumenty `admin_range_log`, kolumny książki, CSV, nazwy plików, łamanie tekstu do PDF.
 * Interfejs: lib/range-review-ui.ts, PDF: lib/range-pdf.ts.
 */
import type { MessageKey } from '../i18n';
import { csvCell } from './orders-admin';
import { entryDateTime, permitOrAddress } from './range-sign';

/** Tłumaczenie komunikatu (`t` z i18n). */
export type Translate = (key: MessageKey, values?: Record<string, string>) => string;

export type ReviewFormat = 'view' | 'pdf' | 'csv';

/** Adnotacja z `admin_range_log` (autor = imię i nazwisko z profilu albo `null`). */
export interface ReviewAnnotation {
  body: string;
  created_at: string;
  author: string | null;
}

/** Wiersz `admin_range_log` — tylko kolumny książki (§5) + adnotacje. */
export interface ReviewEntry {
  id: string;
  entered_at: string;
  full_name: string;
  permit_number: string | null;
  permit_authority: string | null;
  address: string | null;
  range_officer_name: string;
  signature_path: string;
  annotations: ReviewAnnotation[];
}

export interface ReviewFilters {
  from: string;
  to: string;
  person: string;
  officer: string;
}

/** Ważność podpisanych linków do podpisów (SPEC-005 §5, §9). */
export const SIGNATURE_URL_SECONDS = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Domyślny widok: dzisiejszy dzień. */
export function defaultFilters(today: string): ReviewFilters {
  return { from: today, to: today, person: '', officer: '' };
}

/** AC-27: eksport wymaga dnia lub zakresu dat (od ≤ do). */
export function hasDateRange(filters: Pick<ReviewFilters, 'from' | 'to'>): boolean {
  return DATE.test(filters.from) && DATE.test(filters.to) && filters.from <= filters.to;
}

/** AC-26, AC-29: filtry → argumenty `admin_range_log` (niepoprawne wartości pomijane). */
export function filterArgs(filters: ReviewFilters, format: ReviewFormat): Record<string, string | null> {
  return {
    p_format: format,
    p_from: DATE.test(filters.from) ? filters.from : null,
    p_to: DATE.test(filters.to) ? filters.to : null,
    p_person: filters.person.trim() || null,
    p_officer_id: UUID.test(filters.officer) ? filters.officer : null,
  };
}

/** Nagłówki kolumn książki (AC-26) — wspólne dla widoku, PDF i CSV. */
export const COLUMN_KEYS: readonly MessageKey[] = [
  'rangeSign.dateTime',
  'profile.fullName',
  'rangeSign.permitOrAddress',
  'rangeSign.officer',
  'rangeReview.colSignature',
];

/** Komórki tekstowe wpisu (bez podpisu): data i godzina, imię i nazwisko, decyzja i organ / adres, prowadzący. */
export function entryCells(entry: ReviewEntry): [string, string, string, string] {
  return [entryDateTime(entry.entered_at), entry.full_name, permitOrAddress(entry), entry.range_officer_name];
}

const isoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** AC-28: data i godzina w Europe/Warsaw jako `RRRR-MM-DD GG:MM`. */
export function csvDateTime(timestamp: string): string {
  const parts = Object.fromEntries(isoParts.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** AC-26: adnotacja „autor, data i godzina: treść”. */
export function annotationText(annotation: ReviewAnnotation, text: Translate): string {
  return text('rangeHistory.annotation', {
    author: annotation.author ?? '—',
    time: entryDateTime(annotation.created_at),
    body: annotation.body,
  });
}

/**
 * AC-28: CSV (UTF-8 z BOM, `;`) — kolumny z AC-26, podpis = „tak”, adnotacje w ostatniej kolumnie (rozdzielone „ | ”).
 * `text` tłumaczy klucze komunikatów.
 */
export function rangeLogCsv(
  entries: readonly ReviewEntry[],
  text: Translate,
): string {
  const header = [...COLUMN_KEYS, 'rangeHistory.annotationsLabel' as const].map((key) => text(key));
  const rows = entries.map((entry) => {
    const [, ...cells] = entryCells(entry);
    const notes = entry.annotations.map((annotation) => annotationText(annotation, text)).join(' | ');
    return [csvDateTime(entry.entered_at), ...cells, text('rangeReview.signatureYes'), notes];
  });
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Nazwa pliku eksportu, np. `ksiazka-2026-11-01-2026-11-18.pdf`. */
export function exportFileName(filters: Pick<ReviewFilters, 'from' | 'to'>, extension: 'pdf' | 'csv'): string {
  const range = filters.from === filters.to ? filters.from : `${filters.from}-${filters.to}`;
  return `ksiazka-${range}.${extension}`;
}

/** Zakres dat do nagłówka PDF, np. „10.03.2026 – 12.03.2026” albo jeden dzień. */
export function rangeLabel(filters: Pick<ReviewFilters, 'from' | 'to'>): string {
  const pl = (date: string) => date.split('-').reverse().join('.');
  return filters.from === filters.to ? pl(filters.from) : `${pl(filters.from)} – ${pl(filters.to)}`;
}

/** Łamie tekst na linie nie szersze niż `maxWidth` (`measure` — szerokość w punktach); zbyt długie słowa dzieli. */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}
