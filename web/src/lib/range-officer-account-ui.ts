/**
 * „Twoje dane” w `/konto/` — uprawnienia prowadzącego z konta (SPEC-007 US-1, US-3; AC-1…AC-4, AC-11…AC-13).
 * Formularz AC-2 w oknie `<dialog>` na tej samej stronie (status, przełącznik i „Usuń” są w „Twoje dane”).
 * SPEC-008 AC-1: przy zatwierdzonych uprawnieniach i dyżurze dziś (`is_range_duty_officer`) — „Dziś jesteś dyżurnym
 * Prowadzącym.” i „Otwórz książkę rejestru pobytu”.
 * Odczyt i zapis wyłącznie przez funkcje bazy (lib/range-officer-account.ts); tekst z bazy tylko przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { DictionaryItem } from './dictionary';
import { wireOfficerFields } from './dictionary-ui';
import {
  firstRow,
  institutionText,
  savedText,
  saveErrorText,
  statusText,
  visibleSubmission,
  type MyRangeOfficer,
} from './range-officer-account';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

export async function mountRangeOfficerAccount(supabase: SupabaseClient, fullName: string | null): Promise<void> {
  const root = el(document, '[data-officer]');
  const none = el(root, '[data-officer-none]');
  const current = el(root, '[data-officer-current]');
  const status = el(root, '[data-officer-status]');
  const hide = el<HTMLInputElement>(root, '[data-officer-hide]');
  const dialog = el<HTMLDialogElement>(document, 'dialog[data-officer-dialog]');
  const form = el<HTMLFormElement>(dialog, 'form');
  const formError = el(form, '[data-form-error]');
  const submit = el<HTMLButtonElement>(form, '[data-submit]');
  const formHide = el<HTMLInputElement>(form, '[name="hide_from_others"]');
  const fields = wireOfficerFields(form, 'ro')!;

  const say = (text: string, error = false) => {
    status.className = error ? 'message-error' : '';
    status.textContent = text;
  };

  let submission: MyRangeOfficer | null = null;
  const show = (row: MyRangeOfficer | null) => {
    submission = visibleSubmission(row);
    none.hidden = Boolean(submission);
    current.hidden = !submission;
    if (!submission) return;
    el(current, '[data-officer-state]').textContent = statusText(submission.status);
    el(current, '[data-officer-license]').textContent = submission.license_number ?? '';
    el(current, '[data-officer-institution]').textContent = institutionText(submission);
    hide.checked = submission.hide_from_others;
  };

  const { data, error } = await supabase.rpc('my_range_officer');
  if (error) {
    say(t('rangeOfficerAccount.loadError'), true);
    root.hidden = false;
    return;
  }
  show(firstRow(data));
  root.hidden = false;

  // AC-1 (SPEC-008): dyżurny dziś — wejście do książki; w innym wypadku (także przy błędzie) nic się nie pokazuje (AC-3).
  if (visibleSubmission(firstRow(data))?.status === 'approved') {
    const duty = await supabase.rpc('is_range_duty_officer');
    el(current, '[data-officer-duty]').hidden = Boolean(duty.error) || duty.data !== true;
  }

  /** AC-2 (nowe — „Ukryj mnie dla innych” zaznaczone) albo AC-11 (edycja — dane zgłoszenia). */
  const openForm = (row: MyRangeOfficer | null) => {
    say('');
    // AC-3: bez imienia i nazwiska w profilu formularz się nie otwiera.
    if (!fullName) return say(t('rangeOfficerAccount.fullNameRequired'), true);
    el(form, '[data-officer-name]').textContent = fullName;
    fields.fill({
      id: '',
      name: fullName,
      is_active: true,
      license_number: row?.license_number ?? null,
      institution: (row?.institution ?? null) as DictionaryItem['institution'],
      institution_other: row?.institution_other ?? null,
    });
    formHide.checked = row ? row.hide_from_others : true;
    formError.hidden = true;
    dialog.showModal();
  };
  el(none, '[data-officer-add]').addEventListener('click', () => openForm(null));
  el(current, '[data-officer-edit]').addEventListener('click', () => openForm(submission));
  el(form, '[data-cancel]').addEventListener('click', () => dialog.close());

  // AC-4, AC-11: zapis przez `save_my_range_officer` — baza ustawia `pending` przy nowym, przywróconym
  // albo zmianie nr legitymacji / instytucji.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;
    const row = fields.validate();
    if (!row) return;
    submit.disabled = true;
    const result = await supabase.rpc('save_my_range_officer', {
      p_license_number: row.license_number,
      p_institution: row.institution,
      p_institution_other: row.institution_other,
      p_hide_from_others: formHide.checked,
    });
    submit.disabled = false;
    const saved = firstRow(result.data);
    if (result.error || !saved) {
      formError.textContent = saveErrorText(result.error);
      formError.hidden = false;
      return;
    }
    dialog.close();
    show(saved);
    say(savedText(saved));
  });

  // AC-12: sam przełącznik — od razu, bez zatwierdzenia i bez zmiany statusu.
  hide.addEventListener('change', async () => {
    const wanted = hide.checked;
    hide.disabled = true;
    const { error: hideError } = await supabase.rpc('set_my_range_officer_hidden', { p_hidden: wanted });
    hide.disabled = false;
    if (hideError) {
      hide.checked = !wanted;
      return say(t('rangeOfficerAccount.saveError'), true);
    }
    if (submission) submission.hide_from_others = wanted;
    say(t('rangeOfficerAccount.saved'));
  });

  // AC-13: „Usuń” po potwierdzeniu → `is_active = false`; znów „Dodaj uprawnienia prowadzącego”.
  const remove = el<HTMLButtonElement>(current, '[data-officer-remove]');
  remove.addEventListener('click', async () => {
    if (!window.confirm(t('rangeOfficerAccount.removeConfirm'))) return;
    remove.disabled = true;
    const { error: removeError } = await supabase.rpc('remove_my_range_officer');
    remove.disabled = false;
    if (removeError) return say(t('rangeOfficerAccount.saveError'), true);
    show(null);
    say(t('rangeOfficerAccount.removed'));
  });
}
