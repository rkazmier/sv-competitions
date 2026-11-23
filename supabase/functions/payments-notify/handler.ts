/**
 * Edge Function `payments-notify` (SPEC-003 AC-9, §7, §8; ADR-0002). Jedyne miejsce, które ustawia status płatności.
 * POST od Tpay (`application/x-www-form-urlencoded`, nagłówek `X-JWS-Signature`):
 * 1. podpis JWS (RS256, certyfikat Tpay ze stałego adresu dla środowiska z `TPAY_API_URL`) — inaczej 401, nic nie zapisujemy;
 * 2. pola `tr_id` (tytuł transakcji), `tr_crc` (id zamówienia), `tr_amount`, `tr_paid`, `tr_status` — kwoty na grosze bez liczb
 *    zmiennoprzecinkowych; `tr_status` `TRUE` / `PAID` = wpłata, `CHARGEBACK` = zwrot (AC-25), inne tylko zapisywane;
 * 3. `rpc/process_tpay_notification` kluczem secret: idempotencja (skrót SHA-256 body), tytuł i kwota zgodne z zamówieniem,
 *    `fulfil_order` (zamówienie → `paid` + uprawnienie) albo zwrot (`refund_pending` → `refunded`) w jednej transakcji bazy.
 * Odpowiedź `TRUE` (Tpay przestaje ponawiać) dla przyjętych i powtórzonych; odrzucone (kwota, tytuł, brak zamówienia) → 400.
 * Logi tylko z id zamówienia i wynikiem — bez e-maila i danych płatnika (§9).
 */
import { type Bytes, certificateUrl, keyLoader, verifyDetachedJws } from './jws.ts';

export interface Config {
  supabaseUrl?: string;
  secretKey?: string;
  tpayApiUrl?: string;
  /** SPEC-012 AC-9: sekret wywołania `mail-send` (`MAIL_INVOKE_SECRET`); bez niego e-mail wyśle `pg_cron`. */
  mailInvokeSecret?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
  /** Pamięć podręczna klucza certyfikatu między żądaniami (index.ts). */
  keyCache?: Map<string, Promise<CryptoKey>>;
  /** Praca po odpowiedzi dla Tpay (`EdgeRuntime.waitUntil`); bez niej — czekamy na wynik (testy). */
  background?: (work: Promise<unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED = new Set(['paid', 'already_paid', 'refunded', 'already_refunded', 'ignored_status']);

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

/** Kwota Tpay („120.00”, „120.5”, „120”) → grosze; `null` — niepoprawna. */
export function toGrosze(value: string | null): number | null {
  const match = value?.trim().match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SPEC-012 AC-9, ADR-0009: wywołanie Edge Function `mail-send` z sekretem wywołania (bez JWT). */
async function invokeMailSend(deps: Deps, supabaseUrl: string, orderId: string, log: (m: string) => void): Promise<void> {
  const secret = deps.config.mailInvokeSecret;
  if (!secret) {
    log(`payments-notify: brak MAIL_INVOKE_SECRET — e-mail zamówienia ${orderId} wyśle zadanie cykliczne`);
    return;
  }
  try {
    const response = await deps.fetch(`${supabaseUrl}/functions/v1/mail-send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    await response.body?.cancel();
    if (!response.ok) log(`payments-notify: mail-send odpowiedziało ${response.status} (zamówienie ${orderId})`);
  } catch {
    log(`payments-notify: błąd wywołania mail-send (zamówienie ${orderId})`);
  }
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method !== 'POST') return text(405, 'FALSE');

  const { supabaseUrl, secretKey, tpayApiUrl } = deps.config;
  const certUrl = tpayApiUrl ? certificateUrl(tpayApiUrl) : undefined;
  if (!supabaseUrl || !secretKey || !certUrl) {
    log('payments-notify: brak konfiguracji (SUPABASE_URL, klucz secret lub znany TPAY_API_URL)');
    return text(500, 'FALSE');
  }

  const body = new Uint8Array(await request.arrayBuffer());
  let valid = false;
  try {
    const signature = request.headers.get('X-JWS-Signature') ?? '';
    valid = await verifyDetachedJws(signature, body, certUrl, keyLoader(deps.fetch, deps.keyCache));
  } catch {
    log('payments-notify: nie pobrano certyfikatu Tpay');
    return text(500, 'FALSE');
  }
  if (!valid) {
    log('payments-notify: niepoprawny podpis JWS — odrzucone');
    return text(401, 'FALSE');
  }

  const form = new URLSearchParams(new TextDecoder().decode(body));
  const title = form.get('tr_id') ?? '';
  const orderId = form.get('tr_crc') ?? '';
  const amount = toGrosze(form.get('tr_amount'));
  const paid = toGrosze(form.get('tr_paid'));
  if (!title || !UUID.test(orderId) || amount === null || paid === null) {
    log('payments-notify: niepełne powiadomienie — odrzucone');
    return text(400, 'FALSE');
  }

  let result: string;
  try {
    const response = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/process_tpay_notification`, {
      method: 'POST',
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_payload_hash: await sha256Hex(body),
        p_transaction_title: title,
        p_order_id: orderId.toLowerCase(),
        p_amount: amount,
        p_paid: paid,
        p_is_payment: ['TRUE', 'PAID'].includes(form.get('tr_status') ?? ''),
        p_is_refund: form.get('tr_status') === 'CHARGEBACK',
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      log(`payments-notify: process_tpay_notification odpowiedziało ${response.status} (zamówienie ${orderId})`);
      return text(500, 'FALSE');
    }
    result = String(await response.json());
  } catch {
    log(`payments-notify: błąd połączenia z bazą (zamówienie ${orderId})`);
    return text(500, 'FALSE');
  }

  log(`payments-notify: zamówienie ${orderId} — ${result}`);
  // SPEC-012 AC-9: wpis `order_paid` w `email_outbox` jest już zatwierdzony razem z realizacją — wysyłka od razu.
  // Błąd wywołania nie zmienia odpowiedzi dla Tpay: wpis wyśle `pg_cron` `mail-send-retry`.
  if (result === 'paid') {
    const work = invokeMailSend(deps, supabaseUrl, orderId, log);
    if (deps.background) deps.background(work);
    else await work;
  }
  return ACCEPTED.has(result.replace(/^duplicate:/, '')) ? text(200, 'TRUE') : text(400, 'FALSE');
}
