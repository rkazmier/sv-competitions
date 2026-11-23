/**
 * Panel: zamknięcia strzelnicy (SPEC-012 US-6: AC-30, AC-31, AC-32, AC-34). Tylko admin.
 * Formularz „Od” / „Do” / „Przyczyna” → „Dalej” (`rpc/range_closure_preview`) → „Zapisz i przedłuż”
 * (`rpc/add_range_closure`) albo „Wróć”. Lista od najnowszych, bez edycji i usuwania.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { formatDateTime } from './admin-users';
import { todayInWarsaw } from './calendar';
import { formatShortDateRange } from './dates';
import { requireAdmin } from './panel';
import {
  CLOSURE_COLUMNS,
  closureErrorKey,
  closurePeriodError,
  isClosureReasonValid,
  sortClosures,
  type ClosureSummary,
  type RangeClosure,
} from './range-closures';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function closureRow(closure: RangeClosure): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(
    cell(formatShortDateRange(closure.starts_on, closure.ends_on)),
    cell(String(closure.days)),
    cell(closure.reason),
    cell(String(closure.passes_count)),
    cell(closure.author?.full_name ?? '—'),
    cell(formatDateTime(closure.created_at)),
  );
  return row;
}

export async function mountRangeClosures(root: HTMLElement): Promise<void> {
  const supabase: SupabaseClient = await requireAdmin();
  const form = query<HTMLFormElement>(root, '[data-closure-form]');
  const from = query<HTMLInputElement>(form, '[name="from"]');
  const to = query<HTMLInputElement>(form, '[name="to"]');
  const reason = query<HTMLTextAreaElement>(form, '[name="reason"]');
  const next = query<HTMLButtonElement>(form, '[data-next]');
  const preview = query<HTMLElement>(root, '[data-preview]');
  const previewText = query<HTMLElement>(preview, '[data-preview-text]');
  const confirm = query<HTMLButtonElement>(preview, '[data-confirm]');
  const back = query<HTMLButtonElement>(preview, '[data-back]');
  const status = query<HTMLElement>(root, '[data-status]');
  const error = query<HTMLElement>(root, '[data-error]');
  const rows = query<HTMLElement>(root, '[data-rows]');
  const table = query<HTMLElement>(root, '[data-table]');
  const empty = query<HTMLElement>(root, '[data-empty]');

  const today = todayInWarsaw();
  from.max = today;
  to.max = today;

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = !message;
  }

  function setPreview(open: boolean): void {
    preview.hidden = !open;
    for (const field of [from, to, reason, next]) field.disabled = open;
  }

  async function load(): Promise<void> {
    const { data, error: loadError } = await supabase.from('range_closures').select(CLOSURE_COLUMNS);
    if (loadError) return showError(t('panel.loadError'));
    const list = sortClosures((data ?? []) as unknown as RangeClosure[]);
    rows.replaceChildren(...list.map(closureRow));
    table.hidden = list.length === 0;
    empty.hidden = list.length > 0;
  }

  // AC-30, AC-31: walidacja i podgląd przed zapisem.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    const periodError = closurePeriodError(from.value, to.value, today);
    if (periodError) return showError(t(periodError));
    if (!isClosureReasonValid(reason.value)) {
      reason.focus();
      return showError(t('rangeClosures.reasonInvalid'));
    }
    showError('');
    status.textContent = t('rangeClosures.checking');
    next.disabled = true;
    const { data, error: rpcError } = await supabase.rpc('range_closure_preview', { p_from: from.value, p_to: to.value });
    next.disabled = false;
    status.textContent = '';
    if (rpcError) return showError(t(closureErrorKey(rpcError.message)));
    const summary = data as ClosureSummary;
    previewText.textContent = t('rangeClosures.preview', { days: summary.days, count: summary.passes_count });
    setPreview(true);
    confirm.focus();
  });

  back.addEventListener('click', () => {
    setPreview(false);
    from.focus();
  });

  // AC-32: zapis i przedłużenie w jednej transakcji (baza).
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    back.disabled = true;
    status.textContent = t('rangeClosures.saving');
    const { data, error: rpcError } = await supabase.rpc('add_range_closure', {
      p_from: from.value,
      p_to: to.value,
      p_reason: reason.value.trim(),
    });
    confirm.disabled = false;
    back.disabled = false;
    setPreview(false);
    if (rpcError) {
      status.textContent = '';
      return showError(t(closureErrorKey(rpcError.message)));
    }
    const summary = data as ClosureSummary;
    form.reset();
    status.textContent = t('rangeClosures.saved', { count: summary.passes_count, days: summary.days });
    await load();
  });

  await load();
}
