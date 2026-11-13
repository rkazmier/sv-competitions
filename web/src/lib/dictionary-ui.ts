/**
 * Wyspa listy słownikowej (DictionaryList.astro) — dyscypliny i kategorie wydarzeń.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import {
  DICTIONARY_NAME_MAX,
  isUniqueViolation,
  sortItems,
  validateName,
  type DictionaryItem,
  type DictionaryTable,
  type NameError,
} from './dictionary';
import { requireOrganizer, showLoadError } from './panel';

type Kind = 'disciplines' | 'categories';
const COLUMNS = 'id, name, is_active';

function errorText(kind: Kind, error: NameError | 'save'): string {
  if (error === 'duplicate') return t(`dictionary.${kind}.duplicate`);
  if (error === 'required') return t('dictionary.required');
  if (error === 'tooLong') return t('dictionary.tooLong', { max: DICTIONARY_NAME_MAX });
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
  const table = root.dataset.dictionary as DictionaryTable;
  const kind = root.dataset.kind as Kind;
  const addForm = query<HTMLFormElement>(root, '[data-add-form]');
  const addInput = query<HTMLInputElement>(addForm, 'input[name="name"]');
  const addError = query<HTMLElement>(addForm, '[data-error]');
  const status = query<HTMLElement>(root, '[data-status]');
  const empty = query<HTMLElement>(root, '[data-empty]');
  const list = query<HTMLUListElement>(root, '[data-list]');
  const template = query<HTMLTemplateElement>(root, '[data-row-template]');

  const supabase: SupabaseClient = await requireOrganizer();
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

  function upsertLocal(saved: DictionaryItem): void {
    items = [...items.filter((item) => item.id !== saved.id), saved];
    render();
    announce(t('panel.saved'));
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
    state.textContent = item.is_active ? t('dictionary.active') : t('dictionary.hidden');
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
      const invalid = validateName(editInput.value, items, item.id);
      if (invalid) return setError(editInput, editError, errorText(kind, invalid));
      const result = await save(
        supabase.from(table).update({ name: editInput.value.trim() }).eq('id', item.id).select(COLUMNS).single(),
      );
      if (typeof result === 'string') return setError(editInput, editError, errorText(kind, result));
      upsertLocal(result);
    });
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const result = await save(
        supabase.from(table).update({ is_active: !item.is_active }).eq('id', item.id).select(COLUMNS).single(),
      );
      toggle.disabled = false;
      if (typeof result === 'string') return announce(t('panel.saveError'));
      upsertLocal(result);
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
    const invalid = validateName(addInput.value, items);
    if (invalid) return setError(addInput, addError, errorText(kind, invalid));
    setError(addInput, addError, null);
    const result = await save(supabase.from(table).insert({ name: addInput.value.trim() }).select(COLUMNS).single());
    if (typeof result === 'string') return setError(addInput, addError, errorText(kind, result));
    addInput.value = '';
    upsertLocal(result);
  });

  const { data, error } = await supabase.from(table).select(COLUMNS).order('name');
  if (error) return showLoadError();
  items = (data ?? []) as DictionaryItem[];
  render();
}
