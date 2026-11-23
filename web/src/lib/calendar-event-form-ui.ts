/**
 * Wyspa formularza wydarzenia (`/panel/wydarzenia/nowe/`, `/panel/wydarzenia/edytuj/?id=`, SPEC-001 US-11, AC-48…53).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` / `option.text` (bez HTML).
 *
 * Przebudowa strony publicznej (AC-29, lib/site-rebuild.ts): po publikacji, cofnięciu publikacji,
 * zapisie opublikowanego wydarzenia (także zmiana flagi blokady karnetów, SPEC-012 AC-40) i usunięciu
 * opublikowanego wydarzenia. Zmiany szkicu jej nie uruchamiają,
 * podobnie jak zmiana samego dyżurnego Prowadzącego (pole niepubliczne, SPEC-007 AC-30).
 *
 * SPEC-012 US-5: „Odwołaj wydarzenie” i „Zwroty po odwołaniu” — lib/event-cancel-ui.ts; odwołane wydarzenie (AC-29)
 * ma zablokowane pola poza opisem i powodem odwołania, bez publikacji i usuwania.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { renderEventCard } from './calendar-card-ui';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  eventCheckError,
  previewEntry,
  toEventRow,
  validateCalendarEvent,
  type CalendarEventErrors,
  type CalendarEventField,
  type AccessMode,
  type CalendarEventInput,
  type EventStatus,
} from './calendar-events';
import { calendarDutyError, needsRebuild } from './calendar-duty';
import { mountDutyField } from './calendar-duty-ui';
import { isCancelReasonValid } from './event-cancel';
import { mountEventCancel } from './event-cancel-ui';
import { disciplineOptions, type DisciplineOption } from './competitions';
import { requireAdmin, showLoadError } from './panel';
import { priceInputValue } from './products';
import { rebuildAndDescribe } from './site-rebuild';

// Kolumny jawnie: `created_by` nie jest udostępniany klientom (docs/architecture.md).
const COLUMNS =
  'id, name, category_id, starts_on, ends_on, description, external_url, status, access_mode, ticket_price, capacity, blocks_passes, cancelled_at, cancel_reason';
const EDIT_URL = '/panel/wydarzenia/edytuj/';
const FIELDS: CalendarEventField[] = [
  'name',
  'category_id',
  'starts_on',
  'ends_on',
  'description',
  'access_mode',
  'ticket_price',
  'capacity',
  'external_url',
];

interface CalendarEvent {
  id: string;
  name: string;
  category_id: string;
  starts_on: string;
  ends_on: string | null;
  description: string | null;
  external_url: string | null;
  status: EventStatus;
  access_mode: AccessMode;
  ticket_price: number | null;
  capacity: number | null;
  blocks_passes: boolean;
  /** SPEC-012 US-5: odwołanie (publiczny powód) */
  cancelled_at: string | null;
  cancel_reason: string | null;
}

const FIELD_ERRORS: Record<string, string> = {
  'name.required': t('calendarEvent.nameRequired'),
  'name.tooLong': t('calendarEvent.nameTooLong', { max: EVENT_NAME_MAX }),
  'category_id.required': t('calendarEvent.categoryRequired'),
  'starts_on.required': t('calendarEvent.startsOnRequired'),
  'ends_on.endBeforeStart': t('calendarEvent.endBeforeStart'),
  'description.tooLong': t('calendarEvent.descriptionTooLong', { max: EVENT_DESCRIPTION_MAX }),
  'external_url.invalidUrl': t('calendarEvent.urlInvalid'),
  'external_url.urlRequired': t('calendarEvent.urlRequired'),
  'ticket_price.required': t('calendarEvent.priceRequired'),
  'ticket_price.invalid': t('calendarEvent.priceInvalid'),
  'capacity.invalid': t('calendarEvent.capacityInvalid'),
  'capacity.belowSold': t('calendarEvent.capacityBelowSold'),
  'access_mode.hasTickets': t('calendarEvent.hasTickets'),
};

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountCalendarEventForm(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-form]');
  const status = query<HTMLElement>(root, '[data-status]');
  const statusTag = query<HTMLElement>(root, '[data-status-tag]');
  const publishButton = query<HTMLButtonElement>(form, '[data-publish]');
  const unpublishButton = query<HTMLButtonElement>(form, '[data-unpublish]');
  const deleteButton = query<HTMLButtonElement>(root, '[data-delete]');
  const card = query<HTMLElement>(root, '[data-calendar-card]');
  const field = (name: CalendarEventField) =>
    query<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(form, `[name="${name}"]`);
  const modeList = () => form.elements.namedItem('access_mode') as RadioNodeList;
  const paidFields = query<HTMLElement>(form, '[data-paid-fields]');
  const blocksPasses = query<HTMLInputElement>(form, '[name="blocks_passes"]');
  const announce = (message: string) => {
    status.textContent = message;
  };

  const supabase: SupabaseClient = await requireAdmin();
  const cancelReason = query<HTMLTextAreaElement>(form, '[name="cancel_reason"]');
  const cancelReasonError = query<HTMLElement>(form, '[data-error-for="cancel_reason"]');
  const eventCancel = mountEventCancel({
    root,
    supabase,
    announce,
    onCancelled: async (message) => {
      if (!event) return;
      const { data } = await supabase.from('calendar_events').select(COLUMNS).eq('id', event.id).maybeSingle();
      if (data) event = data as CalendarEvent;
      fillForm();
      // SPEC-012 AC-24: odwołanie zmienia kalendarz publiczny — przebudowa.
      await announceChange(message, true);
    },
  });
  const isEdit = root.dataset.calendarEvent === 'edit';
  const id = isEdit ? new URLSearchParams(window.location.search).get('id') : null;
  const duty = mountDutyField(query<HTMLElement>(form, '[data-duty-field]'), supabase, 'event');

  const [loaded, categories, dutyLoaded] = await Promise.all([
    id ? supabase.from('calendar_events').select(COLUMNS).eq('id', id).maybeSingle() : { data: null, error: null },
    supabase.from('event_categories').select('id, name, is_active'),
    duty.load(id),
  ]);
  if (loaded.error || categories.error || !dutyLoaded) return showLoadError();
  if (isEdit && !loaded.data) {
    form.hidden = true;
    query<HTMLElement>(root, '[data-preview]').hidden = true;
    query<HTMLElement>(root, '[data-not-found]').hidden = false;
    return;
  }
  let event = loaded.data as CalendarEvent | null;
  /** Pola publiczne zapisanego wydarzenia — do decyzji o przebudowie (AC-30). */
  let savedRow: ReturnType<typeof toEventRow> | null = null;
  const allCategories = (categories.data ?? []) as DisciplineOption[];
  const categoryName = (categoryId: string) => allCategories.find((c) => c.id === categoryId)?.name;

  function readInput(): CalendarEventInput {
    return {
      name: field('name').value,
      category_id: field('category_id').value,
      starts_on: field('starts_on').value,
      ends_on: field('ends_on').value,
      description: field('description').value,
      external_url: field('external_url').value,
      access_mode: (modeList().value || 'external') as AccessMode,
      ticket_price: field('ticket_price').value,
      capacity: field('capacity').value,
      blocks_passes: blocksPasses.checked,
    };
  }

  // AC-53: podgląd karty pod formularzem, aktualizowany przy każdej zmianie.
  function renderPreview(): void {
    const input = readInput();
    paidFields.hidden = input.access_mode !== 'paid';
    const entry = previewEntry(input, categoryName(input.category_id));
    renderEventCard(card, entry);
    query<HTMLElement>(root, '[data-preview-empty]').hidden = Boolean(entry);
  }

  function fillForm(): void {
    // AC-48 + §7: aktywne kategorie i bieżąca (także ukryta), alfabetycznie.
    const select = field('category_id') as HTMLSelectElement;
    const options = disciplineOptions(allCategories, event?.category_id);
    select.replaceChildren(
      select.options[0],
      ...options.map((c) => new Option(c.is_active ? c.name : `${c.name}${t('calendarEvent.hiddenSuffix')}`, c.id)),
    );
    query<HTMLElement>(form, '[data-no-categories]').hidden = options.length > 0;
    if (event) {
      select.value = event.category_id;
      field('name').value = event.name;
      field('starts_on').value = event.starts_on;
      field('ends_on').value = event.ends_on ?? '';
      field('description').value = event.description ?? '';
      field('external_url').value = event.external_url ?? '';
      modeList().value = event.access_mode;
      field('ticket_price').value = event.ticket_price ? priceInputValue(event.ticket_price) : '';
      field('capacity').value = event.capacity ? String(event.capacity) : '';
      blocksPasses.checked = event.blocks_passes;
      const published = event.status === 'published';
      const cancelled = Boolean(event.cancelled_at);
      statusTag.hidden = false;
      statusTag.textContent = cancelled
        ? t('eventCancel.tag')
        : published ? t('entries.statusPublished') : t('entries.statusDraft');
      publishButton.hidden = published || cancelled;
      unpublishButton.hidden = !published || cancelled;
      // SPEC-012 AC-29: odwołane — bez usuwania; edycja tylko opisu i powodu odwołania.
      query<HTMLElement>(root, '[data-danger]').hidden = cancelled;
      query<HTMLElement>(root, '[data-cancelled-info]').hidden = !cancelled;
      query<HTMLElement>(form, '[data-cancel-reason-field]').hidden = !cancelled;
      cancelReason.value = event.cancel_reason ?? '';
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      )) {
        // Odwołanie jest nieodwracalne — pól nie trzeba ponownie włączać.
        if (cancelled && control.name !== 'description' && control.name !== 'cancel_reason') control.disabled = true;
      }
      savedRow = toEventRow(readInput());
    }
    renderPreview();
    void eventCancel.render(event);
  }

  /** SPEC-012 AC-29: zapis odwołanego wydarzenia — tylko opis i powód odwołania (oba publiczne → przebudowa). */
  async function saveCancelled(current: CalendarEvent, button: HTMLButtonElement): Promise<void> {
    announce('');
    const description = field('description').value.trim();
    const reasonOk = isCancelReasonValid(cancelReason.value);
    cancelReasonError.textContent = reasonOk ? '' : t('eventCancel.reasonInvalid');
    cancelReasonError.hidden = reasonOk;
    const descriptionOk = [...description].length <= EVENT_DESCRIPTION_MAX;
    showErrors(descriptionOk ? {} : { description: 'tooLong' });
    if (!reasonOk || !descriptionOk) {
      announce(t('calendarEvent.fixErrors'));
      return (reasonOk ? field('description') : cancelReason).focus();
    }
    const row = { description: description || null, cancel_reason: cancelReason.value.trim() };
    const changed = row.description !== current.description || row.cancel_reason !== current.cancel_reason;
    button.disabled = true;
    try {
      const { data, error } = await supabase.from('calendar_events').update(row).eq('id', current.id).select(COLUMNS).single();
      if (error || !data) return announce(t('panel.saveError'));
      event = data as CalendarEvent;
      fillForm();
      await announceChange(t('panel.saved'), changed);
    } catch {
      announce(t('panel.saveError'));
    } finally {
      button.disabled = false;
    }
  }

  function showErrors(errors: CalendarEventErrors): void {
    for (const name of FIELDS) {
      const output = query<HTMLElement>(form, `[data-error-for="${name}"]`);
      const code = errors[name];
      const message = code ? FIELD_ERRORS[`${name}.${code}`] : null;
      output.textContent = message ?? '';
      output.hidden = !message;
      if (message) field(name).setAttribute('aria-invalid', 'true');
      else field(name).removeAttribute('aria-invalid');
    }
  }

  /** Zmiana opublikowanego wydarzenia → przebudowa i komunikat AC-25 / §7 (AC-29). */
  async function announceChange(message: string, rebuild: boolean): Promise<void> {
    announce(rebuild ? await rebuildAndDescribe(supabase, message) : message);
  }

  /** „Zapisz” (AC-48…50) albo „Opublikuj” (AC-51). */
  async function save(publish: boolean, button: HTMLButtonElement): Promise<void> {
    announce('');
    duty.showError(null);
    const input = readInput();
    const nextStatus: EventStatus = publish ? 'published' : (event?.status ?? 'draft');
    const errors = validateCalendarEvent(input, nextStatus);
    showErrors(errors);
    const invalid = FIELDS.filter((name) => errors[name]);
    if (invalid.length) {
      const onlyUrlMissing = invalid.length === 1 && errors.external_url === 'urlRequired';
      announce(onlyUrlMissing ? t('calendarEvent.urlRequired') : t('calendarEvent.fixErrors'));
      return field(invalid[0]).focus();
    }

    button.disabled = true;
    const wasPublished = event?.status === 'published';
    const publicRow = toEventRow(input);
    const rebuild = needsRebuild(publish, wasPublished, savedRow, publicRow);
    const row = { ...publicRow, duty_range_officer_id: duty.value(), ...(publish ? { status: nextStatus } : {}) };
    try {
      const { data, error } = event
        ? await supabase.from('calendar_events').update(row).eq('id', event.id).select(COLUMNS).single()
        : await supabase.from('calendar_events').insert(row).select(COLUMNS).single();
      if (error || !data) {
        // SPEC-007 AC-28, AC-29: dyżurny spoza listy albo nakładający się termin z innym dyżurnym.
        const dutyMessage = calendarDutyError(error);
        if (dutyMessage) {
          duty.showError(dutyMessage);
          announce(dutyMessage);
          return duty.focus();
        }
        const check = eventCheckError(error);
        if (!check) return announce(t('panel.saveError'));
        showErrors({ [check.field]: check.code });
        return announce(FIELD_ERRORS[`${check.field}.${check.code}`]);
      }
      if (!event) {
        window.location.assign(`${EDIT_URL}?id=${encodeURIComponent((data as CalendarEvent).id)}&saved=1`);
        return;
      }
      event = data as CalendarEvent;
      fillForm();
      await duty.load(event.id);
      await announceChange(publish ? t('calendarEvent.published') : t('panel.saved'), rebuild);
    } catch {
      announce(t('panel.saveError'));
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('input', renderPreview);
  form.addEventListener('change', renderPreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const button = query<HTMLButtonElement>(form, '[data-save]');
    if (event?.cancelled_at) void saveCancelled(event, button);
    else void save(false, button);
  });
  publishButton.addEventListener('click', () => void save(true, publishButton));

  // AC-52: cofnięcie publikacji z potwierdzeniem (§6.2); wydarzenie znika z kalendarza po przebudowie.
  unpublishButton.addEventListener('click', async () => {
    if (!event || event.status !== 'published') return;
    if (!window.confirm(t('calendarEvent.confirmUnpublish', { name: event.name }))) return;
    announce('');
    unpublishButton.disabled = true;
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .update({ status: 'draft' })
        .eq('id', event.id)
        .select(COLUMNS)
        .single();
      if (error || !data) return announce(t('panel.saveError'));
      event = data as CalendarEvent;
      fillForm();
      await announceChange(t('calendarEvent.unpublished'), true);
    } catch {
      announce(t('panel.saveError'));
    } finally {
      unpublishButton.disabled = false;
    }
  });

  // AC-52: usunięcie w dowolnym stanie z potwierdzeniem; opublikowane → przebudowa.
  deleteButton.addEventListener('click', async () => {
    if (!event) return;
    if (!window.confirm(t('calendarEvent.confirmDelete', { name: event.name }))) return;
    announce('');
    deleteButton.disabled = true;
    try {
      const { data, error } = await supabase.from('calendar_events').delete().eq('id', event.id).select('id');
      if (error || !data?.length) {
        deleteButton.disabled = false;
        // SPEC-003 AC-20: wydarzenia ze sprzedanymi wejściówkami nie da się usunąć.
        const tickets = eventCheckError(error)?.code === 'hasTickets';
        return announce(t(tickets ? 'calendarEvent.hasTickets' : 'calendarEvent.deleteError'));
      }
    } catch {
      deleteButton.disabled = false;
      return announce(t('calendarEvent.deleteError'));
    }
    const wasPublished = event.status === 'published';
    event = null;
    for (const section of root.querySelectorAll<HTMLElement>('[data-form], [data-preview], [data-danger]')) {
      section.hidden = true;
    }
    statusTag.hidden = true;
    await announceChange(t('calendarEvent.deleted'), wasPublished);
  });

  fillForm();
  if (new URLSearchParams(window.location.search).has('saved')) {
    announce(t('panel.saved'));
    window.history.replaceState(null, '', `${EDIT_URL}?id=${encodeURIComponent(event?.id ?? '')}`);
  }
}
