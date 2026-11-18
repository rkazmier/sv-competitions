/**
 * Wypełnia pusty wzór karty wydarzenia (CalendarCard.astro bez `entry`) w przeglądarce —
 * podgląd karty pod formularzem wydarzenia (SPEC-001 AC-53). Tekst wyłącznie przez `textContent`,
 * link tylko `http(s)://` (lib/text.ts `safeExternalUrl`).
 */
import type { CalendarEntry } from './calendar';
import { formatDateRange } from './dates';
import { formatPrice } from './products';
import { t } from '../i18n';
import { safeExternalUrl, toParagraphs } from './text';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

/** `null` — karta ukryta (brak danych do podglądu). */
export function renderEventCard(card: HTMLElement, entry: CalendarEntry | null): void {
  card.hidden = !entry;
  if (!entry) return;
  query<HTMLElement>(card, '[data-card-kind]').textContent = entry.label;
  query<HTMLElement>(card, '[data-card-name]').textContent = entry.name;
  const date = query<HTMLTimeElement>(card, '[data-card-date]');
  date.dateTime = entry.startsOn;
  date.textContent = formatDateRange(entry.startsOn, entry.endsOn);

  // Akapity opisu: klony wzoru z komponentu (zachowują style karty), tuż przed linkiem.
  for (const old of card.querySelectorAll('.entry-description')) old.remove();
  const template = query<HTMLTemplateElement>(card, '[data-card-paragraph]');
  const paragraphs = toParagraphs(entry.description).map((text) => {
    const p = query<HTMLParagraphElement>(template.content.cloneNode(true) as DocumentFragment, 'p');
    p.textContent = text;
    return p;
  });
  template.before(...paragraphs);

  // SPEC-003 AC-17: cena wejściówki wydarzenia płatnego (w podglądzie przycisk bez adresu).
  const ticket = query<HTMLElement>(card, '[data-card-ticket]');
  ticket.hidden = !entry.ticketPrice;
  query<HTMLElement>(ticket, '[data-card-price]').textContent = entry.ticketPrice
    ? t('calendarCard.ticketPrice', { price: formatPrice(entry.ticketPrice) })
    : '';

  const link = query<HTMLAnchorElement>(card, '[data-card-link]');
  const url = safeExternalUrl(entry.externalUrl);
  if (url) link.href = url;
  else link.removeAttribute('href');
  link.hidden = !url;
  query<HTMLElement>(link, '[data-card-link-name]').textContent = entry.name;
}
