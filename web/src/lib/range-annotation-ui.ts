/**
 * Formularz adnotacji (SPEC-005 AC-21, AC-22; components/AnnotationForm.astro): „Dodaj adnotację” → treść 5–500 znaków →
 * `insert` do `range_log_annotations`; odrzucenie przez RLS (obsługa, wpis z innego dnia) → komunikat AC-22.
 * Używany w liście dzisiejszych wpisów (`/panel/ksiazka/`) i w przeglądzie książki admina (`/panel/ksiazka/przeglad/`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { annotationError, annotationSaveErrorKey } from './range-history';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/** `srLabel` — dopowiedzenie przycisku dla czytników ekranu (np. „do wpisu: Jan Kowalski, 10:32”). */
export function bindAnnotationForm(
  root: ParentNode,
  entryId: string,
  srLabel: string,
  supabase: SupabaseClient,
  onSaved: () => Promise<void> | void,
): void {
  const open = el<HTMLButtonElement>(root, '[data-annotate]');
  el(open, '[data-annotate-sr]').textContent = ` ${srLabel}`;
  const form = el<HTMLFormElement>(root, 'form');
  const textarea = el<HTMLTextAreaElement>(form, 'textarea');
  const label = el<HTMLLabelElement>(form, 'label');
  const error = el(form, '[data-annotation-error]');
  textarea.id = `ann-${entryId}`;
  label.htmlFor = textarea.id;
  error.id = `ann-${entryId}-error`;
  textarea.setAttribute('aria-describedby', error.id);
  const showError = (text: string | null) => {
    error.textContent = text ?? '';
    error.hidden = !text;
    textarea.setAttribute('aria-invalid', String(Boolean(text)));
  };
  open.addEventListener('click', () => {
    form.hidden = false;
    open.hidden = true;
    textarea.focus();
  });
  el(form, '[data-annotation-cancel]').addEventListener('click', () => {
    form.hidden = true;
    open.hidden = false;
    showError(null);
    open.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const invalid = annotationError(textarea.value);
    if (invalid) {
      showError(t(invalid));
      return textarea.focus();
    }
    const submit = el<HTMLButtonElement>(form, '[data-annotation-save]');
    submit.disabled = true;
    const { error: saveError } = await supabase
      .from('range_log_annotations')
      .insert({ entry_id: entryId, body: textarea.value.trim() });
    submit.disabled = false;
    if (saveError) return showError(t(annotationSaveErrorKey(saveError.code)));
    await onSaved();
  });
}
