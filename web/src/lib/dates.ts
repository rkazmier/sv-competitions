/**
 * Formatowanie dat w UI (SPEC-001 §6.2), `Intl` z `pl-PL`.
 * Daty wpisów to dni kalendarzowe bez godziny (`YYYY-MM-DD`), więc liczymy w UTC —
 * wynik nie zależy od strefy czasowej maszyny, na której działa build.
 */
const LOCALE = 'pl-PL';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const fullFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayMonthFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });

function parse(value: string): Date {
  const match = ISO_DATE.exec(value);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Nieprawidłowa data: ${value}`);
  return date;
}

/** `2027-06-14` → `14 czerwca 2027` */
export function formatDate(value: string): string {
  return fullFormat.format(parse(value));
}

/**
 * Termin wpisu:
 * - jeden dzień (brak końca lub koniec = początek): `14 czerwca 2027`,
 * - ten sam miesiąc: `14–15 czerwca 2027`,
 * - różne miesiące: `30 czerwca – 1 lipca 2027`,
 * - różne lata: `30 grudnia 2027 – 2 stycznia 2028`.
 */
export function formatDateRange(start: string, end?: string | null): string {
  const from = parse(start);
  if (!end || end === start) return fullFormat.format(from);
  const to = parse(end);
  if (to < from) throw new RangeError(`Koniec przed początkiem: ${start} – ${end}`);

  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    return `${fullFormat.format(from)} – ${fullFormat.format(to)}`;
  }
  if (from.getUTCMonth() !== to.getUTCMonth()) {
    return `${dayMonthFormat.format(from)} – ${fullFormat.format(to)}`;
  }
  return `${from.getUTCDate()}–${fullFormat.format(to)}`;
}

/** Nagłówek miesiąca w kalendarzu: `2027-06-14` → `Czerwiec 2027` */
export function formatMonthHeading(value: string): string {
  const text = monthFormat.format(parse(value));
  return text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);
}
