/**
 * Wyspa `/panel/ksiazka/` (SPEC-005 US-2, AC-3, AC-4) — obsługa i admin (`requireStaff`).
 * Bez wybranego dziś prowadzącego: „Kto prowadzi strzelanie?” z listą aktywnych prowadzących.
 * Po wyborze: nazwisko na górze ekranu z przyciskiem „Zmień”. Przebieg wpisu — zadania #60, #61.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { showLoadError, requireStaff } from './panel';
import { clearShiftOfficer, currentShiftOfficer, saveShiftOfficer, type RangeOfficer } from './range-shift';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountRangeLog(root: HTMLElement): Promise<void> {
  const picker = query<HTMLElement>(root, '[data-shift-picker]');
  const officersList = query<HTMLUListElement>(picker, '[data-officers]');
  const noOfficers = query<HTMLElement>(picker, '[data-no-officers]');
  const shift = query<HTMLElement>(root, '[data-shift]');
  const officerName = query<HTMLElement>(shift, '[data-officer-name]');
  const change = query<HTMLButtonElement>(shift, '[data-change-officer]');
  const template = query<HTMLTemplateElement>(root, '[data-officer-template]');
  const storage = window.localStorage;

  const { supabase } = await requireStaff();
  let officers: RangeOfficer[] = [];

  async function load(): Promise<boolean> {
    const { data, error } = await supabase
      .from('range_officers')
      .select('id, full_name')
      .eq('is_active', true)
      // SPEC-007 AC-5, AC-18: tylko zatwierdzeni i nieukryci (do czasu #116 / #117).
      .eq('status', 'approved')
      .eq('hide_from_others', false)
      .order('full_name');
    if (error) return false;
    officers = ((data ?? []) as RangeOfficer[]).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pl'));
    return true;
  }

  function render(): void {
    const current = currentShiftOfficer(storage, officers);
    picker.hidden = Boolean(current);
    shift.hidden = !current;
    if (current) {
      officerName.textContent = current.full_name;
      return;
    }
    officersList.replaceChildren(
      ...officers.map((officer) => {
        const fragment = template.content.cloneNode(true) as DocumentFragment;
        const button = query<HTMLButtonElement>(fragment, '[data-officer]');
        button.textContent = officer.full_name;
        button.addEventListener('click', () => {
          saveShiftOfficer(storage, officer.id);
          render();
          change.focus();
        });
        return fragment;
      }),
    );
    noOfficers.hidden = officers.length > 0;
  }

  change.addEventListener('click', async () => {
    clearShiftOfficer(storage);
    // Świeża lista — prowadzący mógł zostać dodany lub ukryty w trakcie zmiany.
    if (!(await load())) return showLoadError();
    render();
    officersList.querySelector<HTMLButtonElement>('button')?.focus();
  });

  // Urządzenie zostawione na noc: po powrocie do karty nowego dnia trzeba ponownie wybrać prowadzącego.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });

  if (!(await load())) return showLoadError();
  render();
}
