/**
 * Wyspa panelu produktów (`/panel/oferta/`, SPEC-003 US-1, AC-1…AC-4). Tylko admin (`requireAdmin`).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 * Oferta (`/oferta/`) pobiera produkty w przeglądarce — zmiany nie wymagają przebudowy strony publicznej.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { requireAdmin, showLoadError } from './panel';
import {
  PRODUCT_COLUMNS,
  PRODUCT_DAYS_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_ENTRIES_MAX,
  PRODUCT_KINDS,
  PRODUCT_NAME_MAX,
  changesFrozenFields,
  formatPrice,
  groupProducts,
  isProductHasOrdersError,
  productForm,
  validateProduct,
  type Product,
  type ProductError,
  type ProductField,
  type ProductForm,
} from './products';

const FIELDS: ProductField[] = ['kind', 'name', 'price', 'entries', 'days', 'day_type', 'description'];
/** Pola zamrożone, gdy produkt ma zamówienia (AC-3). */
const FROZEN_FIELDS: ProductField[] = ['kind', 'entries', 'days', 'day_type'];

const ERROR_TEXT: Record<ProductError, string> = {
  kindRequired: t('products.kindRequired'),
  nameRequired: t('products.nameRequired'),
  nameTooLong: t('products.nameTooLong', { max: PRODUCT_NAME_MAX }),
  priceInvalid: t('products.priceInvalid'),
  entriesInvalid: t('products.entriesInvalid', { max: PRODUCT_ENTRIES_MAX }),
  daysInvalid: t('products.daysInvalid', { max: PRODUCT_DAYS_MAX }),
  dayTypeRequired: t('products.dayTypeRequired'),
  descriptionTooLong: t('products.descriptionTooLong', { max: PRODUCT_DESCRIPTION_MAX }),
};

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function details(product: Product): string {
  if (product.kind === 'entries') return t('products.details.entries', { count: product.entries ?? 0 });
  if (product.kind === 'days') return t('products.details.days', { count: product.days ?? 0 });
  return t('products.details.single_entry', { day: product.day_type ? t(`products.dayTypes.${product.day_type}`) : '' });
}

export async function mountProducts(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-form]');
  const heading = query<HTMLElement>(form, '[data-form-heading]');
  const submit = query<HTMLButtonElement>(form, '[data-submit]');
  const cancel = query<HTMLButtonElement>(form, '[data-cancel]');
  const formError = query<HTMLElement>(form, '[data-form-error]');
  const hasOrdersHint = query<HTMLElement>(form, '[data-has-orders]');
  const status = query<HTMLElement>(root, '[data-status]');
  const template = query<HTMLTemplateElement>(root, '[data-row-template]');
  const control = (name: ProductField) =>
    query<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(form, `[name="${name}"]`);

  const supabase: SupabaseClient = await requireAdmin();
  let products: Product[] = [];
  /** Edytowany produkt (null — tryb dodawania). */
  let editing: Product | null = null;

  const announce = (message: string) => {
    status.textContent = message;
  };

  function setFieldError(field: ProductField, message: string | null): void {
    const output = query<HTMLElement>(form, `[data-error-for="${field}"]`);
    output.textContent = message ?? '';
    output.hidden = !message;
    if (message) control(field).setAttribute('aria-invalid', 'true');
    else control(field).removeAttribute('aria-invalid');
  }

  function setFormError(message: string | null): void {
    formError.textContent = message ?? '';
    formError.hidden = !message;
  }

  function clearErrors(): void {
    for (const field of FIELDS) setFieldError(field, null);
    setFormError(null);
  }

  /** Pokazuje tylko pole szczegółu wybranego rodzaju (AC-1). */
  function syncKindFields(): void {
    const kind = control('kind').value;
    for (const wrapper of form.querySelectorAll<HTMLElement>('[data-kind-field]')) {
      wrapper.hidden = wrapper.dataset.kindField !== kind;
    }
  }

  function readForm(): ProductForm {
    return Object.fromEntries(FIELDS.map((field) => [field, control(field).value])) as unknown as ProductForm;
  }

  function fillForm(values: ProductForm): void {
    for (const field of FIELDS) control(field).value = values[field];
    syncKindFields();
  }

  function setFrozen(frozen: boolean): void {
    for (const field of FROZEN_FIELDS) control(field).disabled = frozen;
    hasOrdersHint.hidden = !frozen;
  }

  function resetForm(): void {
    editing = null;
    form.reset();
    clearErrors();
    setFrozen(false);
    syncKindFields();
    heading.textContent = t('products.addHeading');
    submit.textContent = t('products.add');
    cancel.hidden = true;
  }

  async function startEdit(product: Product): Promise<void> {
    resetForm();
    editing = product;
    fillForm(productForm(product));
    heading.textContent = t('products.editHeading', { name: product.name });
    submit.textContent = t('products.save');
    cancel.hidden = false;
    form.scrollIntoView({ block: 'start' });
    control('name').focus();
    // AC-3: produkt z zamówieniami — rodzaj i liczby zablokowane.
    const { data } = await supabase.rpc('product_has_orders', { p_product_id: product.id });
    if (editing?.id === product.id) setFrozen(data === true);
  }

  async function load(): Promise<boolean> {
    const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS);
    if (error) return false;
    products = (data ?? []) as Product[];
    render();
    return true;
  }

  /** Zapis, ponowne wczytanie listy i powrót fokusu do pierwszego dostępnego przycisku z listy selektorów. */
  async function mutate(request: PromiseLike<{ error: unknown }>, focusSelectors: string[]): Promise<void> {
    announce('');
    let failed: boolean;
    try {
      failed = Boolean((await request).error);
    } catch {
      failed = true;
    }
    if (failed || !(await load())) return announce(t('panel.saveError'));
    announce(t('panel.saved'));
    for (const selector of focusSelectors) {
      const target = root.querySelector<HTMLButtonElement>(selector);
      if (target && !target.disabled) return target.focus();
    }
  }

  function renderItem(product: Product, index: number, count: number): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const li = query<HTMLLIElement>(fragment, '[data-item]');
    li.dataset.itemId = product.id;
    query<HTMLElement>(li, '[data-name]').textContent = product.name;
    query<HTMLElement>(li, '[data-price]').textContent = formatPrice(product.price);
    query<HTMLElement>(li, '[data-details]').textContent = details(product);
    for (const span of li.querySelectorAll<HTMLElement>('[data-sr-name]')) span.textContent = `: ${product.name}`;
    const state = query<HTMLElement>(li, '[data-state]');
    state.dataset.state = product.is_active ? 'active' : 'hidden';
    state.textContent = product.is_active ? t('products.active') : t('products.hidden');

    const toggle = query<HTMLButtonElement>(li, '[data-toggle]');
    query<HTMLElement>(toggle, '[data-toggle-text]').textContent = product.is_active
      ? t('products.hide')
      : t('products.show');
    toggle.addEventListener('click', () => {
      toggle.disabled = true;
      void mutate(
        supabase.from('products').update({ is_active: !product.is_active }).eq('id', product.id),
        [`[data-item-id="${product.id}"] [data-toggle]`],
      );
    });

    for (const button of li.querySelectorAll<HTMLButtonElement>('[data-move]')) {
      const direction = button.dataset.move as 'up' | 'down';
      button.disabled = direction === 'up' ? index === 0 : index === count - 1;
      button.addEventListener('click', () => {
        button.disabled = true;
        void mutate(
          supabase.rpc('move_product', { p_product_id: product.id, p_direction: direction }),
          [
            `[data-item-id="${product.id}"] [data-move="${direction}"]`,
            `[data-item-id="${product.id}"] [data-move="${direction === 'up' ? 'down' : 'up'}"]`,
          ],
        );
      });
    }

    query<HTMLButtonElement>(li, '[data-edit]').addEventListener('click', () => void startEdit(product));
    return li;
  }

  function render(): void {
    const groups = groupProducts(products);
    for (const kind of PRODUCT_KINDS) {
      const list = query<HTMLUListElement>(root, `[data-group="${kind}"]`);
      const items = groups[kind];
      list.replaceChildren(...items.map((product, index) => renderItem(product, index, items.length)));
      query<HTMLElement>(root, `[data-empty="${kind}"]`).hidden = items.length > 0;
    }
  }

  control('kind').addEventListener('change', syncKindFields);
  cancel.addEventListener('click', resetForm);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    announce('');
    clearErrors();
    const result = validateProduct(readForm());
    if (!result.ok) {
      for (const [field, error] of Object.entries(result.errors) as [ProductField, ProductError][]) {
        setFieldError(field, ERROR_TEXT[error]);
      }
      setFormError(t('products.fixErrors'));
      const first = FIELDS.find((field) => result.errors[field]);
      if (first) control(first).focus();
      return;
    }
    const current = editing;
    // Bez zamrożonych pól w zapisie, jeśli się nie zmieniły (AC-3: zmiana nazwy i ceny przy zamówieniach).
    const row = current && !changesFrozenFields(current, result.row)
      ? { name: result.row.name, price: result.row.price, description: result.row.description }
      : result.row;
    submit.disabled = true;
    const { error } = current
      ? await supabase.from('products').update(row).eq('id', current.id)
      : await supabase.from('products').insert(row);
    submit.disabled = false;
    if (isProductHasOrdersError(error)) {
      setFrozen(true);
      return setFormError(t('products.hasOrders'));
    }
    if (error) return setFormError(t('panel.saveError'));
    resetForm();
    if (!(await load())) return showLoadError();
    announce(current ? t('panel.saved') : t('products.added'));
  });

  resetForm();
  if (!(await load())) showLoadError();
}
