/**
 * Wyspa listy słownikowej (DictionaryList.astro) — dyscypliny, kategorie wydarzeń, prowadzący strzelanie.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 * Zmiana nazwy i ukrycie/przywrócenie dyscypliny lub kategorii uruchamiają przebudowę strony publicznej (AC-29).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import {
  DICTIONARIES,
  dictionaryText,
  isUniqueViolation,
  sortItems,
  validateName,
  type DictionaryConfig,
  type DictionaryItem,
  type DictionaryKind,
  type NameError,
} from './dictionary';
import { requireAdmin, showLoadError } from './panel';
import { rebuildAndDescribe } from './site-rebuild';

function errorText(kind: DictionaryKind, config: DictionaryConfig, error: NameError | 'save'): string {
  if (error === 'duplicate' && kind !== 'officers') return t(`dictionary.${kind}.duplicate`);
  if (error === 'required') return dictionaryText(kind, 'required');
  if (error === 'tooShort') return dictionaryText(kind, 'tooShort', { min: config.min });
  if (error === 'tooLong') return dictionaryText(kind, 'tooLong', { max: config.max });
  return t('panel.saveError');
}

function setError(input: HTMLInputElement, output: HTMLElement, message: string | null): void {
  output.textContent = message ?? '';
  output.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountDictionary(root: HTMLElement): Promise<void> {
  const kind = root.dataset.kind as DictionaryKind;
  const config = DICTIONARIES[kind];
  const { table, column } = config;
  // Kolumna nazwy jako `name` (alias PostgREST) — ten sam kształt wiersza dla wszystkich list.
  const columns = `id, name:${column}, is_active` as 'id, name, is_active';
  const nameRow = (value: string) => ({ [column]: value }) as Partial<Record<DictionaryConfig['column'], string>>;
  const message = (error: NameError | 'save') => errorText(kind, config, error);
  const addForm = query<HTMLFormElement>(root, '[data-add-form]');
  const addInput = query<HTMLInputElement>(addForm, 'input[name="name"]');
  const addError = query<HTMLElement>(addForm, '[data-error]');
  const status = query<HTMLElement>(root, '[data-status]');
  const empty = query<HTMLElement>(root, '[data-empty]');
  const list = query<HTMLUListElement>(root, '[data-list]');
  const template = query<HTMLTemplateElement>(root, '[data-row-template]');

  const supabase: SupabaseClient = await requireAdmin();
  let items: DictionaryItem[] = [];

  const announce = (message: string) => {
    status.textContent = message;
  };

  /** Wspólny zapis: insert lub update jednego wiersza; zwraca zapisany wiersz albo rodzaj błędu. */
  async function save(
    request: PromiseLike<{ data: DictionaryItem | null; error: { code?: string } | null }>,
  ): Promise<DictionaryItem | NameError | 'save'> {
    try {
      const { data, error } = await request;
      if (isUniqueViolation(error)) return 'duplicate';
      if (error || !data) return 'save';
      return data;
    } catch {
      return 'save';
    }
  }

  async function upsertLocal(saved: DictionaryItem, rebuild = false): Promise<void> {
    items = [...items.filter((item) => item.id !== saved.id), saved];
    render();
    announce(rebuild && config.rebuild ? await rebuildAndDescribe(supabase, t('panel.saved')) : t('panel.saved'));
  }

  function renderItem(item: DictionaryItem): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const li = query<HTMLLIElement>(fragment, '[data-item]');
    const view = query<HTMLElement>(li, '[data-view]');
    const editForm = query<HTMLFormElement>(li, '[data-edit-form]');
    const editInput = query<HTMLInputElement>(editForm, 'input[name="name"]');
    const editError = query<HTMLElement>(editForm, '[data-error]');
    const state = query<HTMLElement>(li, '[data-state]');
    const toggle = query<HTMLButtonElement>(li, '[data-toggle]');
    const fieldId = `${root.id || table}-edit-${item.id}`;

    query<HTMLElement>(li, '[data-name]').textContent = item.name;
    for (const span of li.querySelectorAll<HTMLElement>('[data-sr-name]')) span.textContent = `: ${item.name}`;
    state.dataset.state = item.is_active ? 'active' : 'hidden';
    state.textContent = dictionaryText(kind, item.is_active ? 'active' : 'hidden');
    query<HTMLElement>(toggle, '[data-toggle-text]').textContent = item.is_active
      ? t('dictionary.hide')
      : t('dictionary.restore');
    editInput.id = fieldId;
    editError.id = `${fieldId}-error`;
    editInput.setAttribute('aria-describedby', editError.id);
    query<HTMLLabelElement>(editForm, '[data-edit-label]').htmlFor = fieldId;

    query<HTMLButtonElement>(li, '[data-rename]').addEventListener('click', () => {
      editInput.value = item.name;
      setError(editInput, editError, null);
      view.hidden = true;
      editForm.hidden = false;
      editInput.focus();
    });
    query<HTMLButtonElement>(editForm, '[data-cancel]').addEventListener('click', () => {
      editForm.hidden = true;
      view.hidden = false;
      query<HTMLButtonElement>(li, '[data-rename]').focus();
    });
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const invalid = validateName(editInput.value, items, item.id, config);
      if (invalid) return setError(editInput, editError, message(invalid));
      const result = await save(
        supabase.from(table).update(nameRow(editInput.value.trim())).eq('id', item.id).select(columns).single(),
      );
      if (typeof result === 'string') return setError(editInput, editError, message(result));
      await upsertLocal(result, true);
    });
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const result = await save(
        supabase.from(table).update({ is_active: !item.is_active }).eq('id', item.id).select(columns).single(),
      );
      toggle.disabled = false;
      if (typeof result === 'string') return announce(t('panel.saveError'));
      await upsertLocal(result, true);
    });
    return li;
  }

  function render(): void {
    list.replaceChildren(...sortItems(items).map(renderItem));
    empty.hidden = items.length > 0;
  }

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    announce('');
    const invalid = validateName(addInput.value, items, undefined, config);
    if (invalid) return setError(addInput, addError, message(invalid));
    setError(addInput, addError, null);
    const result = await save(
      supabase.from(table).insert(nameRow(addInput.value.trim())).select(columns).single(),
    );
    if (typeof result === 'string') return setError(addInput, addError, message(result));
    addInput.value = '';
    await upsertLocal(result);
  });

  const { data, error } = await supabase.from(table).select(columns).order(column);
  if (error) return showLoadError();
  items = (data ?? []) as DictionaryItem[];
  render();
}
