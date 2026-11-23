/**
 * Teksty e-maili aplikacji (SPEC-012 §6: klucze `email.*`, gotowe pod tłumaczenie). Parametry `{nazwa}`.
 * Edge Function nie importuje plików z `web/` (osobny bundel), więc słownik e-maili jest tutaj.
 */
export const pl = {
  email: {
    senderName: 'Steel Valley',
    orderPaid: {
      subject: 'Potwierdzenie zamówienia {number} — Steel Valley',
      heading: 'Potwierdzenie zamówienia {number}',
      intro: 'Dziękujemy za zakup. Zamówienie zostało opłacone.',
      number: 'Numer zamówienia: {number}',
      item: 'Produkt: {item}',
      amount: 'Kwota brutto: {amount}',
      paidAt: 'Data zakupu: {date}',
      validUntil: 'Ważny do {date}',
      ticketDays: 'Ważna w dniach wydarzenia: {dates}',
      consentHeading: 'Zgoda na korzystanie przed upływem 14 dni (złożona {date}):',
      // Treść zgody z SPEC-012 AC-6 — ta sama co w web/src/i18n/pl.ts.
      consent:
        'Chcę korzystać z karnetu przed upływem 14 dni na odstąpienie od umowy. Wiem, że po wykorzystaniu usługi w całości tracę prawo odstąpienia.',
      terms: 'W załączniku regulamin sprzedaży obowiązujący od {date}, zaakceptowany przy zakupie.',
      account: 'Twoje karnety i historia płatności: {url}',
      footer: 'Steel Valley',
    },
    // SPEC-012 AC-27: odwołanie wydarzenia.
    eventCancelled: {
      subject: 'Wydarzenie odwołane: {name} — Steel Valley',
      heading: 'Wydarzenie odwołane',
      intro: 'Wydarzenie {name} ({dates}) zostało odwołane. Powód: {reason}.',
      refundOnline: 'Zwrot {amount} zlecony na rachunek lub kartę, z której zapłacono.',
      refundOnSite: 'W sprawie zwrotu {amount} za wejściówkę kupioną na strzelnicy odpowiedz na tę wiadomość.',
      gift: 'Wejściówka została anulowana.',
      footer: 'Zamówienie {number} — Steel Valley',
    },
  },
} as const;

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type EmailKey = Paths<typeof pl>;

/** Tekst dla klucza z podstawionymi parametrami `{nazwa}`. */
export function t(key: EmailKey, params: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], pl);
  if (typeof value !== 'string') throw new Error(`Brak tekstu e-maila: ${key}`);
  return value.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
