/**
 * Wyspa biblioteki regulaminów (`/panel/regulaminy/`, SPEC-001 AC-12…16).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 *
 * Wczytanie: walidacja pliku (typ, sygnatura `%PDF-`, ≤ 20 MB) → plik do Storage pod losową ścieżką
 * `rulebooks/<uuid>.pdf` → wiersz w `rulebooks`. Gdy zapis wiersza się nie uda, plik jest usuwany.
 * Usunięcie: najpierw wiersz (FK `restrict` chroni regulaminy używane przez zawody), potem plik.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { formatDate } from './dates';
import { requireOrganizer, showLoadError } from './panel';
import {
  PDF_MIME,
  RULEBOOK_TITLE_MAX,
  STORAGE_BUCKET,
  canDelete,
  fromRow,
  rulebookPath,
  sortRulebooks,
  uploadDay,
  validateFile,
  validateTitle,
  type FileError,
  type Rulebook,
  type TitleError,
} from './rulebooks';

const COLUMNS = 'id, title, file_path, file_size, is_archived, created_at, competitions(id)';
/** Naruszenie klucza obcego — regulamin w międzyczasie przypisano do zawodów. */
const FK_VIOLATION = '23503';

type Row = Parameters<typeof fromRow>[0];

function titleErrorText(error: TitleError | 'save'): string {
  if (error === 'required') return t('rulebooks.titleRequired');
  if (error === 'tooLong') return t('rulebooks.titleTooLong', { max: RULEBOOK_TITLE_MAX });
  return t('panel.saveError');
}

function fileErrorText(error: FileError): string {
  if (error === 'tooLarge') return t('rulebooks.fileTooLarge');
  if (error === 'notPdf') return t('rulebooks.fileNotPdf');
  return t('rulebooks.fileRequired');
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

async function readHead(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 5).arrayBuffer());
}

export async function mountRulebooks(root: HTMLElement): Promise<void> {
  const addForm = query<HTMLFormElement>(root, '[data-add-form]');
  const titleInput = query<HTMLInputElement>(addForm, 'input[name="title"]');
  const titleError = query<HTMLElement>(addForm, '[data-title-error]');
  const fileInput = query<HTMLInputElement>(addForm, 'input[name="file"]');
  const fileError = query<HTMLElement>(addForm, '[data-file-error]');
  const submit = query<HTMLButtonElement>(addForm, '[data-submit]');
  const status = query<HTMLElement>(root, '[data-status]');
  const empty = query<HTMLElement>(root, '[data-empty]');
  const list = query<HTMLUListElement>(root, '[data-list]');
  const template = query<HTMLTemplateElement>(root, '[data-row-template]');

  const supabase: SupabaseClient = await requireOrganizer();
  const storage = supabase.storage.from(STORAGE_BUCKET);
  let items: Rulebook[] = [];

  const announce = (message: string) => {
    status.textContent = message;
  };

  async function update(id: string, changes: Partial<Pick<Rulebook, 'title' | 'is_archived'>>): Promise<Rulebook | null> {
    try {
      const { data, error } = await supabase.from('rulebooks').update(changes).eq('id', id).select(COLUMNS).single();
      return error || !data ? null : fromRow(data as Row);
    } catch {
      return null;
    }
  }

  function upsertLocal(saved: Rulebook, message = t('panel.saved')): void {
    items = [...items.filter((item) => item.id !== saved.id), saved];
    render();
    announce(message);
  }

  async function remove(item: Rulebook): Promise<void> {
    if (!window.confirm(t('rulebooks.confirmDelete', { title: item.title }))) return;
    try {
      const { data, error } = await supabase.from('rulebooks').delete().eq('id', item.id).select('id');
      if (error?.code === FK_VIOLATION) return announce(t('rulebooks.inUse'));
      if (error || !data?.length) return announce(t('rulebooks.deleteError'));
    } catch {
      return announce(t('rulebooks.deleteError'));
    }
    // Wiersz usunięty; plik bez wiersza nie jest nigdzie linkowany, więc błąd tutaj nie blokuje.
    await storage.remove([item.file_path]).catch(() => undefined);
    items = items.filter((other) => other.id !== item.id);
    render();
    announce(t('rulebooks.deleted'));
  }

  function renderItem(item: Rulebook): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const li = query<HTMLLIElement>(fragment, '[data-item]');
    const view = query<HTMLElement>(li, '[data-view]');
    const editForm = query<HTMLFormElement>(li, '[data-edit-form]');
    const editInput = query<HTMLInputElement>(editForm, 'input[name="title"]');
    const editError = query<HTMLElement>(editForm, '[data-error]');
    const rename = query<HTMLButtonElement>(li, '[data-rename]');
    const toggle = query<HTMLButtonElement>(li, '[data-toggle]');
    const del = query<HTMLButtonElement>(li, '[data-delete]');
    const fieldId = `rulebook-edit-${item.id}`;

    query<HTMLElement>(li, '[data-title]').textContent = item.title;
    for (const span of li.querySelectorAll<HTMLElement>('[data-sr-title]')) span.textContent = `: ${item.title}`;
    query<HTMLElement>(li, '[data-archived]').hidden = !item.is_archived;
    query<HTMLElement>(li, '[data-uploaded]').textContent = t('rulebooks.uploadedOn', {
      date: formatDate(uploadDay(item.created_at)),
    });
    query<HTMLElement>(li, '[data-usage]').textContent = t('rulebooks.usage', { count: item.usage });
    query<HTMLAnchorElement>(li, '[data-download]').href = storage.getPublicUrl(item.file_path).data.publicUrl;
    query<HTMLElement>(toggle, '[data-toggle-text]').textContent = item.is_archived
      ? t('rulebooks.restore')
      : t('rulebooks.archive');
    del.hidden = !canDelete(item);
    editInput.id = fieldId;
    editError.id = `${fieldId}-error`;
    editInput.setAttribute('aria-describedby', editError.id);
    query<HTMLLabelElement>(editForm, '[data-edit-label]').htmlFor = fieldId;

    rename.addEventListener('click', () => {
      editInput.value = item.title;
      setError(editInput, editError, null);
      view.hidden = true;
      editForm.hidden = false;
      editInput.focus();
    });
    query<HTMLButtonElement>(editForm, '[data-cancel]').addEventListener('click', () => {
      editForm.hidden = true;
      view.hidden = false;
      rename.focus();
    });
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const invalid = validateTitle(editInput.value);
      if (invalid) return setError(editInput, editError, titleErrorText(invalid));
      const saved = await update(item.id, { title: editInput.value.trim() });
      if (!saved) return setError(editInput, editError, titleErrorText('save'));
      upsertLocal(saved);
    });
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const saved = await update(item.id, { is_archived: !item.is_archived });
      toggle.disabled = false;
      if (!saved) return announce(t('panel.saveError'));
      upsertLocal(saved);
    });
    del.addEventListener('click', () => void remove(item));
    return li;
  }

  function render(): void {
    list.replaceChildren(...sortRulebooks(items).map(renderItem));
    empty.hidden = items.length > 0;
  }

  async function upload(title: string, file: File): Promise<Rulebook | null> {
    const id = crypto.randomUUID();
    const path = rulebookPath(id);
    try {
      const uploaded = await storage.upload(path, file, { contentType: PDF_MIME, upsert: false });
      if (uploaded.error) return null;
      const { data, error } = await supabase
        .from('rulebooks')
        .insert({ id, title, file_path: path, file_size: file.size })
        .select(COLUMNS)
        .single();
      if (error || !data) {
        await storage.remove([path]).catch(() => undefined);
        return null;
      }
      return fromRow(data as Row);
    } catch {
      await storage.remove([path]).catch(() => undefined);
      return null;
    }
  }

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    announce('');
    const file = fileInput.files?.[0] ?? null;
    const titleInvalid = validateTitle(titleInput.value);
    const head = file && file.size > 0 ? await readHead(file).catch(() => new Uint8Array()) : undefined;
    const fileInvalid = validateFile(file, head);
    setError(titleInput, titleError, titleInvalid ? titleErrorText(titleInvalid) : null);
    setError(fileInput, fileError, fileInvalid ? fileErrorText(fileInvalid) : null);
    if (titleInvalid) return titleInput.focus();
    if (fileInvalid || !file) return fileInput.focus();

    submit.disabled = true;
    announce(t('rulebooks.uploading'));
    const saved = await upload(titleInput.value.trim(), file);
    submit.disabled = false;
    if (!saved) return announce(t('panel.saveError'));
    addForm.reset();
    upsertLocal(saved);
  });

  const { data, error } = await supabase.from('rulebooks').select(COLUMNS).order('created_at', { ascending: false });
  if (error) return showLoadError();
  items = ((data ?? []) as Row[]).map(fromRow);
  render();
}
