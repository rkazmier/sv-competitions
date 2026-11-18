/**
 * Edge Function `payments-refund` (SPEC-003 AC-25, AC-27, §8; ADR-0002). Tylko admin, zwrot pełnej kwoty zamówienia Tpay.
 * POST `{ order_id, refund_note? }` z JWT admina:
 * 1. konto z `GET /auth/v1/user` (JWT wywołującego);
 * 2. `rpc/cancel_order` z JWT wywołującego — baza sprawdza rolę admina, stan `paid` i brak zużycia uprawnienia (AC-26),
 *    uprawnienie → `cancelled`, zamówienie Tpay → `refund_pending`, wpis `order_refund` w `audit_log` (AC-27);
 *    zamówienie „na miejscu” → od razu `refunded` (bez Tpay);
 * 3. Tpay Open API: token OAuth, `POST /transactions/{id}/refunds` bez kwoty = zwrot pełnej kwoty;
 *    `refunded` ustawia później `payments-notify` po powiadomieniu `CHARGEBACK`.
 * Tpay odrzucił / nie odpowiedział → `rpc/revert_order_refund` (zamówienie wraca do `paid`) i 502 `refund_failed`.
 * Odpowiedź `{ status }`. Sekrety i dane osób nie trafiają do logów.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz publishable — zapytania z JWT wywołującego. */
  supabaseKey?: string;
  /** Klucz secret — odczyt transakcji i cofnięcie zlecenia (`service_role`). */
  secretKey?: string;
  tpayApiUrl?: string;
  tpayClientId?: string;
  tpayClientSecret?: string;
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
/** Odmowy `cancel_order` → kod HTTP (komunikaty w UI). */
const REFUSALS: Record<string, number> = { forbidden: 403, order_not_found: 404, order_not_paid: 409, pass_used: 409 };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function readBody(request: Request): Promise<{ order_id: string; refund_note: string | null } | null> {
  try {
    const body = await request.json();
    const orderId = body?.order_id;
    const note = body?.refund_note;
    if (typeof orderId !== 'string' || !UUID.test(orderId)) return null;
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300)) return null;
    return { order_id: orderId.toLowerCase(), refund_note: note?.trim() || null };
  } catch {
    return null;
  }
}

async function call(url: string, init: RequestInit, deps: Deps): Promise<{ ok: boolean; body: any }> {
  const response = await deps.fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, body };
}

/** Zlecenie zwrotu pełnej kwoty w Tpay; `true` — przyjęte. */
async function tpayRefund(transactionId: string, deps: Deps): Promise<boolean> {
  const { tpayApiUrl, tpayClientId, tpayClientSecret } = deps.config;
  const token = await call(`${tpayApiUrl}/oauth/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: tpayClientId!, client_secret: tpayClientSecret! }),
  }, deps);
  const accessToken = token.ok ? token.body?.access_token : null;
  if (typeof accessToken !== 'string') return false;
  const refund = await call(`${tpayApiUrl}/transactions/${encodeURIComponent(transactionId)}/refunds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, deps);
  return refund.ok && refund.body?.result === 'success';
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const config = deps.config;
  const required = ['supabaseUrl', 'supabaseKey', 'secretKey', 'tpayApiUrl', 'tpayClientId', 'tpayClientSecret'] as const;
  if (required.some((key) => !config[key])) {
    log('payments-refund: brak konfiguracji (Supabase lub TPAY_*)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return json(401, { error: 'unauthorized' });
  const input = await readBody(request);
  if (!input) return json(400, { error: 'invalid_request' });

  const { supabaseUrl, supabaseKey, secretKey } = config;
  const asCaller = { apikey: supabaseKey!, Authorization: authorization, 'Content-Type': 'application/json' };
  const asService = { apikey: secretKey!, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const orderId = input.order_id;

  let actorId: string;
  let status: string;
  try {
    const user = await call(`${supabaseUrl}/auth/v1/user`, { headers: asCaller }, deps);
    if (!user.ok || typeof user.body?.id !== 'string') return json(401, { error: 'unauthorized' });
    actorId = user.body.id;
    const cancelled = await call(`${supabaseUrl}/rest/v1/rpc/cancel_order`, {
      method: 'POST',
      headers: asCaller,
      body: JSON.stringify({ p_order_id: orderId, p_refund_note: input.refund_note }),
    }, deps);
    if (!cancelled.ok) {
      const code = cancelled.body?.message;
      if (typeof code === 'string' && code in REFUSALS) return json(REFUSALS[code], { error: code });
      log(`payments-refund: cancel_order — błąd (zamówienie ${orderId})`);
      return json(500, { error: 'refund_failed' });
    }
    status = String(cancelled.body);
  } catch {
    log(`payments-refund: błąd połączenia z bazą (zamówienie ${orderId})`);
    return json(500, { error: 'refund_failed' });
  }
  if (status !== 'refund_pending') return json(200, { status });

  try {
    const order = await call(
      `${supabaseUrl}/rest/v1/orders?id=eq.${orderId}&select=tpay_transaction_id`,
      { headers: asService },
      deps,
    );
    const transactionId = order.ok ? order.body?.[0]?.tpay_transaction_id : null;
    if (typeof transactionId === 'string' && await tpayRefund(transactionId, deps)) {
      log(`payments-refund: zlecono zwrot (zamówienie ${orderId})`);
      return json(200, { status });
    }
    log(`payments-refund: Tpay odrzucił zwrot (zamówienie ${orderId})`);
  } catch {
    log(`payments-refund: błąd połączenia z Tpay (zamówienie ${orderId})`);
  }
  try {
    await call(`${supabaseUrl}/rest/v1/rpc/revert_order_refund`, {
      method: 'POST',
      headers: asService,
      body: JSON.stringify({ p_order_id: orderId, p_actor_id: actorId }),
    }, deps);
  } catch {
    log(`payments-refund: nie cofnięto zlecenia (zamówienie ${orderId})`);
  }
  return json(502, { error: 'refund_failed' });
}
