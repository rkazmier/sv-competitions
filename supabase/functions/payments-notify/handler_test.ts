// Testy Deno: `deno test supabase/functions/` (SPEC-003 AC-9, §7; ADR-0002).
import { type Config, handle, toGrosze } from './handler.ts';
import { base64UrlEncode, certificateUrl, pemToDer, publicKeyInfo } from './jws.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  secretKey: SECRET,
  tpayApiUrl: 'https://openapi.sandbox.tpay.com',
};
const CERT_URL = 'https://secure.sandbox.tpay.com/x509/notifications-jws.pem';
const ORDER = '00000000-0000-0000-0000-00000000d001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ===== Certyfikat testowy: minimalny X.509 (DER) z kluczem RSA wygenerowanym w teście =====

function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const content = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) content.set(part, (offset += part.length) - part.length);
  const length = content.length < 0x80
    ? [content.length]
    : content.length < 0x100
    ? [0x81, content.length]
    : [0x82, content.length >> 8, content.length & 0xff];
  return new Uint8Array([tag, ...length, ...content]);
}

function pem(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes)).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

async function signer() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const empty = der(0x30);
  const tbs = der(0x30, der(0xa0, der(0x02, new Uint8Array([2]))), der(0x02, new Uint8Array([1])), empty, empty, empty, empty, spki);
  const certificate = der(0x30, tbs, empty, der(0x03, new Uint8Array([0])));
  const sign = async (body: string, header: Record<string, string> = { alg: 'RS256', x5u: CERT_URL }) => {
    const head = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const input = `${head}.${base64UrlEncode(new TextEncoder().encode(body))}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
    return `${head}..${base64UrlEncode(new Uint8Array(signature))}`;
  };
  return { spki, certificate: pem(certificate), sign };
}

const tpay = await signer();
const other = await signer();

// ===== Zamockowany fetch: certyfikat Tpay i process_tpay_notification =====

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(result: unknown = 'paid', status = 200, certificate = tpay.certificate) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === CERT_URL) return Promise.resolve(new Response(certificate));
    if (url.endsWith('/rpc/process_tpay_notification')) {
      return Promise.resolve(new Response(JSON.stringify(result), { status }));
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const FIELDS = {
  id: '12345',
  tr_id: 'TR-BRA-ABC123',
  tr_date: '2026-11-18 10:00:00',
  tr_crc: ORDER,
  tr_amount: '120.00',
  tr_paid: '120.00',
  tr_desc: `SV ${ORDER}`,
  tr_status: 'TRUE',
  tr_error: 'none',
  tr_email: 'jan@example.test',
  test_mode: '1',
  md5sum: 'x',
};

async function notification(fields: Record<string, string> = FIELDS, signature?: string) {
  const body = new URLSearchParams(fields).toString();
  return new Request('http://localhost/payments-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-JWS-Signature': signature ?? (await tpay.sign(body)),
    },
    body,
  });
}

const rpcCall = (calls: Call[]) => calls.find((call) => call.url.endsWith('/rpc/process_tpay_notification'));

Deno.test('AC-9: poprawne powiadomienie — process_tpay_notification kluczem secret, odpowiedź TRUE', async () => {
  const logs: string[] = [];
  const { calls, fetch } = mockFetch('paid');
  const response = await handle(await notification(), { fetch, config: CONFIG, log: (m) => logs.push(m) });
  assert(response.status === 200 && (await response.text()) === 'TRUE', `status ${response.status}`);
  const call = rpcCall(calls)!;
  assert(call.url === 'https://project.supabase.co/rest/v1/rpc/process_tpay_notification', call.url);
  assert(new Headers(call.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'klucz secret');
  const args = JSON.parse(String(call.init.body));
  assert(args.p_order_id === ORDER && args.p_transaction_title === 'TR-BRA-ABC123', JSON.stringify(args));
  assert(args.p_amount === 12000 && args.p_paid === 12000 && args.p_is_payment === true, JSON.stringify(args));
  assert(/^[0-9a-f]{64}$/.test(args.p_payload_hash), 'skrót SHA-256 body');
  assert(!JSON.stringify(args).includes('jan@example.test'), 'e-mail płatnika nie trafia do bazy');
  assert(!logs.join().includes('jan@example.test') && !logs.join().includes(SECRET), logs.join());
});

Deno.test('AC-9: certyfikat z adresu Tpay dla środowiska, klucz w pamięci podręcznej', async () => {
  assert(certificateUrl('https://api.tpay.com/') === 'https://secure.tpay.com/x509/notifications-jws.pem', 'produkcja');
  assert(certificateUrl('https://openapi.sandbox.tpay.com') === CERT_URL, 'sandbox');
  assert(certificateUrl('https://evil.example') === undefined, 'nieznane środowisko');
  const keyCache = new Map<string, Promise<CryptoKey>>();
  const { calls, fetch } = mockFetch();
  for (let i = 0; i < 2; i++) {
    const response = await handle(await notification(), { fetch, config: CONFIG, keyCache, log: () => {} });
    assert(response.status === 200, `status ${response.status}`);
  }
  assert(calls.filter((call) => call.url === CERT_URL).length === 1, 'certyfikat pobrany raz');
  const spki = publicKeyInfo(pemToDer(tpay.certificate));
  assert(spki.join() === tpay.spki.join(), 'SPKI z certyfikatu');
});

Deno.test('ADR-0002: zły podpis, inny klucz, obcy x5u, zmienione body lub brak nagłówka — 401, baza nietknięta', async () => {
  const body = new URLSearchParams(FIELDS).toString();
  const tampered = { ...FIELDS, tr_amount: '1.00', tr_paid: '1.00' };
  const signatures = [
    '',
    'abc',
    await other.sign(body),
    await tpay.sign(body, { alg: 'RS256', x5u: 'https://evil.example/cert.pem' }),
    await tpay.sign(body, { alg: 'HS256', x5u: CERT_URL }),
  ];
  for (const signature of signatures) {
    const { calls, fetch } = mockFetch();
    const response = await handle(await notification(FIELDS, signature), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 401, `status ${response.status} dla „${signature.slice(0, 20)}”`);
    assert(!rpcCall(calls), 'bez wywołania bazy');
  }
  const { calls, fetch } = mockFetch();
  const response = await handle(await notification(tampered, await tpay.sign(body)), { fetch, config: CONFIG, log: () => {} });
  assert(response.status === 401 && !rpcCall(calls), 'zmienione body');
});

Deno.test('§7: kwota niezgodna lub obcy tytuł transakcji — 400 FALSE (wynik bazy, wpis bez danych osobowych)', async () => {
  for (const result of ['amount_mismatch', 'transaction_mismatch', 'order_not_found', 'duplicate:amount_mismatch']) {
    const logs: string[] = [];
    const { fetch } = mockFetch(result);
    const response = await handle(await notification(), { fetch, config: CONFIG, log: (m) => logs.push(m) });
    assert(response.status === 400 && (await response.text()) === 'FALSE', `${result}: ${response.status}`);
    assert(logs.some((m) => m.includes(ORDER) && m.includes(result)), logs.join());
    assert(!logs.join().includes('jan@example.test'), 'bez e-maila w logach');
  }
});

Deno.test('§7: powtórzone powiadomienie — TRUE bez zmian (idempotencja w bazie)', async () => {
  for (const result of ['duplicate:paid', 'already_paid', 'ignored_status']) {
    const { fetch } = mockFetch(result);
    const response = await handle(await notification(), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 200 && (await response.text()) === 'TRUE', `${result}: ${response.status}`);
  }
});

Deno.test('AC-9: stan inny niż wpłata (CHARGEBACK, FALSE) — p_is_payment = false; PAID — wpłata', async () => {
  for (const [status, isPayment] of [['CHARGEBACK', false], ['FALSE', false], ['PAID', true]] as const) {
    const { calls, fetch } = mockFetch('ignored_status');
    await handle(await notification({ ...FIELDS, tr_status: status }), { fetch, config: CONFIG, log: () => {} });
    assert(JSON.parse(String(rpcCall(calls)!.init.body)).p_is_payment === isPayment, status);
  }
});

Deno.test('AC-9: kwoty Tpay → grosze bez liczb zmiennoprzecinkowych', () => {
  const cases: [string | null, number | null][] = [['120.00', 12000], ['19.99', 1999], ['0.1', 10], ['5', 500],
    ['1.005', null], ['-1.00', null], ['1,00', null], ['', null], [null, null]];
  for (const [value, expected] of cases) assert(toGrosze(value) === expected, `${value} → ${toGrosze(value)}`);
});

Deno.test('AC-9: niepełne powiadomienie (zły tr_crc, brak kwoty) — 400 bez wywołania bazy', async () => {
  for (const fields of [{ ...FIELDS, tr_crc: 'abc' }, { ...FIELDS, tr_paid: '' }, { ...FIELDS, tr_id: '' }]) {
    const { calls, fetch } = mockFetch();
    const response = await handle(await notification(fields), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 400 && !rpcCall(calls), JSON.stringify(fields));
  }
});

Deno.test('§8: błąd bazy — 500 (Tpay ponowi), brak konfiguracji — 500, GET — 405', async () => {
  const { fetch } = mockFetch({ message: 'boom' }, 500);
  assert((await handle(await notification(), { fetch, config: CONFIG, log: () => {} })).status === 500, 'błąd bazy');
  for (const config of [{ ...CONFIG, secretKey: undefined }, { ...CONFIG, tpayApiUrl: 'https://evil.example' }]) {
    const mock = mockFetch();
    const response = await handle(await notification(), { fetch: mock.fetch, config, log: () => {} });
    assert(response.status === 500 && mock.calls.length === 0, 'brak konfiguracji');
  }
  const get = await handle(new Request('http://localhost/'), { fetch, config: CONFIG });
  assert(get.status === 405, `status ${get.status}`);
});
