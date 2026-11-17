/**
 * Edge Function `payments-notify` (SPEC-003 AC-9, §7, §8; ADR-0002). Jedyne miejsce, które ustawia status płatności.
 * POST od Tpay (`application/x-www-form-urlencoded`, nagłówek `X-JWS-Signature`):
 * 1. podpis JWS (RS256, certyfikat Tpay ze stałego adresu dla środowiska z `TPAY_API_URL`) — inaczej 401, nic nie zapisujemy;
 * 2. pola `tr_id` (tytuł transakcji), `tr_crc` (id zamówienia), `tr_amount`, `tr_paid`, `tr_status` — kwoty na grosze bez liczb
 *    zmiennoprzecinkowych; `tr_status` `TRUE` / `PAID` = wpłata (inne, np. `CHARGEBACK`, tylko zapisywane — zwroty #53);
 * 3. `rpc/process_tpay_notification` kluczem secret: idempotencja (skrót SHA-256 body), tytuł i kwota zgodne z zamówieniem,
 *    `fulfil_order` (zamówienie → `paid` + uprawnienie) w jednej transakcji bazy.
 * Odpowiedź `TRUE` (Tpay przestaje ponawiać) dla przyjętych i powtórzonych; odrzucone (kwota, tytuł, brak zamówienia) → 400.
 * Logi tylko z id zamówienia i wynikiem — bez e-maila i danych płatnika (§9).
 */
import { type Bytes, certificateUrl, keyLoader, verifyDetachedJws } from './jws.ts';

export interface Config {
  supabaseUrl?: string;
  secretKey?: string;
  tpayApiUrl?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
  /** Pamięć podręczna klucza certyfikatu między żądaniami (index.ts). */
  keyCache?: Map<string, Promise<CryptoKey>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED = new Set(['paid', 'already_paid', 'ignored_status']);

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
  return ACCEPTED.has(result.replace(/^duplicate:/, '')) ? text(200, 'TRUE') : text(400, 'FALSE');
}
