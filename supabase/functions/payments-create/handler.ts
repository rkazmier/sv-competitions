/**
 * Edge Function `payments-create` (SPEC-003 AC-8, AC-18, §7, §8; ADR-0002).
 * POST `{ product_id | event_id, request_key }` z JWT zalogowanej osoby:
 * 1. konto z `GET /auth/v1/user` (JWT wywołującego), imię i nazwisko z `profiles` (RLS: własny wiersz);
 * 2. `rpc/create_tpay_order` kluczem secret — zamówienie `pending` z ceną z bazy (nie z przeglądarki),
 *    limit miejsc wejściówki z blokadą wiersza wydarzenia, ten sam `request_key` → 409 `duplicate_request`;
 * 3. Tpay Open API: token OAuth (client credentials), transakcja z kwotą, opisem „SV <id zamówienia>”,
 *    `hiddenDescription` = id zamówienia (wraca jako `tr_crc`), e-mailem i imieniem płatnika, powiadomieniem
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
/** Odmowy `create_tpay_order` → 409 z tym samym kodem (komunikaty w UI, #50/#51). */
const REFUSALS = new Set(['product_unavailable', 'event_unavailable', 'sales_closed', 'sold_out']);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface Item {
  product_id: string | null;
  event_id: string | null;
  request_key: string;
}

async function readItem(request: Request): Promise<Item | null> {
  try {
    const body = await request.json();
    const id = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);
    const item = { product_id: id(body?.product_id), event_id: id(body?.event_id), request_key: id(body?.request_key) };
    if (!item.request_key || Boolean(item.product_id) === Boolean(item.event_id)) return null;
    return item as Item;
  } catch {
    return null;
  }
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

/** Transakcja Tpay; `null` — Tpay niedostępny lub odmówił. */
async function tpayTransaction(
  order: { order_id: string; amount: number },
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
      description: `SV ${order.order_id}`,
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
  let order: { order_id: string; amount: number; duplicate: boolean };
  try {
    who = await payer(authorization, deps);
    if (!who) return json(401, { error: 'unauthorized' });
    const created = await rpc('create_tpay_order', {
      p_user_id: who.id,
      p_product_id: item.product_id,
      p_event_id: item.event_id,
      p_request_key: item.request_key,
    }, deps);
    if (!created.ok) {
      const code = created.body?.message;
      if (REFUSALS.has(code)) return json(409, { error: code });
      log(`payments-create: create_tpay_order — ${typeof code === 'string' ? code : 'błąd'}`);
      return json(500, { error: 'order_failed' });
    }
    order = created.body;
  } catch {
    log('payments-create: błąd połączenia z bazą');
    return json(500, { error: 'order_failed' });
  }
  if (order.duplicate) return json(409, { error: 'duplicate_request', order_id: order.order_id });

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
  try {
    await rpc('discard_tpay_order', { p_order_id: order.order_id }, deps);
  } catch {
    log(`payments-create: nie usunięto zamówienia ${order.order_id}`);
  }
  return json(502, { error: 'payment_failed' });
}
