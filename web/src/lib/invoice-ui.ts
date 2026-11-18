/**
 * Wyspa danych do faktury (components/InvoiceFields.astro; SPEC-004 AC-1…AC-4, AC-8, AC-9).
 * Stany: wpis NIP → dane z rejestru do potwierdzenia (AC-3) albo wpis ręczny (AC-4) → potwierdzone.
 * Zapisane `billing_details` → „Użyj zapisanych danych” / „Inna firma” (AC-1). Rejestr odpytuje `company-lookup`;
 * nic nie jest tu zapisywane — zapis robi strona (zamówienie, profil, sprzedaż). Teksty z rejestru tylko przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import {
  SOURCE_TEXT,
  checkNip,
  lookupView,
  validateManual,
  type InvoiceDetails,
  type LookupResult,
} from './invoice';
import { functionErrorCode } from './supabase';

export interface InvoiceControl {
  /** Zaznaczone „Potrzebuję faktury” (bez checkboxa — zawsze). */
  wanted(): boolean;
  /** Potwierdzone dane albo `null` (AC-6). */
  value(): InvoiceDetails | null;
  /** Zapisane `billing_details` (AC-1, AC-9) — podpowiedź; `null` — brak. Czyści potwierdzenie. */
  setSaved(saved: InvoiceDetails | null): void;
}

type State = 'saved' | 'nip' | 'found' | 'manual' | 'confirmed';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/** Lista `dl`: NIP, nazwa, adres, źródło. */
export function renderInvoiceSummary(list: HTMLElement, details: InvoiceDetails): void {
  const rows: [string, string][] = [
    [t('invoice.nip'), details.nip],
    [t('invoice.name'), details.company_name],
    [t('invoice.address'), details.company_address],
    [t('invoice.source'), t(SOURCE_TEXT[details.data_source])],
  ];
  list.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );
}

/** `onChange` — po każdej zmianie zaznaczenia lub potwierdzenia (np. stan przycisku „Zapłać”, AC-6). */
export function bindInvoiceFields(
  root: HTMLElement,
  supabase: SupabaseClient,
  onChange: (control: InvoiceControl) => void = () => {},
): InvoiceControl {
  const box = el(root, '[data-invoice]');
  const wantedBox = box.querySelector<HTMLInputElement>('[data-invoice-wanted]');
  const body = el(box, '[data-invoice-body]');
  const list = el(box, '[data-invoice-summary]');
  const nipInput = el<HTMLInputElement>(box, '[data-nip]');
  const nipError = el(box, '[data-nip-error]');
  const lookup = el<HTMLButtonElement>(box, '[data-lookup]');
  const status = el(box, '[data-lookup-status]');
  const nameInput = el<HTMLInputElement>(box, '[data-manual-name]');
  const addressInput = el<HTMLTextAreaElement>(box, '[data-manual-address]');
  const nameError = el(box, '[data-name-error]');
  const addressError = el(box, '[data-address-error]');

  let state: State = 'nip';
  let saved: InvoiceDetails | null = null;
  let pending: InvoiceDetails | null = null; // dane z rejestru (AC-3) albo zapisane (AC-1)
  let confirmed: InvoiceDetails | null = null;
  let nip = '';

  function render(next: State): void {
    state = next;
    const shown = state === 'confirmed' ? confirmed : state === 'found' || state === 'saved' ? pending : null;
    if (shown) renderInvoiceSummary(list, shown);
    list.hidden = !shown;
    el(box, '[data-invoice-done]').hidden = state !== 'confirmed';
    el(box, '[data-invoice-saved]').hidden = state !== 'saved';
    el(box, '[data-invoice-nip]').hidden = state === 'saved' || state === 'confirmed';
    el(box, '[data-invoice-manual]').hidden = state !== 'manual';
    el(box, '[data-confirm]').hidden = state !== 'found' && state !== 'manual';
    el(box, '[data-edit]').hidden = state !== 'confirmed';
    onChange(control);
  }

  function showNipError(message: string | null): void {
    nipError.textContent = message ?? '';
    nipError.hidden = !message;
    nipInput.setAttribute('aria-invalid', String(Boolean(message)));
  }

  function reset(): void {
    body.hidden = wantedBox ? !wantedBox.checked : false; // po `form.reset()` checkbox mógł się zmienić bez zdarzenia
    confirmed = null;
    pending = saved;
    nipInput.value = saved?.nip ?? '';
    nameInput.value = '';
    addressInput.value = '';
    nameError.hidden = addressError.hidden = true;
    status.textContent = '';
    showNipError(null);
    render(saved ? 'saved' : 'nip');
  }

  wantedBox?.addEventListener('change', () => {
    body.hidden = !wantedBox.checked;
    onChange(control);
  });

  // AC-2: błędny NIP — komunikat, rejestr nie jest odpytywany.
  lookup.addEventListener('click', async () => {
    const check = checkNip(nipInput.value);
    if (!check.ok) {
      showNipError(t(check.error));
      if (state !== 'nip') render('nip');
      return nipInput.focus();
    }
    showNipError(null);
    nip = check.nip;
    lookup.disabled = true;
    status.textContent = t('invoice.looking');
    let result: LookupResult | null = null;
    let code: string | null = null;
    try {
      const response = await supabase.functions.invoke<LookupResult>('company-lookup', { body: { nip } });
      result = response.error ? null : response.data;
      code = response.error ? await functionErrorCode(response.error) : null;
    } catch {
      // brak odpowiedzi — wpis ręczny (AC-4)
    }
    lookup.disabled = false;
    status.textContent = '';
    const view = lookupView(nip, result, code, new Date());
    if (view.kind === 'error') {
      showNipError(t(view.message));
      return render('nip');
    }
    pending = view.kind === 'found' ? view.details : null;
    render(view.kind);
    if (view.kind === 'manual') nameInput.focus();
  });

  nipInput.addEventListener('input', () => {
    if (state === 'found' || state === 'manual') render('nip');
  });

  el(box, '[data-confirm]').addEventListener('click', () => {
    if (state === 'manual') {
      const valid = validateManual(nameInput.value, addressInput.value);
      nameError.hidden = valid.name;
      addressError.hidden = valid.address;
      nameInput.setAttribute('aria-invalid', String(!valid.name));
      addressInput.setAttribute('aria-invalid', String(!valid.address));
      if (!valid.name || !valid.address) return (valid.name ? addressInput : nameInput).focus();
      confirmed = {
        nip,
        company_name: nameInput.value.trim(),
        company_address: addressInput.value.trim(),
        data_source: 'manual',
        fetched_at: null,
      };
    } else {
      confirmed = pending;
    }
    render('confirmed');
  });
  el(box, '[data-use-saved]').addEventListener('click', () => {
    confirmed = saved;
    render('confirmed');
  });
  el(box, '[data-other-company]').addEventListener('click', () => {
    pending = null;
    nipInput.value = '';
    render('nip');
    nipInput.focus();
  });
  el(box, '[data-edit]').addEventListener('click', () => {
    reset();
    nipInput.focus();
  });

  const control: InvoiceControl = {
    wanted: () => (wantedBox ? wantedBox.checked : true),
    value: () => confirmed,
    setSaved(next) {
      saved = next;
      reset();
    },
  };
  reset();
  return control;
}
