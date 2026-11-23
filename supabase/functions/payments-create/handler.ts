/**
 * Edge Function `payments-create` (SPEC-003 AC-8, AC-18, §7, §8; ADR-0002).
 * POST `{ product_id | event_id, request_key, terms_version, consent }` z JWT zalogowanej osoby
 * (SPEC-012 AC-3, AC-7: wersja regulaminu i zgoda sprawdzane przez `create_tpay_order` — 409 `terms_changed`, 400 `consent_required`):
 * 1. konto z `GET /auth/v1/user` (JWT wywołującego), imię i nazwisko z `profiles` (RLS: własny wiersz);
 * 2. `rpc/create_tpay_order` kluczem secret — zamówienie `pending` z ceną z bazy (nie z przeglądarki),
 *    limit miejsc wejściówki z blokadą wiersza wydarzenia, ten sam `request_key` → 409 `duplicate_request`;
 *    z `invoice` (SPEC-004 AC-5) — `rpc/set_order_invoice_details`: kopia danych faktury w zamówieniu i nadpisanie
 *    `billing_details`; dane odrzucone przez bazę → zamówienie usunięte, 400 `invalid_invoice`;
 * 3. Tpay Open API: token OAuth (client credentials), transakcja z kwotą, opisem „<numer zamówienia> — <nazwa>”
 *    (SPEC-006 AC-14), `hiddenDescription` = id zamówienia (wraca jako `tr_crc`), e-mailem i imieniem płatnika, powiadomieniem
 *    na `payments-notify` i powrotem na `/konto/platnosc/?order=`;
 * 4. `rpc/attach_tpay_transaction` — id i tytuł transakcji w zamówieniu; odpowiedź `{ order_id, payment_url }`.
 * Błąd Tpay → `rpc/discard_tpay_order` i 502 (zamówienie nie powstaje, §7). Sekrety i dane płatnika nie trafiają do logów.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz publishable — zapytania z JWT wywołującego. */
  supabaseKey?: string;
  /** Klucz secret — funkcje zamówień (`service_role`). */
  secretKey?: string;
  tpayApiUrl?: string;
  tpayClientId?: string;
  tpayClientSecret?: string;
  tpayNotificationUrl?: string;
  /** Adres strony (powrót z bramki), np. `https://events.steel-valley.pl`. */
  siteUrl?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Odmowy `create_tpay_order` → 409 z tym samym kodem (komunikaty w UI, #50/#51); SPEC-012: `terms_changed` (AC-3),
 * `product_discontinued` (AC-54).
 */
const REFUSALS = new Set(['product_unavailable', 'event_unavailable', 'sales_closed', 'sold_out', 'terms_changed',
  'product_discontinued']);
/** SPEC-012 AC-7: brak zgody na korzystanie przed upływem 14 dni → 400. */
const BAD_REQUESTS = new Set(['consent_required']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Limit pola `description` w `POST /transactions` (Tpay Open API, schemat `CreateTransaction`: maxLength 128). */
export const TPAY_DESCRIPTION_MAX = 128;

/**
 * SPEC-006 AC-14: `SV-2026-000123 — <item_name>`; za długi opis skraca nazwę (końcówka `…`), numeru nigdy.
 * Długość liczona w znakach (punktach kodowych), nie w bajtach.
 */
export function tpayDescription(orderNumber: string, itemName: string): string {
  const prefix = `${orderNumber} — `;
  const name = Array.from(itemName);
  if (Array.from(prefix).length + name.length <= TPAY_DESCRIPTION_MAX) return prefix + itemName;
  const room = Math.max(TPAY_DESCRIPTION_MAX - Array.from(prefix).length - 1, 0);
  return `${prefix}${name.slice(0, room).join('').trimEnd()}…`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** SPEC-004 AC-5: dane do faktury potwierdzone w przeglądarce; NIP, długości i źródło sprawdza `set_order_invoice_details`. */
interface Invoice {
  nip: string;
  company_name: string;
  company_address: string;
  data_source: string;
  fetched_at: string | null;
}

interface Item {
  product_id: string | null;
  event_id: string | null;
  request_key: string;
  invoice: Invoice | null;
  /** SPEC-012 AC-3: `effective_from` wersji regulaminu pokazanej w przeglądarce; `null` — żadna jeszcze nie obowiązuje. */
  terms_version: string | null;
  /** SPEC-012 AC-6: zgoda na korzystanie przed upływem 14 dni (wymagana dla produktu — sprawdza baza). */
  consent: boolean;
}

function readInvoice(value: unknown): Invoice | null | undefined {
  if (value === undefined || value === null) return null;
  const v = value as Record<string, unknown>;
  const text = (field: unknown, max: number) => typeof field === 'string' && field.length <= max;
  if (!text(v.nip, 32) || !text(v.company_name, 400) || !text(v.company_address, 400) || !text(v.data_source, 20)) {
    return undefined;
  }
  const fetched = v.fetched_at ?? null;
  if (fetched !== null && !(typeof fetched === 'string' && !Number.isNaN(Date.parse(fetched)))) return undefined;
  return {
    nip: v.nip as string,
    company_name: v.company_name as string,
    company_address: v.company_address as string,
    data_source: v.data_source as string,
    fetched_at: fetched,
  };
}

async function readItem(request: Request): Promise<Item | null> {
  try {
    const body = await request.json();
    const id = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);
    const invoice = readInvoice(body?.invoice);
    const terms = body?.terms_version ?? null;
    const consent = body?.consent ?? false;
    if ((terms !== null && !(typeof terms === 'string' && DATE.test(terms))) || typeof consent !== 'boolean') return null;
    const item = {
      product_id: id(body?.product_id),
      event_id: id(body?.event_id),
      request_key: id(body?.request_key),
      invoice,
      terms_version: terms,
      consent,
    };
    if (!item.request_key || Boolean(item.product_id) === Boolean(item.event_id) || invoice === undefined) return null;
    return item as Item;
  } catch {
    return null;
  }
}

/**
 * AC-5: kopia danych faktury w zamówieniu i nadpisanie `billing_details` płatnika.
 * `invalid` — baza odrzuciła dane (kod 22023: NIP, długości, źródło), `error` — inny błąd.
 */
async function saveInvoice(orderId: string, invoice: Invoice, deps: Deps): Promise<'ok' | 'invalid' | 'error'> {
  const saved = await rpc('set_order_invoice_details', {
    p_order_id: orderId,
    p_nip: invoice.nip,
    p_company_name: invoice.company_name,
    p_company_address: invoice.company_address,
    p_data_source: invoice.data_source,
    p_fetched_at: invoice.fetched_at,
    p_save_billing_details: true,
  }, deps);
  if (saved.ok) return 'ok';
  return saved.body?.code === '22023' ? 'invalid' : 'error';
}

/** Konto i imię płatnika z JWT wywołującego; `null` — brak sesji. */
async function payer(authorization: string, deps: Deps): Promise<{ id: string; email: string; name: string } | null> {
  const { supabaseUrl, supabaseKey } = deps.config;
  const headers = { apikey: supabaseKey!, Authorization: authorization };
  const userResponse = await deps.fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) {
    await userResponse.body?.cancel();
    return null;
  }
  const user = await userResponse.json();
  if (typeof user?.id !== 'string' || typeof user?.email !== 'string') return null;
  const profileResponse = await deps.fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=full_name`,
    { headers },
  );
  const rows = profileResponse.ok ? await profileResponse.json() : [];
  // Tpay wymaga nazwy płatnika; bez imienia i nazwiska w profilu — e-mail (już przekazywany Tpay).
  return { id: user.id, email: user.email, name: rows?.[0]?.full_name || user.email };
}

/** RPC kluczem secret; wynik JSON albo błąd PostgREST (`{ message }`). */
async function rpc(name: string, args: Record<string, unknown>, deps: Deps): Promise<{ ok: boolean; body: any }> {
  const { supabaseUrl, secretKey } = deps.config;
  const response = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: secretKey!, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { ok: response.ok, body: text ? JSON.parse(text) : null };
}

/** Odpowiedź `create_tpay_order` (SPEC-006: z `order_number`, także przy `duplicate`). */
interface Order {
  order_id: string;
  order_number: string;
  amount: number;
  item_name: string;
  duplicate: boolean;
}

/** Transakcja Tpay; `null` — Tpay niedostępny lub odmówił. */
async function tpayTransaction(
  order: Order,
  who: { email: string; name: string },
  deps: Deps,
): Promise<{ id: string; title: string; url: string } | null> {
  const { tpayApiUrl, tpayClientId, tpayClientSecret, tpayNotificationUrl, siteUrl } = deps.config;
  const tokenResponse = await deps.fetch(`${tpayApiUrl}/oauth/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: tpayClientId!, client_secret: tpayClientSecret! }),
  });
  const token = tokenResponse.ok ? (await tokenResponse.json())?.access_token : null;
  if (typeof token !== 'string') return null;
  const back = `${siteUrl!.replace(/\/$/, '')}/konto/platnosc/?order=${order.order_id}`;
  const response = await deps.fetch(`${tpayApiUrl}/transactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: order.amount / 100,
      description: tpayDescription(order.order_number, order.item_name),
      hiddenDescription: order.order_id,
      lang: 'pl',
      payer: { email: who.email, name: who.name },
      callbacks: { payerUrls: { success: back, error: back }, notification: { url: tpayNotificationUrl } },
    }),
  });
  const tx = response.ok ? await response.json() : null;
  const url = tx?.transactionPaymentUrl;
  if (typeof tx?.transactionId !== 'string' || typeof tx?.title !== 'string' || !/^https:\/\//.test(url ?? '')) {
    return null;
  }
  return { id: tx.transactionId, title: tx.title, url };
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const config = deps.config;
  const required = ['supabaseUrl', 'supabaseKey', 'secretKey', 'tpayApiUrl', 'tpayClientId', 'tpayClientSecret',
    'tpayNotificationUrl', 'siteUrl'] as const;
  if (required.some((key) => !config[key])) {
    log('payments-create: brak konfiguracji (Supabase, TPAY_* lub SITE_URL)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return json(401, { error: 'unauthorized' });
  const item = await readItem(request);
  if (!item) return json(400, { error: 'invalid_request' });

  let who: Awaited<ReturnType<typeof payer>>;
  let order: Order;
  try {
    who = await payer(authorization, deps);
    if (!who) return json(401, { error: 'unauthorized' });
    const created = await rpc('create_tpay_order', {
      p_user_id: who.id,
      p_product_id: item.product_id,
      p_event_id: item.event_id,
      p_request_key: item.request_key,
      p_terms_version: item.terms_version,
      p_consent: item.consent,
    }, deps);
    if (!created.ok) {
      const code = created.body?.message;
      if (REFUSALS.has(code)) return json(409, { error: code });
      if (BAD_REQUESTS.has(code)) return json(400, { error: code });
      log(`payments-create: create_tpay_order — ${typeof code === 'string' ? code : 'błąd'}`);
      return json(500, { error: 'order_failed' });
    }
    order = created.body;
  } catch {
    log('payments-create: błąd połączenia z bazą');
    return json(500, { error: 'order_failed' });
  }
  if (order.duplicate) return json(409, { error: 'duplicate_request', order_id: order.order_id });

  const discard = async () => {
    try {
      await rpc('discard_tpay_order', { p_order_id: order.order_id }, deps);
    } catch {
      log(`payments-create: nie usunięto zamówienia ${order.order_id}`);
    }
  };

  if (item.invoice) {
    let saved: Awaited<ReturnType<typeof saveInvoice>> = 'error';
    try {
      saved = await saveInvoice(order.order_id, item.invoice, deps);
    } catch {
      // jak błąd bazy niżej
    }
    if (saved !== 'ok') {
      // Bez NIP-u i danych firmy w logach (§8).
      log(`payments-create: nie zapisano danych faktury w zamówieniu ${order.order_id} (${saved})`);
      await discard();
      return saved === 'invalid' ? json(400, { error: 'invalid_invoice' }) : json(500, { error: 'order_failed' });
    }
  }

  try {
    const tx = await tpayTransaction(order, who, deps);
    if (tx) {
      const attached = await rpc('attach_tpay_transaction', {
        p_order_id: order.order_id,
        p_transaction_id: tx.id,
        p_title: tx.title,
      }, deps);
      if (attached.ok) return json(200, { order_id: order.order_id, payment_url: tx.url });
      log(`payments-create: nie zapisano transakcji w zamówieniu ${order.order_id}`);
    } else {
      log(`payments-create: Tpay odrzucił lub nie odpowiedział (zamówienie ${order.order_id})`);
    }
  } catch {
    log(`payments-create: błąd połączenia z Tpay (zamówienie ${order.order_id})`);
  }
  await discard();
  return json(502, { error: 'payment_failed' });
}
