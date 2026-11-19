/**
 * Lista wyboru Prowadzącego z wyszukiwarką (SPEC-007 AC-15, AC-18, AC-19) — components/OfficerPicker.astro.
 * Lista: `range_officer_choices` (osoba wpisywana pierwsza z dopiskiem, potem widoczni alfabetycznie);
 * wyszukiwarka: `staff_search_range_officers` (także ukryci dla innych). Tekst z bazy — wyłącznie `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { OFFICER_SEARCH_MIN_LENGTH, officerSearchQuery, orderChoices, type OfficerChoice, type RangeOfficer } from './range-duty';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export interface OfficerPicker {
  /** Świeża lista (AC-18: `personId` — profil osoby wpisywanej); `false` przy błędzie wczytania. */
  open(personId?: string | null): Promise<boolean>;
  focusFirst(): void;
}

export function mountOfficerPicker(
  root: HTMLElement,
  supabase: SupabaseClient,
  onChoose: (officer: RangeOfficer) => void,
): OfficerPicker {
  const list = query<HTMLUListElement>(root, '[data-officers]');
  const empty = query<HTMLElement>(root, '[data-no-officers]');
  const input = query<HTMLInputElement>(root, '[data-officer-query]');
  const button = query<HTMLButtonElement>(root, '[data-officer-search]');
  const status = query<HTMLElement>(root, '[data-officer-search-status]');
  const results = query<HTMLUListElement>(root, '[data-officer-results]');
  const template = query<HTMLTemplateElement>(root, '[data-officer-template]');

  function buttons(officers: readonly OfficerChoice[]): DocumentFragment[] {
    return officers.map((officer) => {
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const choice = query<HTMLButtonElement>(fragment, '[data-officer]');
      choice.textContent = officer.is_person ? t('rangeLog.officerIsPerson', { name: officer.full_name }) : officer.full_name;
      choice.addEventListener('click', () => onChoose({ id: officer.id, full_name: officer.full_name }));
      return fragment;
    });
  }

  /** AC-19: od 3 znaków, maks. 10 wyników, także ukryci dla innych; tylko identyfikator i imię i nazwisko. */
  async function search(): Promise<void> {
    const value = officerSearchQuery(input.value);
    results.replaceChildren();
    if (!value) {
      status.textContent = t('rangeLog.searchHint', { min: OFFICER_SEARCH_MIN_LENGTH });
      return;
    }
    button.disabled = true;
    const { data, error } = await supabase.rpc('staff_search_range_officers', { p_query: value });
    button.disabled = false;
    const found = (data ?? []) as RangeOfficer[];
    status.textContent = error ? t('panel.loadError') : found.length ? '' : t('rangeLog.searchEmpty');
    results.replaceChildren(...buttons(found));
  }

  button.addEventListener('click', () => void search());
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search();
  });

  return {
    async open(personId = null) {
      input.value = '';
      status.textContent = '';
      results.replaceChildren();
      // Świeża lista — prowadzący mógł zostać dodany, zatwierdzony lub ukryty w trakcie dnia.
      const { data, error } = await supabase.rpc('range_officer_choices', personId ? { p_person_id: personId } : {});
      if (error) return false;
      const officers = orderChoices(data);
      list.replaceChildren(...buttons(officers));
      empty.hidden = officers.length > 0;
      return true;
    },
    focusFirst() {
      (list.querySelector<HTMLButtonElement>('button') ?? input).focus();
    },
  };
}
