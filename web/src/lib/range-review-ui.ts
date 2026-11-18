/**
 * Wyspa przeglądu książki (`/panel/ksiazka/przeglad/`, SPEC-005 US-9, AC-26…AC-29). Tylko admin (`requireAdmin`).
 * Każde pobranie wpisów idzie przez `admin_range_log`, które zapisuje `range_log_export` w `audit_log` (AC-29):
 * `view` — lista z miniaturami podpisów (podpisane linki 60 s), `pdf` i `csv` — eksport bieżących filtrów.
 * Pod każdym wpisem adnotacje i „Dodaj adnotację” (admin — do dowolnego wpisu, AC-21); po zapisie lista się odświeża.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t, type MessageKey } from '../i18n';
import { todayInWarsaw } from './calendar';
import { requireAdmin } from './panel';
import { bindAnnotationForm } from './range-annotation-ui';
import {
  SIGNATURE_URL_SECONDS,
  annotationText,
  defaultFilters,
  entryCells,
  exportFileName,
  fetchSignatures,
  filterArgs,
  hasDateRange,
  rangeLogCsv,
  type ReviewEntry,
  type ReviewFilters,
  type ReviewFormat,
} from './range-review';

const FONTS = { regular: '/fonts/inter-400.otf', bold: '/fonts/inter-600.otf' };

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function download(data: BlobPart, type: string, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function fetchEntries(supabase: SupabaseClient, filters: ReviewFilters, format: ReviewFormat): Promise<ReviewEntry[]> {
  const { data, error } = await supabase.rpc('admin_range_log', filterArgs(filters, format));
  if (error) throw error;
  return (data ?? []) as ReviewEntry[];
}

/** Podpisane linki (60 s) do podpisów; ścieżka bez linku → brak w mapie. */
async function signedUrls(supabase: SupabaseClient, paths: readonly string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase.storage.from('signatures').createSignedUrls([...paths], SIGNATURE_URL_SECONDS);
  if (error) throw error;
  return new Map(data.flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [])));
}

async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Fonty PDF pobierane raz na sesję strony; nieudane pobranie nie zostaje w pamięci (kolejna próba pobierze ponownie). */
let fontCache: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;
function pdfFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  fontCache ??= Promise.all([bytes(FONTS.regular), bytes(FONTS.bold)]).then(
    ([regular, bold]) => ({ regular, bold }),
    (error: unknown) => {
      fontCache = null;
      throw error;
    },
  );
  return fontCache;
}

export async function mountRangeReview(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-filters]');
  const officerSelect = query<HTMLSelectElement>(form, '[data-officer]');
  const status = query<HTMLElement>(root, '[data-status]');
  const errorBox = query<HTMLElement>(root, '[data-error]');
  const summary = query<HTMLElement>(root, '[data-summary]');
  const rows = query<HTMLElement>(root, '[data-rows]');
  const annotationTemplate = query<HTMLTemplateElement>(root, 'template[data-annotation-template]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-export]')];

  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  for (const [name, value] of Object.entries(defaultFilters(todayInWarsaw()))) field(name).value = value;
  const readFilters = (): ReviewFilters => ({
    from: field('from').value,
    to: field('to').value,
    person: field('person').value,
    officer: field('officer').value,
  });

  const supabase = await requireAdmin();

  function showError(key: MessageKey | null): void {
    errorBox.textContent = key ? t(key) : '';
    errorBox.hidden = !key;
  }

  function cell(row: HTMLTableRowElement, text: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.textContent = text;
    row.append(td);
    return td;
  }

  function render(entries: readonly ReviewEntry[], urls: Map<string, string>): void {
    rows.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('tr');
      for (const text of entryCells(entry)) cell(row, text);
      const signature = cell(row, '');
      const url = urls.get(entry.signature_path);
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = t('rangeReview.signatureAlt', { name: entry.full_name });
        image.width = 160;
        image.height = 60;
        image.className = 'signature';
        image.addEventListener('error', () => signature.replaceChildren(t('rangeReview.signatureError')));
        signature.append(image);
      } else {
        signature.textContent = t('rangeReview.signatureError');
      }
      rows.append(row);
      // Adnotacje pod wpisem i „Dodaj adnotację” (admin — do dowolnego wpisu, AC-21).
      const notesRow = document.createElement('tr');
      notesRow.className = 'notes';
      const notesCell = cell(notesRow, '');
      notesCell.colSpan = 5;
      if (entry.annotations.length > 0) {
        const list = document.createElement('ul');
        list.setAttribute('aria-label', t('rangeHistory.annotationsLabel'));
        for (const annotation of entry.annotations) {
          const item = document.createElement('li');
          item.textContent = annotationText(annotation, t);
          list.append(item);
        }
        notesCell.append(list);
      }
      const annotate = annotationTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const srLabel = t('rangeHistory.addAnnotationSr', { name: entry.full_name, time: entryCells(entry)[0] });
      bindAnnotationForm(annotate, entry.id, srLabel, supabase, load);
      notesCell.append(annotate);
      rows.append(notesRow);
    }
    query<HTMLElement>(root, '[data-table]').hidden = entries.length === 0;
    query<HTMLElement>(root, '[data-empty]').hidden = entries.length > 0;
    summary.textContent = t('rangeReview.summary', { count: entries.length });
  }

  async function load(): Promise<void> {
    showError(null);
    summary.textContent = t('rangeReview.loading');
    try {
      const entries = await fetchEntries(supabase, readFilters(), 'view');
      render(entries, await signedUrls(supabase, entries.map((entry) => entry.signature_path)));
    } catch {
      summary.textContent = '';
      showError('rangeReview.loadError');
    }
  }

  async function exportBook(format: 'pdf' | 'csv'): Promise<void> {
    const filters = readFilters();
    showError(null);
    if (!hasDateRange(filters)) return showError('rangeReview.dateRangeRequired');
    for (const button of buttons) button.disabled = true;
    status.textContent = t('rangeReview.exporting');
    try {
      const entries = await fetchEntries(supabase, filters, format);
      if (format === 'csv') {
        download(rangeLogCsv(entries, t), 'text/csv;charset=utf-8', exportFileName(filters, 'csv'));
      } else {
        // Wszystkie podpisy pobrane przed budową PDF (porcjami, każda z własnymi linkami 60 s).
        const [{ buildRangeLogPdf }, signatures, fonts] = await Promise.all([
          import('./range-pdf'),
          fetchSignatures(
            entries.map((entry) => entry.signature_path),
            (paths) => signedUrls(supabase, paths),
            bytes,
          ),
          pdfFonts(),
        ]);
        const pdf = await buildRangeLogPdf({ entries, filters, fonts, signatures, text: t });
        download(pdf as Uint8Array<ArrayBuffer>, 'application/pdf', exportFileName(filters, 'pdf'));
      }
      status.textContent = '';
    } catch {
      status.textContent = '';
      showError('rangeReview.exportError');
    } finally {
      for (const button of buttons) button.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load();
  });
  for (const button of buttons) {
    button.addEventListener('click', () => void exportBook(button.dataset.export === 'pdf' ? 'pdf' : 'csv'));
  }

  const { data: officers } = await supabase.from('range_officers').select('id, full_name').order('full_name');
  for (const officer of officers ?? []) officerSelect.add(new Option(officer.full_name as string, officer.id as string));
  await load();
}
