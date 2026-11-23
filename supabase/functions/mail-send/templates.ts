/**
 * Szablon e-maila `order_paid` (SPEC-012 AC-10): HTML + wersja tekstowa, kwoty „120,00 zł”, daty „2.01.2027”,
 * godziny w Europe/Warsaw. Wartości z bazy w HTML zawsze escapowane.
 */
import { t } from './i18n.ts';

/** Wiersz `mail_outbox_claim` (dane zamówienia i adres konta w chwili wysyłki). */
export interface OutboxRow {
  id: string;
  kind: string;
  attempts: number;
  order_id: string;
  order_number: string;
  item_name: string;
  amount: number;
  paid_at: string | null;
  terms_version: string | null;
  early_performance_consent_at: string | null;
  pass_kind: string | null;
  expires_on: string | null;
  event_starts_on: string | null;
  event_ends_on: string | null;
  email: string | null;
}

export interface Content {
  subject: string;
  text: string;
  html: string;
}

const NBSP = ' ';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Grosze → „120,00 zł” (jak `formatPrice` w web/src/lib/products.ts). */
export function formatPrice(grosze: number): string {
  const number = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${number.format(grosze / 100)}${NBSP}zł`;
}

function dateParts(value: string): [string, string, string] {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError('Nieprawidłowa data');
  return [String(Number(match[3])), match[2], match[1]];
}

/** `2027-01-02` → „2.01.2027”. */
export function formatDay(value: string): string {
  return dateParts(value).join('.');
}

/** Dni wydarzenia: „14.03.2027”, „14–15.03.2027”, „31.03–1.04.2027”, „31.12.2027–1.01.2028”. */
export function formatDayRange(start: string, end: string | null): string {
  if (!end || end === start) return formatDay(start);
  const [d1, m1, y1] = dateParts(start);
  const [d2, m2, y2] = dateParts(end);
  if (y1 !== y2) return `${d1}.${m1}.${y1}–${d2}.${m2}.${y2}`;
  if (m1 !== m2) return `${d1}.${m1}–${d2}.${m2}.${y2}`;
  return `${d1}–${d2}.${m2}.${y2}`;
}

const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `timestamptz` → „2.01.2027 14:05” (Europe/Warsaw, jak `shortDateTime` w web/src/lib/offer.ts). */
export function formatDateTime(value: string): string {
  const part = Object.fromEntries(warsawParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${Number(part.day)}.${part.month}.${part.year} ${part.hour}:${part.minute}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Nazwa załącznika i ścieżka PDF wersji regulaminu (web/public/regulamin-sprzedazy/). */
export function termsPdfName(version: string): string {
  return `regulamin-sprzedazy-${version}.pdf`;
}

/** AC-10: treść potwierdzenia opłaconego zamówienia. `siteUrl` bez końcowego `/`. */
export function orderPaidEmail(row: OutboxRow, siteUrl: string): Content {
  const number = row.order_number;
  const validity = row.pass_kind === 'event_ticket' && row.event_starts_on
    ? t('email.orderPaid.ticketDays', { dates: formatDayRange(row.event_starts_on, row.event_ends_on) })
    : row.expires_on
    ? t('email.orderPaid.validUntil', { date: formatDay(row.expires_on) })
    : null;
  const details = [
    t('email.orderPaid.number', { number }),
    t('email.orderPaid.item', { item: row.item_name }),
    t('email.orderPaid.amount', { amount: formatPrice(row.amount) }),
    ...(row.paid_at ? [t('email.orderPaid.paidAt', { date: formatDateTime(row.paid_at) })] : []),
    ...(validity ? [validity] : []),
  ];
  const consent = row.early_performance_consent_at
    ? [t('email.orderPaid.consentHeading', { date: formatDateTime(row.early_performance_consent_at) }),
      `„${t('email.orderPaid.consent')}”`]
    : null;
  const terms = t('email.orderPaid.terms', { date: formatDay(row.terms_version ?? '') });
  const accountUrl = `${siteUrl}/konto/`;
  const heading = t('email.orderPaid.heading', { number });
  const intro = t('email.orderPaid.intro');
  const footer = t('email.orderPaid.footer');

  const text = [
    heading,
    '',
    intro,
    '',
    ...details,
    ...(consent ? ['', ...consent] : []),
    '',
    terms,
    '',
    t('email.orderPaid.account', { url: accountUrl }),
    '',
    '-- ',
    footer,
    '',
  ].join('\r\n');

  const e = escapeHtml;
  const link = `<a href="${e(accountUrl)}">${e(accountUrl)}</a>`;
  const html = [
    '<!doctype html>',
    '<html lang="pl"><head><meta charset="utf-8"><title>' + e(heading) + '</title></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">',
    `<h1 style="font-size:20px">${e(heading)}</h1>`,
    `<p>${e(intro)}</p>`,
    `<ul>${details.map((line) => `<li>${e(line)}</li>`).join('')}</ul>`,
    ...(consent ? [`<p>${e(consent[0])}<br>${e(consent[1])}</p>`] : []),
    `<p>${e(terms)}</p>`,
    `<p>${e(t('email.orderPaid.account', { url: '' }))}${link}</p>`,
    `<p style="color:#555">${e(footer)}</p>`,
    '</body></html>',
  ].join('\r\n');

  return { subject: t('email.orderPaid.subject', { number }), text, html };
}
