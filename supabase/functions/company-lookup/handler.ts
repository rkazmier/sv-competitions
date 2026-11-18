/**
 * Edge Function `company-lookup` (SPEC-004 AC-2…AC-4, §7, §8).
 * POST `{ nip }` z JWT zalogowanej osoby:
 * 1. normalizacja NIP (spacje, myślniki, prefiks `PL`) i suma kontrolna — błędny NIP: 400 `invalid_nip`,
 *    prefiks inny niż `PL`: 400 `foreign_nip`; rejestry nie są odpytywane (AC-2, §7);
 * 2. `rpc/company_lookup_take_quota` z JWT wywołującego — limit 20 zapytań na konto na godzinę (429 `rate_limited`);
 * 3. Biała lista MF (`wl-api.mf.gov.pl`), a gdy brak podmiotu lub rejestr nie odpowiada — GUS REGON BIR1.1,
 *    jeśli ustawiono `GUS_BIR_KEY` (AC-3); każde zapytanie z limitem 5 s;
 * 4. odpowiedź `{ found, name, address, source }`; brak w rejestrach / brak odpowiedzi → `found: false` (AC-4).
 * Nic nie jest zapisywane w bazie. Do rejestrów trafia wyłącznie NIP; NIP nie trafia do logów ani komunikatów błędów.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz publishable — zapytania z JWT wywołującego. */
  supabaseKey?: string;
  /** Klucz GUS BIR (opcjonalny). Bez klucza krok REGON jest pomijany. */
  gusBirKey?: string;
  /** Adres usługi BIR1.1 (domyślnie produkcyjny). */
  gusBirUrl?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
  now?: () => Date;
  /** Limit czasu jednego zapytania do rejestru (domyślnie 5 s). */
  timeoutMs?: number;
}

export type Source = 'vat_whitelist' | 'regon';

export interface Company {
  name: string;
  address: string;
}

export const WHITELIST_URL = 'https://wl-api.mf.gov.pl';
export const GUS_BIR_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const TIMEOUT_MS = 5000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ===== NIP (§7, zgodnie z `normalize_nip` / `is_valid_nip` w bazie) =====

/** Usuwa spacje i myślniki, odcina prefiks `PL` (bez rozróżniania wielkości liter). Inny prefiks zostaje. */
export function normalizeNip(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  return s.startsWith('PL') ? s.slice(2) : s;
}

/** 10 cyfr, wagi 6,5,7,2,3,4,5,6,7; suma mod 11 = ostatnia cyfra (reszta 10 — NIP nieprawidłowy). */
export function isValidNip(nip: string): boolean {
  if (!/^[0-9]{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}

/** NIP z prefiksem kraju innym niż `PL` (np. `DE123…`) — faktury dla firm zagranicznych poza zakresem. */
export function isForeignNip(normalized: string): boolean {
  return /^[A-Z]{2}[0-9A-Z+*]{2,13}$/.test(normalized) && /[0-9]/.test(normalized);
}

// ===== Rejestry =====

function warsawDate(date: Date): string {
  // en-CA daje format RRRR-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(date);
}

/** Błąd rejestru z komunikatem bez NIP-u (status HTTP, krok). */
class RegistryError extends Error {}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

interface WhitelistSubject {
  name?: unknown;
  workingAddress?: unknown;
  residenceAddress?: unknown;
  statusVat?: unknown;
}

/** Biała lista: pierwszy podmiot „Czynny”, inaczej pierwszy (§7). `null` — brak podmiotu. Błąd — wyjątek. */
export async function lookupWhitelist(nip: string, deps: Deps): Promise<Company | null> {
  const date = warsawDate((deps.now ?? (() => new Date()))());
  const response = await deps.fetch(`${WHITELIST_URL}/api/search/nip/${nip}?date=${date}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new RegistryError(`Biała lista odpowiedziała ${response.status}`);
  }
  const body = await response.json();
  const result = body?.result ?? {};
  const subjects: WhitelistSubject[] = [
    ...(Array.isArray(result.subjects) ? result.subjects : []),
    ...(result.subject ? [result.subject] : []),
  ].filter((s) => s && typeof s === 'object');
  const subject = subjects.find((s) => s.statusVat === 'Czynny') ?? subjects[0];
  if (!subject) return null;
  const name = clean(subject.name);
  const address = clean(subject.workingAddress) || clean(subject.residenceAddress);
  return name && address ? { name, address } : null;
}

const BIR_NS = 'http://CIS/BIR/PUBL/2014/07';

function soapEnvelope(url: string, action: string, body: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${BIR_NS}"` +
    ` xmlns:dat="${BIR_NS}/DataContract">` +
    `<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">` +
    `<wsa:To>${url}</wsa:To><wsa:Action>${BIR_NS}/IUslugaBIRzewnPubl/${action}</wsa:Action>` +
    `</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`
  );
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Treść elementu `<tag>` (bez przestrzeni nazw), zdekodowana. */
function element(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`));
  return match ? decodeXml(match[1]) : null;
}

async function birCall(action: string, body: string, sid: string | null, deps: Deps): Promise<string> {
  const url = deps.config.gusBirUrl || GUS_BIR_URL;
  const headers: Record<string, string> = { 'Content-Type': 'application/soap+xml; charset=utf-8' };
  if (sid) headers.sid = sid;
  const response = await deps.fetch(url, {
    method: 'POST',
    headers,
    body: soapEnvelope(url, action, body),
    signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new RegistryError(`GUS BIR ${action} odpowiedział ${response.status}`);
  return text;
}

/** Adres z pól BIR: „ul. Ulica 1/2, 00-001 Miejscowość”. */
function birAddress(dane: string): string {
  const field = (tag: string) => clean(element(dane, tag));
  const number = [field('NrNieruchomosci'), field('NrLokalu')].filter(Boolean).join('/');
  const street = [field('Ulica') || field('Miejscowosc'), number].filter(Boolean).join(' ');
  const postal = field('KodPocztowy').replace(/^(\d{2})(\d{3})$/, '$1-$2');
  const city = field('MiejscowoscPoczty') || field('Miejscowosc');
  return [street, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** GUS REGON BIR1.1: logowanie kluczem, `DaneSzukajPodmioty` po NIP, wylogowanie. `null` — brak podmiotu. */
export async function lookupRegon(nip: string, deps: Deps): Promise<Company | null> {
  const key = deps.config.gusBirKey!;
  const login = await birCall('Zaloguj', `<ns:Zaloguj><ns:pKluczUzytkownika>${key}</ns:pKluczUzytkownika></ns:Zaloguj>`, null, deps);
  const sid = clean(element(login, 'ZalogujResult'));
  if (!sid) throw new RegistryError('GUS BIR: nieudane logowanie');
  try {
    const search = await birCall(
      'DaneSzukajPodmioty',
      `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
      sid,
      deps,
    );
    const result = element(search, 'DaneSzukajPodmiotyResult') ?? '';
    const rows = [...result.matchAll(/<dane>([\s\S]*?)<\/dane>/g)].map((m) => m[1]).filter((d) => !element(d, 'ErrorCode'));
    // Aktywny podmiot (bez daty zakończenia działalności), inaczej pierwszy.
    const dane = rows.find((d) => !clean(element(d, 'DataZakonczeniaDzialalnosci'))) ?? rows[0];
    if (!dane) return null;
    const name = clean(element(dane, 'Nazwa'));
    const address = birAddress(dane);
    return name && address ? { name, address } : null;
  } finally {
    try {
      await birCall('Wyloguj', `<ns:Wyloguj><ns:pIdentyfikatorSesji>${sid}</ns:pIdentyfikatorSesji></ns:Wyloguj>`, sid, deps);
    } catch {
      // Sesja wygaśnie sama.
    }
  }
}

// ===== Obsługa żądania =====

async function readNip(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    return typeof body?.nip === 'string' && body.nip.length <= 32 ? body.nip : null;
  } catch {
    return null;
  }
}

type Quota = 'ok' | 'exceeded' | 'unauthorized' | 'error';

async function takeQuota(authorization: string, deps: Deps): Promise<Quota> {
  const { supabaseUrl, supabaseKey } = deps.config;
  try {
    const response = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/company_lookup_take_quota`, {
      method: 'POST',
      headers: { apikey: supabaseKey!, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return body === true ? 'ok' : 'exceeded';
    if (response.status === 401 || body?.code === '28000' || body?.code === '42501' || body?.code === 'PGRST301') {
      return 'unauthorized';
    }
    return 'error';
  } catch {
    return 'error';
  }
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { supabaseUrl, supabaseKey, gusBirKey } = deps.config;
  if (!supabaseUrl || !supabaseKey) {
    log('company-lookup: brak konfiguracji (SUPABASE_URL lub klucz publishable)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return json(401, { error: 'unauthorized' });

  const input = await readNip(request);
  if (input === null) return json(400, { error: 'invalid_nip' });
  const nip = normalizeNip(input);
  if (isForeignNip(nip)) return json(400, { error: 'foreign_nip' });
  if (!isValidNip(nip)) return json(400, { error: 'invalid_nip' });

  const quota = await takeQuota(authorization, deps);
  if (quota === 'unauthorized') return json(401, { error: 'unauthorized' });
  if (quota === 'exceeded') return json(429, { error: 'rate_limited' });
  if (quota === 'error') {
    log('company-lookup: nie udało się sprawdzić limitu zapytań');
    return json(500, { error: 'lookup_failed' });
  }

  const registries: [Source, (nip: string, deps: Deps) => Promise<Company | null>][] = [
    ['vat_whitelist', lookupWhitelist],
  ];
  if (gusBirKey) registries.push(['regon', lookupRegon]);

  for (const [source, lookup] of registries) {
    try {
      const company = await lookup(nip, deps);
      if (company) return json(200, { found: true, name: company.name, address: company.address, source });
    } catch (error) {
      // Tylko własne komunikaty — błędy `fetch` zawierają adres z NIP-em.
      const reason = error instanceof RegistryError
        ? error.message
        : error instanceof Error && error.name === 'TimeoutError'
        ? 'przekroczony limit 5 s'
        : 'błąd połączenia';
      log(`company-lookup: rejestr ${source} niedostępny (${reason})`);
    }
  }
  return json(200, { found: false, name: null, address: null, source: null });
}
