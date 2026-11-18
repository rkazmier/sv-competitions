// Testy Deno: `deno test supabase/functions/` (SPEC-003 AC-8, AC-18, §7).
import { type Config, handle, TPAY_DESCRIPTION_MAX, tpayDescription } from './handler.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const TPAY_SECRET = 'TPAY_CLIENT_SECRET_VALUE';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseKey: 'sb_publishable_test',
  secretKey: SECRET,
  tpayApiUrl: 'https://openapi.sandbox.tpay.com',
  tpayClientId: 'client-id',
  tpayClientSecret: TPAY_SECRET,
  tpayNotificationUrl: 'https://project.supabase.co/functions/v1/payments-notify',
  siteUrl: 'https://events.steel-valley.pl/',
};
const USER = '00000000-0000-0000-0000-0000000000c1';
const ORDER = '00000000-0000-0000-0000-00000000d001';
const PRODUCT = '00000000-0000-0000-0000-00000000f001';
const KEY = '00000000-0000-0000-0000-00000000aaaa';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  init: RequestInit;
}

interface Mock {
  user?: number;
  fullName?: string | null;
  order?: { status: number; body: unknown };
  token?: number;
  transaction?: { status: number; body: unknown } | 'network';
  invoice?: { status: number; body: unknown };
}

const ORDER_OK = {
  order_id: ORDER,
  order_number: 'SV-2026-000123',
  amount: 12000,
  item_name: 'Karnet 10 wejść',
  duplicate: false,
};
const TX_OK = {
  result: 'success',
  transactionId: '01TPAYTXID',
  title: 'TR-BRA-ABC123',
  transactionPaymentUrl: 'https://secure.sandbox.tpay.com/?title=TR-BRA-ABC123',
};

/** Zamockowany fetch: Auth, profil, funkcje zamówień, OAuth i transakcje Tpay. */
function mockFetch(
  { user = 200, fullName = 'Jan Kowalski', order = { status: 200, body: ORDER_OK }, token = 200, transaction, invoice }: Mock = {},
) {
  const calls: Call[] = [];
  const tx = transaction ?? { status: 200, body: TX_OK };
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return reply(user, user === 200 ? { id: USER, email: 'jan@example.test' } : {});
    if (url.includes('/rest/v1/profiles')) return reply(200, [{ full_name: fullName }]);
    if (url.endsWith('/rpc/create_tpay_order')) return reply(order.status, order.body);
    if (url.endsWith('/rpc/set_order_invoice_details')) {
      return invoice ? reply(invoice.status, invoice.body) : Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/rpc/attach_tpay_transaction') || url.endsWith('/rpc/discard_tpay_order')) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/oauth/auth')) return reply(token, token === 200 ? { access_token: 'tpay-token' } : {});
    if (url.endsWith('/transactions')) {
      return tx === 'network' ? Promise.reject(new TypeError('network')) : reply(tx.status, tx.body);
    }
    return reply(500, 'unexpected');
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const post = (body: unknown, authorization: string | null = 'Bearer user-jwt') =>
  new Request('http://localhost/payments-create', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify(body),
  });

const callTo = (calls: Call[], suffix: string) => calls.find((call) => call.url.endsWith(suffix));
const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body));

Deno.test('AC-8: zamówienie pending z ceną z bazy, transakcja Tpay i adres bramki', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY, amount: 1 }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  const result = await response.json();
  assert(result.order_id === ORDER && result.payment_url === TX_OK.transactionPaymentUrl, JSON.stringify(result));

  const order = callTo(calls, '/rpc/create_tpay_order');
  const args = bodyOf(order);
  assert(args.p_user_id === USER && args.p_product_id === PRODUCT && args.p_event_id === null, JSON.stringify(args));
  assert(args.p_request_key === KEY && !('amount' in args) && !('p_amount' in args), 'cena nie z przeglądarki');
  assert(new Headers(order!.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'zamówienie kluczem secret');

  const oauth = callTo(calls, '/oauth/auth')!;
  assert(oauth.url === 'https://openapi.sandbox.tpay.com/oauth/auth', oauth.url);
  assert(String(oauth.init.body).includes('client_id=client-id'), 'client credentials');

  const tx = bodyOf(callTo(calls, '/transactions'));
  assert(tx.amount === 120, `kwota ${tx.amount}`);
  assert(tx.description === 'SV-2026-000123 — Karnet 10 wejść', `SPEC-006 AC-14: opis ${tx.description}`);
  assert(tx.hiddenDescription === ORDER, 'hiddenDescription = id zamówienia (tr_crc)');
  assert(tx.payer.email === 'jan@example.test' && tx.payer.name === 'Jan Kowalski', JSON.stringify(tx.payer));
  assert(tx.callbacks.notification.url === CONFIG.tpayNotificationUrl, 'powiadomienie na payments-notify');
  const back = `https://events.steel-valley.pl/konto/platnosc/?order=${ORDER}`;
  assert(tx.callbacks.payerUrls.success === back && tx.callbacks.payerUrls.error === back, 'powrót na /konto/platnosc/');

  const attached = bodyOf(callTo(calls, '/rpc/attach_tpay_transaction'));
  assert(attached.p_transaction_id === '01TPAYTXID' && attached.p_title === 'TR-BRA-ABC123', JSON.stringify(attached));
  assert(!callTo(calls, '/rpc/discard_tpay_order'), 'zamówienie nie powinno być usunięte');
});

Deno.test('AC-8: płatnik bez imienia w profilu — nazwą płatnika jest e-mail', async () => {
  const { calls, fetch } = mockFetch({ fullName: null });
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  assert(bodyOf(callTo(calls, '/transactions')).payer.name === 'jan@example.test', 'nazwa = e-mail');
});

Deno.test('AC-8: wejściówka — event_id przekazany do create_tpay_order', async () => {
  const { calls, fetch } = mockFetch();
  const event = '00000000-0000-0000-0000-00000000e001';
  const response = await handle(post({ event_id: event, request_key: KEY }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  const args = bodyOf(callTo(calls, '/rpc/create_tpay_order'));
  assert(args.p_event_id === event && args.p_product_id === null, JSON.stringify(args));
});

Deno.test('AC-8: bez sesji — 401, bez zamówienia', async () => {
  for (const [authorization, user] of [[null, 200], ['Bearer expired', 401]] as const) {
    const { calls, fetch } = mockFetch({ user });
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY }, authorization), { fetch, config: CONFIG });
    assert(response.status === 401, `status ${response.status}`);
    assert(!callTo(calls, '/rpc/create_tpay_order'), 'bez zamówienia');
  }
});

Deno.test('AC-8: niepoprawne żądanie — 400 (brak klucza, oba albo żaden z produktu i wydarzenia)', async () => {
  const bodies = [{ product_id: PRODUCT }, { request_key: KEY }, { product_id: PRODUCT, event_id: PRODUCT, request_key: KEY },
    { product_id: 'abc', request_key: KEY }, 'nie-json'];
  for (const body of bodies) {
    const { calls, fetch } = mockFetch();
    const response = await handle(post(body), { fetch, config: CONFIG });
    assert(response.status === 400, `status ${response.status} dla ${JSON.stringify(body)}`);
    assert(calls.length === 0, 'bez wywołań');
  }
});

Deno.test('AC-18, §7: odmowa bazy (wyprzedane, ukryty produkt, sprzedaż zakończona) — 409 bez transakcji Tpay', async () => {
  for (const code of ['sold_out', 'product_unavailable', 'sales_closed', 'event_unavailable']) {
    const { calls, fetch } = mockFetch({ order: { status: 400, body: { code: 'P0001', message: code } } });
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), { fetch, config: CONFIG });
    assert(response.status === 409, `status ${response.status}`);
    assert((await response.json()).error === code, code);
    assert(!callTo(calls, '/oauth/auth') && !callTo(calls, '/transactions'), 'bez Tpay');
  }
});

Deno.test('§7: podwójne kliknięcie „Zapłać” (ten sam request_key) — 409 duplicate_request, bez drugiej transakcji', async () => {
  const { calls, fetch } = mockFetch({ order: { status: 200, body: { ...ORDER_OK, duplicate: true } } });
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), { fetch, config: CONFIG });
  assert(response.status === 409, `status ${response.status}`);
  const body = await response.json();
  assert(body.error === 'duplicate_request' && body.order_id === ORDER, JSON.stringify(body));
  assert(!callTo(calls, '/transactions'), 'bez transakcji Tpay');
});

Deno.test('§7: Tpay niedostępny — 502, zamówienie usunięte, sekrety nie trafiają do odpowiedzi ani logów', async () => {
  const cases: Mock[] = [{ token: 503 }, { transaction: { status: 500, body: {} } }, { transaction: 'network' },
    { transaction: { status: 200, body: { ...TX_OK, transactionPaymentUrl: 'javascript:alert(1)' } } }];
  for (const mock of cases) {
    const logs: string[] = [];
    const { calls, fetch } = mockFetch(mock);
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), {
      fetch,
      config: CONFIG,
      log: (m) => logs.push(m),
    });
    assert(response.status === 502, `status ${response.status}`);
    assert(bodyOf(callTo(calls, '/rpc/discard_tpay_order')).p_order_id === ORDER, 'zamówienie usunięte');
    assert(!callTo(calls, '/rpc/attach_tpay_transaction'), 'bez zapisu transakcji');
    const text = (await response.text()) + logs.join();
    assert(!text.includes(SECRET) && !text.includes(TPAY_SECRET) && !text.includes('jan@example.test'), text);
  }
});

// ===== SPEC-004 AC-5: dane do faktury =====

const INVOICE = {
  nip: 'PL 526-025-09-95',
  company_name: 'Firma Testowa sp. z o.o.',
  company_address: 'ul. Prosta 1, 00-001 Warszawa',
  data_source: 'vat_whitelist',
  fetched_at: '2026-11-18T10:00:00.000Z',
};

Deno.test('SPEC-004 AC-5: dane faktury zapisane w zamówieniu i w billing_details przed transakcją Tpay', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY, invoice: INVOICE }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  const call = callTo(calls, '/rpc/set_order_invoice_details');
  const args = bodyOf(call);
  assert(args.p_order_id === ORDER && args.p_nip === INVOICE.nip && args.p_company_name === INVOICE.company_name, JSON.stringify(args));
  assert(args.p_company_address === INVOICE.company_address && args.p_data_source === 'vat_whitelist', JSON.stringify(args));
  assert(args.p_fetched_at === INVOICE.fetched_at && args.p_save_billing_details === true, 'kopia + billing_details');
  assert(new Headers(call!.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'kluczem secret');
  assert(calls.indexOf(call!) < calls.indexOf(callTo(calls, '/transactions')!), 'przed transakcją Tpay');
});

Deno.test('SPEC-004 AC-5: bez faktury — set_order_invoice_details nie jest wołane', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY, invoice: null }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  assert(!callTo(calls, '/rpc/set_order_invoice_details'), 'bez danych faktury');
});

Deno.test('SPEC-004 AC-5: niepoprawny kształt danych faktury — 400 bez zamówienia', async () => {
  for (const invoice of [{ ...INVOICE, nip: 123 }, { ...INVOICE, company_name: 'x'.repeat(401) }, { ...INVOICE, fetched_at: 'wczoraj' }, 'NIP']) {
    const { calls, fetch } = mockFetch();
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY, invoice }), { fetch, config: CONFIG });
    assert(response.status === 400, `status ${response.status} dla ${JSON.stringify(invoice)}`);
    assert(calls.length === 0, 'bez wywołań');
  }
});

Deno.test('SPEC-004 AC-5: baza odrzuca dane faktury — 400 invalid_invoice, zamówienie usunięte, NIP nie w logach', async () => {
  for (const [mock, status, error] of [
    [{ status: 400, body: { code: '22023', message: 'invalid_nip' } }, 400, 'invalid_invoice'],
    [{ status: 500, body: { code: 'XX000', message: 'boom' } }, 500, 'order_failed'],
  ] as const) {
    const logs: string[] = [];
    const { calls, fetch } = mockFetch({ invoice: mock });
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY, invoice: { ...INVOICE, nip: '5260250996' } }), {
      fetch,
      config: CONFIG,
      log: (m) => logs.push(m),
    });
    assert(response.status === status, `status ${response.status}`);
    assert((await response.json()).error === error, error);
    assert(bodyOf(callTo(calls, '/rpc/discard_tpay_order')).p_order_id === ORDER, 'zamówienie usunięte');
    assert(!callTo(calls, '/transactions'), 'bez transakcji Tpay');
    assert(!logs.join().includes('5260250996') && !logs.join().includes('Firma Testowa'), logs.join());
  }
});

Deno.test('§8: brak konfiguracji — 500 bez wywołań', async () => {
  for (const config of [{ ...CONFIG, tpayClientSecret: undefined }, { ...CONFIG, siteUrl: undefined }]) {
    const { calls, fetch } = mockFetch();
    const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), { fetch, config, log: () => {} });
    assert(response.status === 500, `status ${response.status}`);
    assert(calls.length === 0, 'bez wywołań');
  }
});

Deno.test('CORS: OPTIONS — 204, GET — 405', async () => {
  const { fetch } = mockFetch();
  const options = await handle(new Request('http://localhost/', { method: 'OPTIONS' }), { fetch, config: CONFIG });
  assert(options.status === 204 && options.headers.get('Access-Control-Allow-Origin') === '*', 'CORS');
  const get = await handle(new Request('http://localhost/'), { fetch, config: CONFIG });
  assert(get.status === 405, `status ${get.status}`);
});

Deno.test('SPEC-006 AC-14: opis transakcji Tpay — numer zamówienia, półpauza i nazwa', () => {
  assert(tpayDescription('SV-2026-000123', 'Wejściówka: Puchar') === 'SV-2026-000123 — Wejściówka: Puchar', 'krótki opis');
  const exact = 'x'.repeat(TPAY_DESCRIPTION_MAX - 'SV-2026-000123 — '.length);
  assert(tpayDescription('SV-2026-000123', exact) === `SV-2026-000123 — ${exact}`, 'dokładnie 128 znaków — bez skracania');
});

Deno.test('SPEC-006 AC-14: za długa nazwa skrócona do 128 znaków z „…”, numer nigdy', () => {
  const name = 'Wejściówka: ' + 'Zawody strzeleckie ąęś '.repeat(10);
  for (const number of ['SV-2026-000123', 'SV-2031-1000000']) {
    const description = tpayDescription(number, name);
    assert(Array.from(description).length <= TPAY_DESCRIPTION_MAX, `długość ${Array.from(description).length}`);
    assert(description.startsWith(`${number} — Wejściówka: Zawody`), description);
    assert(description.endsWith('…') && !description.endsWith(' …'), description);
  }
});

Deno.test('SPEC-006 AC-14: długi opis w żądaniu do Tpay jest skrócony', async () => {
  const long = { ...ORDER_OK, item_name: 'Wejściówka: ' + 'a'.repeat(188) };
  const { calls, fetch } = mockFetch({ order: { status: 200, body: long } });
  const response = await handle(post({ product_id: PRODUCT, request_key: KEY }), { fetch, config: CONFIG });
  assert(response.status === 200, `status ${response.status}`);
  const tx = bodyOf(callTo(calls, '/transactions'));
  assert(tx.description.length === TPAY_DESCRIPTION_MAX && tx.description.startsWith('SV-2026-000123 — '), tx.description);
  assert(tx.hiddenDescription === ORDER, 'hiddenDescription bez zmian');
});
