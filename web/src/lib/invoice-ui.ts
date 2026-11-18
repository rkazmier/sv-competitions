/**
 * Wyspa danych do faktury (components/InvoiceFields.astro; SPEC-004 AC-1…AC-4, AC-8, AC-9).
 * Stany: wpis NIP → dane z rejestru przyjęte od razu (AC-3) albo wpis ręczny do potwierdzenia (AC-4) → gotowe.
 * Zapisane `billing_details` (AC-1, AC-9): po zaznaczeniu faktury NIP wypełnia się sam i rejestr jest odpytywany
 * automatycznie; gdy nie zwróci danych — zapisane dane. Rejestr odpytuje `company-lookup`;
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
  /** Gotowe dane (z rejestru albo potwierdzone ręcznie) albo `null` (AC-6). */
  value(): InvoiceDetails | null;
  /** Zapisane `billing_details` (AC-1, AC-9) — NIP do automatycznego pobrania; `null` — brak. Czyści gotowe dane. */
  setSaved(saved: InvoiceDetails | null): void;
}

type State = 'nip' | 'manual' | 'confirmed';

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

/** `onChange` — po każdej zmianie zaznaczenia lub gotowych danych (np. stan przycisku „Zapłać”, AC-6). */
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
  let confirmed: InvoiceDetails | null = null;
  let nip = '';
  let autoDone = false; // zapisany NIP pobrany automatycznie (raz na `setSaved`/„Zmień”)
  let run = 0; // numer bieżącego zapytania — starsze odpowiedzi są ignorowane

  function render(next: State): void {
    state = next;
    if (confirmed && state === 'confirmed') renderInvoiceSummary(list, confirmed);
    list.hidden = state !== 'confirmed';
    el(box, '[data-invoice-done]').hidden = state !== 'confirmed';
    el(box, '[data-invoice-nip]').hidden = state === 'confirmed';
    el(box, '[data-invoice-manual]').hidden = state !== 'manual';
    el(box, '[data-confirm]').hidden = state !== 'manual';
    el(box, '[data-edit]').hidden = state !== 'confirmed';
    onChange(control);
  }

  function showNipError(message: string | null): void {
    nipError.textContent = message ?? '';
    nipError.hidden = !message;
    nipInput.setAttribute('aria-invalid', String(Boolean(message)));
  }

  function cancelLookup(): void {
    run += 1;
    lookup.disabled = false;
    status.textContent = '';
  }

  /** AC-3: dane z rejestru przyjęte od razu; AC-4: wpis ręczny. `fallback` — zapisane dane, gdy rejestr nic nie zwróci (AC-1). */
  async function fetchCompany(fallback: InvoiceDetails | null): Promise<void> {
    const current = ++run;
    lookup.disabled = true;
    status.textContent = t('invoice.looking');
    let result: LookupResult | null = null;
    let code: string | null = null;
    try {
      const response = await supabase.functions.invoke<LookupResult>('company-lookup', { body: { nip } });
      result = response.error ? null : response.data;
      code = response.error ? await functionErrorCode(response.error) : null;
    } catch {
      // brak odpowiedzi — zapisane dane albo wpis ręczny (AC-4)
    }
    if (current !== run) return;
    lookup.disabled = false;
    status.textContent = '';
    const view = lookupView(nip, result, code, new Date());
    if (view.kind === 'found' || fallback) {
      confirmed = view.kind === 'found' ? view.details : fallback;
      return render('confirmed');
    }
    if (view.kind === 'error') {
      showNipError(t(view.message));
      return render('nip');
    }
    render('manual');
    nameInput.focus();
  }

  /** AC-1: zapisany NIP wypełnia się sam i dane pobierają się bez klikania — gdy faktura jest zaznaczona. */
  function autoFill(): void {
    if (!saved || autoDone || state === 'confirmed' || !control.wanted()) return;
    autoDone = true;
    nipInput.value = saved.nip;
    const check = checkNip(saved.nip);
    if (!check.ok) return;
    nip = check.nip;
    void fetchCompany(saved);
  }

  function reset(): void {
    cancelLookup();
    body.hidden = wantedBox ? !wantedBox.checked : false; // po `form.reset()` checkbox mógł się zmienić bez zdarzenia
    confirmed = null;
    autoDone = false;
    nipInput.value = saved?.nip ?? '';
    nameInput.value = '';
    addressInput.value = '';
    nameError.hidden = addressError.hidden = true;
    showNipError(null);
    render('nip');
    autoFill();
  }

  wantedBox?.addEventListener('change', () => {
    body.hidden = !wantedBox.checked;
    onChange(control);
    autoFill();
  });

  // AC-2: błędny NIP — komunikat, rejestr nie jest odpytywany.
  lookup.addEventListener('click', () => {
    const check = checkNip(nipInput.value);
    if (!check.ok) {
      showNipError(t(check.error));
      if (state !== 'nip') render('nip');
      return nipInput.focus();
    }
    showNipError(null);
    nip = check.nip;
    void fetchCompany(null);
  });

  nipInput.addEventListener('input', () => {
    if (lookup.disabled) cancelLookup();
    if (state === 'manual') render('nip');
  });

  // AC-4: tylko dane wpisane ręcznie wymagają „Dane są poprawne”.
  el(box, '[data-confirm]').addEventListener('click', () => {
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
    render('confirmed');
  });
  // „Zmień dane do faktury” — wpis innego NIP (bez ponownego automatycznego pobrania).
  el(box, '[data-edit]').addEventListener('click', () => {
    cancelLookup();
    nipInput.value = confirmed?.nip ?? '';
    confirmed = null;
    render('nip');
    nipInput.focus();
    nipInput.select();
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
