/**
 * Produkty Oferty (SPEC-003 US-1, AC-1…AC-4). Logika bez DOM: walidacja formularza
 * (te same limity co `check` w tabeli `products`), ceny w groszach, grupy i kolejność.
 */

export const PRODUCT_KINDS = ['entries', 'single_entry'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const DAY_TYPES = ['weekend', 'weekday'] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const PRODUCT_NAME_MAX = 100;
export const PRODUCT_DESCRIPTION_MAX = 500;
export const PRODUCT_PRICE_MIN = 1;
export const PRODUCT_PRICE_MAX = 1_000_000;
export const PRODUCT_ENTRIES_MAX = 100;

/** Kolumny pobierane w panelu (wymienione jawnie). */
export const PRODUCT_COLUMNS = 'id, kind, name, description, price, entries, day_type, is_active, position';

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  description: string | null;
  price: number;
  entries: number | null;
  day_type: DayType | null;
  is_active: boolean;
  position: number;
}

/** Wartości pól formularza (tekst z inputów). */
export interface ProductForm {
  kind: string;
  name: string;
  price: string;
  entries: string;
  day_type: string;
  description: string;
}

/** Wiersz do zapisu: pola szczegółu innych rodzajów to `null` (`products_kind_details`). */
export type ProductRow = Pick<Product, 'kind' | 'name' | 'description' | 'price' | 'entries' | 'day_type'>;

export type ProductField = keyof ProductForm;
export type ProductError =
  | 'kindRequired'
  | 'nameRequired'
  | 'nameTooLong'
  | 'priceInvalid'
  | 'entriesInvalid'
  | 'dayTypeRequired'
  | 'descriptionTooLong';

export type ProductValidation =
  | { ok: true; row: ProductRow }
  | { ok: false; errors: Partial<Record<ProductField, ProductError>> };

/** Twarda spacja między kwotą a „zł” (kwota nie łamie się na końcu linii). */
export const NBSP = String.fromCharCode(0xa0);

const length = (text: string) => [...text].length;

/**
 * Cena w złotych z pola formularza → grosze. Akceptuje „120”, „120,5”, „120,50”, „120.50”, „1 200,00 zł”.
 * Zwraca `null`, gdy tekst nie jest kwotą z najwyżej dwoma miejscami po przecinku.
 */
export function parsePrice(text: string): number | null {
  const normalized = text
    .replace(/\s/g, '')
    .replace(/zł$/i, '')
    .replace(',', '.');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const plnNumber = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Grosze → „120,00 zł” (SPEC-003 AC-5). */
export function formatPrice(grosze: number): string {
  return `${plnNumber.format(grosze / 100)}${NBSP}zł`;
}

/** Grosze → wartość pola „Cena” przy edycji, np. „120,00”. */
export function priceInputValue(grosze: number): string {
  return (grosze / 100).toFixed(2).replace('.', ',');
}

function parseCount(text: string, max: number): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 && value <= max ? value : null;
}

const isKind = (value: string): value is ProductKind => (PRODUCT_KINDS as readonly string[]).includes(value);
const isDayType = (value: string): value is DayType => (DAY_TYPES as readonly string[]).includes(value);

/** Walidacja formularza produktu (AC-1). */
export function validateProduct(form: ProductForm): ProductValidation {
  const errors: Partial<Record<ProductField, ProductError>> = {};
  const name = form.name.trim();
  const description = form.description.trim();
  const price = parsePrice(form.price);

  if (!isKind(form.kind)) errors.kind = 'kindRequired';
  if (!name) errors.name = 'nameRequired';
  else if (length(name) > PRODUCT_NAME_MAX) errors.name = 'nameTooLong';
  if (price === null || price < PRODUCT_PRICE_MIN || price > PRODUCT_PRICE_MAX) errors.price = 'priceInvalid';
  if (length(description) > PRODUCT_DESCRIPTION_MAX) errors.description = 'descriptionTooLong';

  const entries = form.kind === 'entries' ? parseCount(form.entries, PRODUCT_ENTRIES_MAX) : null;
  const dayType = form.kind === 'single_entry' && isDayType(form.day_type) ? form.day_type : null;
  if (form.kind === 'entries' && entries === null) errors.entries = 'entriesInvalid';
  if (form.kind === 'single_entry' && dayType === null) errors.day_type = 'dayTypeRequired';

  if (Object.keys(errors).length > 0 || !isKind(form.kind) || price === null) return { ok: false, errors };
  return {
    ok: true,
    row: { kind: form.kind, name, description: description || null, price, entries, day_type: dayType },
  };
}

/** Produkt → wartości formularza edycji. */
export function productForm(product: Product): ProductForm {
  return {
    kind: product.kind,
    name: product.name,
    price: priceInputValue(product.price),
    entries: product.entries?.toString() ?? '',
    day_type: product.day_type ?? '',
    description: product.description ?? '',
  };
}

/** Produkty w grupach rodzaju, w grupie wg `position` (AC-4) — ta sama kolejność co w `/oferta/`. */
export function groupProducts(products: readonly Product[]): Record<ProductKind, Product[]> {
  const groups = { entries: [], single_entry: [] } as Record<ProductKind, Product[]>;
  for (const product of products) groups[product.kind].push(product);
  for (const kind of PRODUCT_KINDS) {
    groups[kind].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  }
  return groups;
}

/** Czy zmiana dotyczy pól zamrożonych przy zamówieniach (AC-3): rodzaj, liczba wejść, dzień. */
export function changesFrozenFields(product: Product, row: ProductRow): boolean {
  return (
    product.kind !== row.kind ||
    product.entries !== row.entries ||
    product.day_type !== row.day_type
  );
}

/** Błąd wyzwalacza `products_before_write` (AC-3). */
export function isProductHasOrdersError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23514' && error.message === 'product_has_orders';
}
