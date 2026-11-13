import { pl, type Dictionary } from './pl';

export type Locale = 'pl';

const dictionaries: Record<Locale, Dictionary> = { pl };

/** Klucze w postaci „sekcja.klucz”, np. `nav.calendar`. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<Dictionary>;

/**
 * Zwraca tekst interfejsu dla klucza i podstawia parametry `{nazwa}`.
 * Brak klucza to błąd (wykrywany już przez TypeScript).
 */
export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
  locale: Locale = 'pl',
): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[locale]);
  if (typeof value !== 'string') throw new Error(`Brak tekstu i18n: ${key}`);
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
