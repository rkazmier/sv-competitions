/**
 * Wyspa formularza zawodów (`/panel/zawody/nowe/`, `/panel/zawody/edytuj/?id=`, SPEC-001 AC-17…23).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` / `option.text` (bez HTML).
 *
 * Matchbook: nowy plik do Storage (`matchbooks/<id>/<uuid>.pdf`) → `matchbook_path` → usunięcie starego pliku.
 * Usuwanie zawodów: najpierw wiersz (RLS: tylko szkic; harmonogram kaskadowo), potem pliki z `matchbooks/<id>/`.
 * Publikacja (AC-25…28): „Opublikuj” zapisuje formularz ze stanem `published`; każda zmiana opublikowanych
 * zawodów (także matchbook i harmonogram) uruchamia przebudowę strony publicznej (AC-29, lib/site-rebuild.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import {
  COMPETITION_DESCRIPTION_MAX,
  COMPETITION_NAME_MAX,
  SCHEDULE_DESCRIPTION_MAX,
  disciplineOptions,
  formatTime,
  isRulebookRequiredError,
  isScheduleRangeError,
  itemsOutOfRange,
  matchbookPath,
  needsRulebook,
  rulebookOptions,
  sortSchedule,
  toRow,
  validateCompetition,
  validateScheduleItem,
  type CompetitionErrors,
  type CompetitionInput,
  type DisciplineOption,
  type RulebookOption,
  type ScheduleItem,
  type ScheduleItemError,
} from './competitions';
import { formatDate } from './dates';
import { requireOrganizer, showLoadError } from './panel';
import { PDF_MIME, STORAGE_BUCKET, uploadDay, validateFile, type FileError } from './rulebooks';
import { rebuildAndDescribe } from './site-rebuild';

// Kolumny jawnie: `created_by` nie jest udostępniany klientom (docs/architecture.md).
const COLUMNS = 'id, name, discipline_id, starts_on, ends_on, description, rulebook_id, matchbook_path, status';
const ITEM_COLUMNS = 'id, day, time, description, position';
const EDIT_URL = '/panel/zawody/edytuj/';
const PREVIEW_URL = '/panel/zawody/podglad/';

interface Competition {
  id: string;
  name: string;
  discipline_id: string;
  starts_on: string;
  ends_on: string | null;
  description: string | null;
  rulebook_id: string | null;
  matchbook_path: string | null;
  status: 'draft' | 'published';
}

const FIELD_ERRORS: Record<string, string> = {
  'name.required': t('competition.nameRequired'),
  'name.tooLong': t('competition.nameTooLong', { max: COMPETITION_NAME_MAX }),
  'discipline_id.required': t('competition.disciplineRequired'),
  'starts_on.required': t('competition.startsOnRequired'),
  'ends_on.endBeforeStart': t('competition.endBeforeStart'),
  'description.tooLong': t('competition.descriptionTooLong', { max: COMPETITION_DESCRIPTION_MAX }),
};

const ITEM_ERRORS: Record<ScheduleItemError, string> = {
  dayRequired: t('schedule.dayRequired'),
  dayOutOfRange: t('schedule.dayOutOfRange'),
  descriptionRequired: t('schedule.descriptionRequired'),
  descriptionTooLong: t('schedule.descriptionTooLong', { max: SCHEDULE_DESCRIPTION_MAX }),
};

const FILE_ERRORS: Record<FileError, string> = {
  required: t('rulebooks.fileRequired'),
  notPdf: t('rulebooks.fileNotPdf'),
  tooLarge: t('rulebooks.fileTooLarge'),
};

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function setError(output: HTMLElement, message: string | null, input?: HTMLElement): void {
  output.textContent = message ?? '';
  output.hidden = !message;
  if (!input) return;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function fillSelect(select: HTMLSelectElement, options: { value: string; text: string }[], value: string): void {
  const placeholder = select.options[0];
  select.replaceChildren(placeholder, ...options.map((o) => new Option(o.text, o.value)));
  select.value = value;
}

export async function mountCompetitionForm(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-form]');
  const status = query<HTMLElement>(root, '[data-status]');
  const statusTag = query<HTMLElement>(root, '[data-status-tag]');
  const field = (name: keyof CompetitionInput | 'rulebook_id') =>
    query<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(form, `[name="${name}"]`);
  const announce = (message: string) => {
    status.textContent = message;
  };
  const rulebookError = query<HTMLElement>(form, '[data-rulebook-error]');
  const publishButton = query<HTMLButtonElement>(form, '[data-publish]');
  const unpublishButton = query<HTMLButtonElement>(form, '[data-unpublish]');

  const supabase: SupabaseClient = await requireOrganizer();
  const storage = supabase.storage.from(STORAGE_BUCKET);
  const id = root.dataset.competition === 'edit' ? new URLSearchParams(window.location.search).get('id') : null;
  let competition: Competition | null = null;
  let items: ScheduleItem[] = [];

  const [comp, disciplines, rulebooks, schedule] = await Promise.all([
    id ? supabase.from('competitions').select(COLUMNS).eq('id', id).maybeSingle() : { data: null, error: null },
    supabase.from('disciplines').select('id, name, is_active'),
    supabase.from('rulebooks').select('id, title, is_archived, created_at'),
    id ? supabase.from('schedule_items').select(ITEM_COLUMNS).eq('competition_id', id) : { data: [], error: null },
  ]);
  if (comp.error || disciplines.error || rulebooks.error || schedule.error) return showLoadError();
  if (root.dataset.competition === 'edit' && !comp.data) {
    form.hidden = true;
    query<HTMLElement>(root, '[data-not-found]').hidden = false;
    return;
  }
  competition = comp.data as Competition | null;
  items = (schedule.data ?? []) as ScheduleItem[];

  function fillForm(): void {
    const c = competition;
    fillSelect(
      field('discipline_id') as HTMLSelectElement,
      disciplineOptions((disciplines.data ?? []) as DisciplineOption[], c?.discipline_id).map((d) => ({
        value: d.id,
        text: d.is_active ? d.name : `${d.name}${t('competition.hiddenSuffix')}`,
      })),
      c?.discipline_id ?? '',
    );
    fillSelect(
      field('rulebook_id') as HTMLSelectElement,
      rulebookOptions((rulebooks.data ?? []) as RulebookOption[], c?.rulebook_id).map((r) => ({
        value: r.id,
        text:
          t('competition.rulebookOption', { title: r.title, date: formatDate(uploadDay(r.created_at)) }) +
          (r.is_archived ? t('competition.archivedSuffix') : ''),
      })),
      c?.rulebook_id ?? '',
    );
    if (!c) return;
    field('name').value = c.name;
    field('starts_on').value = c.starts_on;
    field('ends_on').value = c.ends_on ?? '';
    field('description').value = c.description ?? '';
    const preview = query<HTMLAnchorElement>(form, '[data-preview]');
    preview.href = `${PREVIEW_URL}?id=${encodeURIComponent(c.id)}`;
    preview.hidden = false;
    statusTag.hidden = false;
    statusTag.textContent = c.status === 'published' ? t('entries.statusPublished') : t('entries.statusDraft');
    for (const section of root.querySelectorAll<HTMLElement>('[data-matchbook], [data-schedule], [data-danger]')) {
      section.hidden = false;
    }
    const published = c.status === 'published';
    publishButton.hidden = published;
    unpublishButton.hidden = !published;
    query<HTMLElement>(root, '[data-delete]').hidden = published;
    query<HTMLElement>(root, '[data-delete-hint]').hidden = published;
    query<HTMLElement>(root, '[data-published-hint]').hidden = !published;
    renderMatchbook();
    resetItemForm();
    renderSchedule();
  }

  // ===== Zawody (AC-17, AC-18, AC-22) =====

  function readInput(): CompetitionInput {
    return {
      name: field('name').value,
      discipline_id: field('discipline_id').value,
      starts_on: field('starts_on').value,
      ends_on: field('ends_on').value,
      description: field('description').value,
    };
  }

  function showFieldErrors(errors: CompetitionErrors): void {
    for (const output of form.querySelectorAll<HTMLElement>('[data-error-for]')) {
      const name = output.dataset.errorFor as keyof CompetitionErrors;
      const code = errors[name];
      setError(output, code ? FIELD_ERRORS[`${name}.${code}`] : null, field(name));
    }
  }

  function showRulebookError(show: boolean): void {
    setError(rulebookError, show ? t('competition.rulebookRequired') : null, field('rulebook_id'));
  }

  /** Po zmianie opublikowanych zawodów: przebudowa strony i komunikat AC-25 / §7 (AC-28, AC-29). */
  async function announceChange(message: string, rebuild = competition?.status === 'published'): Promise<void> {
    announce(rebuild ? await rebuildAndDescribe(supabase, message) : message);
  }

  /** Zapis formularza; `publish` = „Opublikuj” (AC-25, AC-26), inaczej „Zapisz” (AC-17, AC-28). */
  async function save(publish: boolean, button: HTMLButtonElement): Promise<void> {
    announce('');
    const input = readInput();
    showFieldErrors(validateCompetition(input));
    const nextStatus = publish ? 'published' : (competition?.status ?? 'draft');
    const missingRulebook = needsRulebook(nextStatus, field('rulebook_id').value);
    showRulebookError(missingRulebook);
    const firstInvalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstInvalid) {
      const onlyRulebook = missingRulebook && firstInvalid === field('rulebook_id');
      announce(onlyRulebook ? t('competition.rulebookRequired') : t('competition.fixErrors'));
      return firstInvalid.focus();
    }
    const outside = itemsOutOfRange(items, input.starts_on, input.ends_on || null);
    renderSchedule(outside);
    if (outside.length) return announce(t('schedule.dayOutOfRange'));

    button.disabled = true;
    const wasPublished = competition?.status === 'published';
    const row = { ...toRow(input, field('rulebook_id').value), ...(publish ? { status: nextStatus } : {}) };
    try {
      const { data, error } = competition
        ? await supabase.from('competitions').update(row).eq('id', competition.id).select(COLUMNS).single()
        : await supabase.from('competitions').insert(row).select(COLUMNS).single();
      if (error || !data) {
        if (isScheduleRangeError(error)) return announce(t('schedule.dayOutOfRange'));
        if (isRulebookRequiredError(error)) {
          showRulebookError(true);
          return announce(t('competition.rulebookRequired'));
        }
        if (error?.code === '23514') return showFieldErrors({ ends_on: 'endBeforeStart' });
        return announce(t('panel.saveError'));
      }
      if (!competition) {
        window.location.assign(`${EDIT_URL}?id=${encodeURIComponent((data as Competition).id)}&saved=1`);
        return;
      }
      competition = data as Competition;
      fillForm();
      await announceChange(publish ? t('competition.published') : t('panel.saved'), publish || wasPublished);
    } catch {
      announce(t('panel.saveError'));
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(false, query<HTMLButtonElement>(form, '[data-save]'));
  });
  publishButton.addEventListener('click', () => void save(true, publishButton));

  // AC-27: cofnięcie publikacji z potwierdzeniem; strona publiczna znika po przebudowie.
  unpublishButton.addEventListener('click', async () => {
    if (!competition || competition.status !== 'published') return;
    if (!window.confirm(t('competition.confirmUnpublish', { name: competition.name }))) return;
    announce('');
    unpublishButton.disabled = true;
    try {
      const { data, error } = await supabase
        .from('competitions')
        .update({ status: 'draft' })
        .eq('id', competition.id)
        .select(COLUMNS)
        .single();
      if (error || !data) return announce(t('panel.saveError'));
      competition = data as Competition;
      fillForm();
      await announceChange(t('competition.unpublished'), true);
    } catch {
      announce(t('panel.saveError'));
    } finally {
      unpublishButton.disabled = false;
    }
  });

  // ===== Matchbook (AC-20) =====

  const matchbookForm = query<HTMLFormElement>(root, '[data-matchbook-form]');
  const matchbookInput = query<HTMLInputElement>(matchbookForm, 'input[name="file"]');
  const matchbookError = query<HTMLElement>(matchbookForm, '[data-matchbook-error]');

  function renderMatchbook(): void {
    const path = competition?.matchbook_path;
    query<HTMLElement>(root, '[data-matchbook-none]').hidden = Boolean(path);
    query<HTMLElement>(root, '[data-matchbook-current]').hidden = !path;
    if (path) query<HTMLAnchorElement>(root, '[data-matchbook-link]').href = storage.getPublicUrl(path).data.publicUrl;
    query<HTMLElement>(matchbookForm, '[data-matchbook-submit]').textContent = path
      ? t('matchbook.replace')
      : t('matchbook.upload');
  }

  async function setMatchbook(path: string | null): Promise<boolean> {
    if (!competition) return false;
    const old = competition.matchbook_path;
    const { data, error } = await supabase
      .from('competitions')
      .update({ matchbook_path: path })
      .eq('id', competition.id)
      .select(COLUMNS)
      .single();
    if (error || !data) return false;
    competition = data as Competition;
    if (old) await storage.remove([old]).catch(() => undefined);
    renderMatchbook();
    return true;
  }

  matchbookForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!competition) return;
    const file = matchbookInput.files?.[0] ?? null;
    const head = file && file.size > 0 ? new Uint8Array(await file.slice(0, 5).arrayBuffer()) : undefined;
    const invalid = validateFile(file, head);
    setError(matchbookError, invalid ? FILE_ERRORS[invalid] : null, matchbookInput);
    if (invalid || !file) return matchbookInput.focus();

    const submit = query<HTMLButtonElement>(matchbookForm, '[data-matchbook-submit]');
    submit.disabled = true;
    announce(t('matchbook.uploading'));
    const path = matchbookPath(competition.id, crypto.randomUUID());
    const ok = await storage
      .upload(path, file, { contentType: PDF_MIME, upsert: false })
      .then(async (uploaded) => !uploaded.error && (await setMatchbook(path)))
      .catch(() => false);
    submit.disabled = false;
    if (!ok) {
      await storage.remove([path]).catch(() => undefined);
      return announce(t('panel.saveError'));
    }
    matchbookForm.reset();
    await announceChange(t('panel.saved'));
  });

  query<HTMLButtonElement>(root, '[data-matchbook-remove]').addEventListener('click', async () => {
    if (!window.confirm(t('matchbook.confirmRemove'))) return;
    const ok = await setMatchbook(null).catch(() => false);
    if (!ok) return announce(t('panel.saveError'));
    await announceChange(t('matchbook.removed'));
  });

  // ===== Harmonogram (AC-21, AC-22) =====

  const itemForm = query<HTMLFormElement>(root, '[data-item-form]');
  const itemError = query<HTMLElement>(itemForm, '[data-item-error]');
  const itemSubmit = query<HTMLButtonElement>(itemForm, '[data-item-submit]');
  const itemCancel = query<HTMLButtonElement>(itemForm, '[data-item-cancel]');
  const itemField = (name: 'day' | 'time' | 'description') => query<HTMLInputElement>(itemForm, `[name="${name}"]`);
  const body = query<HTMLElement>(root, '[data-schedule-body]');
  const rowTemplate = query<HTMLTemplateElement>(root, '[data-schedule-row]');
  let editingId: string | null = null;

  function resetItemForm(): void {
    editingId = null;
    itemForm.reset();
    if (competition) {
      itemField('day').value = competition.starts_on;
      itemField('day').min = competition.starts_on;
      itemField('day').max = competition.ends_on ?? competition.starts_on;
    }
    setError(itemError, null, itemField('day'));
    query<HTMLElement>(itemForm, '[data-item-heading]').textContent = t('schedule.addHeading');
    itemSubmit.textContent = t('schedule.add');
    itemCancel.hidden = true;
  }

  function startEdit(item: ScheduleItem): void {
    editingId = item.id;
    itemField('day').value = item.day;
    itemField('time').value = formatTime(item.time);
    itemField('description').value = item.description;
    query<HTMLElement>(itemForm, '[data-item-heading]').textContent = t('schedule.editHeading');
    itemSubmit.textContent = t('schedule.save');
    itemCancel.hidden = false;
    itemField('description').focus();
  }

  function renderSchedule(invalidIds: readonly string[] = []): void {
    const sorted = sortSchedule(items);
    query<HTMLElement>(root, '[data-schedule-empty]').hidden = sorted.length > 0;
    query<HTMLElement>(root, '[data-schedule-table]').hidden = sorted.length === 0;
    body.replaceChildren(
      ...sorted.map((item) => {
        const fragment = rowTemplate.content.cloneNode(true) as DocumentFragment;
        const tr = query<HTMLTableRowElement>(fragment, '[data-row]');
        query<HTMLElement>(tr, '[data-day]').textContent = formatDate(item.day);
        query<HTMLElement>(tr, '[data-time]').textContent = formatTime(item.time);
        query<HTMLElement>(tr, '[data-description]').textContent = item.description;
        query<HTMLElement>(tr, '[data-row-error]').hidden = !invalidIds.includes(item.id);
        for (const sr of tr.querySelectorAll<HTMLElement>('[data-sr]')) sr.textContent = `: ${item.description}`;
        query<HTMLButtonElement>(tr, '[data-edit]').addEventListener('click', () => startEdit(item));
        query<HTMLButtonElement>(tr, '[data-remove]').addEventListener('click', () => void removeItem(item));
        return tr;
      }),
    );
  }

  async function removeItem(item: ScheduleItem): Promise<void> {
    if (!window.confirm(t('schedule.confirmDelete', { description: item.description }))) return;
    const { data, error } = await supabase.from('schedule_items').delete().eq('id', item.id).select('id');
    if (error || !data?.length) return announce(t('panel.saveError'));
    items = items.filter((other) => other.id !== item.id);
    if (editingId === item.id) resetItemForm();
    renderSchedule();
    await announceChange(t('schedule.deleted'));
  }

  itemCancel.addEventListener('click', resetItemForm);
  itemForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!competition) return;
    const draft = {
      day: itemField('day').value,
      time: itemField('time').value || null,
      description: itemField('description').value,
    };
    const invalid = validateScheduleItem(draft, competition.starts_on, competition.ends_on);
    setError(itemError, invalid ? ITEM_ERRORS[invalid] : null, itemField(invalid?.startsWith('day') ? 'day' : 'description'));
    if (invalid) return;

    const row = { ...draft, description: draft.description.trim() };
    itemSubmit.disabled = true;
    try {
      const { data, error } = editingId
        ? await supabase.from('schedule_items').update(row).eq('id', editingId).select(ITEM_COLUMNS).single()
        : await supabase
            .from('schedule_items')
            .insert({ ...row, competition_id: competition.id })
            .select(ITEM_COLUMNS)
            .single();
      if (error || !data) {
        return setError(itemError, isScheduleRangeError(error) ? ITEM_ERRORS.dayOutOfRange : t('panel.saveError'));
      }
      const saved = data as ScheduleItem;
      items = [...items.filter((other) => other.id !== saved.id), saved];
      resetItemForm();
      renderSchedule();
      await announceChange(t('panel.saved'));
    } catch {
      setError(itemError, t('panel.saveError'));
    } finally {
      itemSubmit.disabled = false;
    }
  });

  // ===== Usuwanie szkicu (AC-23) =====

  query<HTMLButtonElement>(root, '[data-delete]').addEventListener('click', async () => {
    if (!competition || competition.status !== 'draft') return;
    if (!window.confirm(t('competition.confirmDelete', { name: competition.name }))) return;
    try {
      const { data, error } = await supabase.from('competitions').delete().eq('id', competition.id).select('id');
      if (error || !data?.length) return announce(t('competition.deleteError'));
    } catch {
      return announce(t('competition.deleteError'));
    }
    // Wiersz usunięty (harmonogram kaskadowo); pliki z folderu zawodów, także ewentualne osierocone.
    const folder = `matchbooks/${competition.id}`;
    const { data: files } = await storage.list(folder).catch(() => ({ data: null }));
    const paths = new Set((files ?? []).map((file) => `${folder}/${file.name}`));
    if (competition.matchbook_path) paths.add(competition.matchbook_path);
    if (paths.size) await storage.remove([...paths]).catch(() => undefined);
    window.location.assign('/panel/');
  });

  fillForm();
  if (new URLSearchParams(window.location.search).has('saved')) {
    announce(t('panel.saved'));
    window.history.replaceState(null, '', `${EDIT_URL}?id=${encodeURIComponent(competition?.id ?? '')}`);
  }
}
