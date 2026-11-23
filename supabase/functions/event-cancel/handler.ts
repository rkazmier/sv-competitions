/**
 * Edge Function `event-cancel` (SPEC-012 US-5: AC-23, AC-24, AC-51, §7, §8; ADR-0002).
 * Dwa sposoby wywołania (POST, `verify_jwt = false` — rolę sprawdza baza):
 * - panel, JWT admina, `{ event_id, reason }`:
 *   1. konto z `GET /auth/v1/user`;
 *   2. `rpc/cancel_calendar_event` z JWT wywołującego — w jednej transakcji oznaczenie „Odwołane”, anulowanie wejściówek,
 *      zamówienia Tpay → `refund_pending` (bez zlecenia), na miejscu → `refunded`, e-maile `event_cancelled`, `audit_log`;
 *   3. zwroty Tpay (poniżej);
 * - `pg_cron` `mail-send-retry` (`invoke_event_refunds()`), `Authorization: Bearer <MAIL_INVOKE_SECRET>`, bez treści:
 *   tylko dokończenie zwrotów (§7).
 * Zwroty: najwyżej `REFUND_BATCH` na wywołanie (limit czasu Edge Function), po jednym: `rpc/event_refund_claim`
 * (klucz secret, `refund_requested_at = now()`), Tpay `POST /transactions/{id}/refunds` bez kwoty (pełny zwrot);
 * odrzucony → `rpc/revert_order_refund` (zamówienie → `paid`, wejściówka zostaje `cancelled`, AC-51).
 * Brak tokenu Tpay — zamówienie wraca do `paid`, reszta czeka na kolejne wywołanie. `refunded` ustawia `payments-notify`.
 * Logi: tylko id zamówienia / wydarzenia i wynik — bez danych osób i sekretów.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz publishable — zapytania z JWT wywołującego. */
  supabaseKey?: string;
  /** Klucz secret — zlecanie i cofanie zwrotów (`service_role`). */
  secretKey?: string;
  /** Sekret wywołania z `pg_cron` (`MAIL_INVOKE_SECRET`, w Vault `mail_invoke_secret` — ten sam co `mail-send`). */
  invokeSecret?: string;
  tpayApiUrl?: string;
  tpayClientId?: string;
  tpayClientSecret?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
}

/** Zwroty zlecane w jednym wywołaniu (§7: partiami po 20); resztę dokańcza zadanie co 10 min. */
export const REFUND_BATCH = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Odmowy `cancel_calendar_event` → kod HTTP (komunikaty w UI). */
const REFUSALS: Record<string, number> = {
  forbidden: 403,
  event_not_found: 404,
  invalid_cancel_reason: 400,
  event_already_cancelled: 409,
  event_not_published: 409,
  event_ended: 409,
};

export interface RefundResult {
  requested: number;
  failed: number;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Porównanie w stałym czasie (jak `mail-send`). */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function readBody(request: Request): Promise<{ event_id: string; reason: string } | null> {
  try {
    const body = await request.json();
    const eventId = body?.event_id;
    const reason = body?.reason;
    if (typeof eventId !== 'string' || !UUID.test(eventId)) return null;
    if (typeof reason !== 'string') return null;
    const trimmed = reason.trim();
    if ([...trimmed].length < 3 || [...trimmed].length > 200) return null;
    return { event_id: eventId.toLowerCase(), reason: trimmed };
  } catch {
    return null;
  }
}

async function call(url: string, init: RequestInit, deps: Deps): Promise<{ ok: boolean; body: unknown }> {
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

/** Obiekt JSON (nie tablica) albo `null` — zawężenie `unknown`. */
function asObject(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Niepuste pole tekstowe obiektu JSON albo `null`. */
function stringField(body: unknown, key: string): string | null {
  const value = asObject(body)?.[key];
  return typeof value === 'string' && value ? value : null;
}

/** Zlecanie zwrotów odwołanych wydarzeń (pełna kwota). `actorId` — admin albo `null` (zadanie cykliczne). */
export async function processRefunds(actorId: string | null, deps: Deps): Promise<RefundResult> {
  const log = deps.log ?? console.error;
  const { supabaseUrl, secretKey, tpayApiUrl, tpayClientId, tpayClientSecret } = deps.config;
  const asService = { apikey: secretKey!, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const result: RefundResult = { requested: 0, failed: 0 };
  let accessToken: string | null = null;

  async function revert(orderId: string): Promise<void> {
    result.failed++;
    try {
      await call(`${supabaseUrl}/rest/v1/rpc/revert_order_refund`, {
        method: 'POST',
        headers: asService,
        body: JSON.stringify({ p_order_id: orderId, p_actor_id: actorId }),
      }, deps);
    } catch {
      log(`event-cancel: nie cofnięto zlecenia (zamówienie ${orderId})`);
    }
  }

  for (let i = 0; i < REFUND_BATCH; i++) {
    const claimed = await call(`${supabaseUrl}/rest/v1/rpc/event_refund_claim`, {
      method: 'POST',
      headers: asService,
      body: '{}',
    }, deps);
    const row: unknown = claimed.ok && Array.isArray(claimed.body) ? claimed.body[0] : null;
    const orderId = stringField(row, 'id');
    if (!orderId) break;
    const transactionId = stringField(row, 'tpay_transaction_id');

    if (!accessToken) {
      try {
        const token = await call(`${tpayApiUrl}/oauth/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: tpayClientId!, client_secret: tpayClientSecret! }),
        }, deps);
        accessToken = token.ok ? stringField(token.body, 'access_token') : null;
      } catch {
        accessToken = null;
      }
      if (!accessToken) {
        log(`event-cancel: brak tokenu Tpay — zwrot nieudany (zamówienie ${orderId})`);
        await revert(orderId);
        break;
      }
    }

    let accepted = false;
    if (transactionId) {
      try {
        const refund = await call(
          `${tpayApiUrl}/transactions/${encodeURIComponent(transactionId)}/refunds`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: '{}',
          },
          deps,
        );
        accepted = refund.ok && stringField(refund.body, 'result') === 'success';
      } catch {
        accepted = false;
      }
    }
    if (accepted) {
      result.requested++;
      log(`event-cancel: zlecono zwrot (zamówienie ${orderId})`);
    } else {
      log(`event-cancel: Tpay odrzucił zwrot (zamówienie ${orderId})`);
      await revert(orderId);
    }
  }
  return result;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const config = deps.config;
  const required = ['supabaseUrl', 'supabaseKey', 'secretKey', 'tpayApiUrl', 'tpayClientId', 'tpayClientSecret'] as const;
  if (required.some((key) => !config[key])) {
    log('event-cancel: brak konfiguracji (Supabase lub TPAY_*)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return json(401, { error: 'unauthorized' });

  // §7: dokończenie zwrotów przez zadanie cykliczne (sekret wywołania, nie JWT).
  if (config.invokeSecret && safeEqual(authorization, `Bearer ${config.invokeSecret}`)) {
    try {
      return json(200, { refunds: await processRefunds(null, deps) });
    } catch {
      log('event-cancel: błąd połączenia przy dokańczaniu zwrotów');
      return json(500, { error: 'refund_failed' });
    }
  }

  const input = await readBody(request);
  if (!input) return json(400, { error: 'invalid_request' });
  const asCaller = { apikey: config.supabaseKey!, Authorization: authorization, 'Content-Type': 'application/json' };

  let actorId: string;
  let summary: Record<string, unknown>;
  try {
    const user = await call(`${config.supabaseUrl}/auth/v1/user`, { headers: asCaller }, deps);
    const userId = user.ok ? stringField(user.body, 'id') : null;
    if (!userId) return json(401, { error: 'unauthorized' });
    actorId = userId;
    const cancelled = await call(`${config.supabaseUrl}/rest/v1/rpc/cancel_calendar_event`, {
      method: 'POST',
      headers: asCaller,
      body: JSON.stringify({ p_event_id: input.event_id, p_reason: input.reason }),
    }, deps);
    if (!cancelled.ok) {
      const code = stringField(cancelled.body, 'message');
      if (code && code in REFUSALS) return json(REFUSALS[code], { error: code });
      log(`event-cancel: cancel_calendar_event — błąd (wydarzenie ${input.event_id})`);
      return json(500, { error: 'cancel_failed' });
    }
    summary = asObject(cancelled.body) ?? {};
  } catch {
    log(`event-cancel: błąd połączenia z bazą (wydarzenie ${input.event_id})`);
    return json(500, { error: 'cancel_failed' });
  }
  log(`event-cancel: odwołano wydarzenie ${input.event_id}`);

  // Odwołanie jest zatwierdzone — błąd zwrotów nie zmienia odpowiedzi (niewysłane dokończy zadanie cykliczne).
  let refunds: RefundResult = { requested: 0, failed: 0 };
  try {
    refunds = await processRefunds(actorId, deps);
  } catch {
    log(`event-cancel: błąd połączenia przy zwrotach (wydarzenie ${input.event_id})`);
  }
  return json(200, { status: 'cancelled', summary, refunds });
}
