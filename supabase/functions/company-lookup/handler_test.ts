// Testy Deno: `deno test supabase/functions/` (SPEC-004 AC-2, AC-3, AC-4, §7, §8).
import { type Config, handle, isValidNip, normalizeNip } from './handler.ts';

const CONFIG: Config = { supabaseUrl: 'https://project.supabase.co', supabaseKey: 'sb_publishable_test' };
const BIR_KEY = 'gus_bir_SECRET_KEY';
const NIP = '5260250274';
const NOW = () => new Date('2026-11-18T23:30:00Z'); // w Warszawie już 19 listopada

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Reply = Response | 'hang' | 'network';

interface Mock {
  quota?: { status: number; body: unknown };
  whitelist?: Reply;
  login?: Reply;
  search?: Reply;
}

interface Call {
  url: string;
  init: RequestInit;
  body: string;
}

const soap = (action: string, result: string) =>
  new Response(
    `--uuid\r\nContent-Type: application/xop+xml\r\n\r\n<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">` +
      `<s:Body><${action}Response xmlns="http://CIS/BIR/PUBL/2014/07"><${action}Result>${result}</${action}Result>` +
      `</${action}Response></s:Body></s:Envelope>\r\n--uuid--`,
  );

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const birData = (rows: string[]) => soap('DaneSzukajPodmioty', escapeXml(`<root>${rows.map((r) => `<dane>${r}</dane>`).join('')}</root>`));

const whitelistSubject = (subject: unknown) => new Response(JSON.stringify({ result: { subject, requestId: 'x' } }));

/** Zamockowany fetch: limit (`rpc/company_lookup_take_quota`), Biała lista, GUS BIR (Zaloguj / DaneSzukajPodmioty / Wyloguj). */
function mockFetch({
  quota = { status: 200, body: true },
  whitelist = whitelistSubject({ name: 'FIRMA SP. Z O.O.', workingAddress: 'UL. PROSTA 1, 00-001 WARSZAWA', statusVat: 'Czynny' }),
  login = soap('Zaloguj', 'SESSION123'),
  search = birData([]),
}: Mock = {}) {
  const calls: Call[] = [];
  const reply = (r: Reply, init: RequestInit): Promise<Response> => {
    if (r === 'network') return Promise.reject(new TypeError(`error sending request for url (${calls.at(-1)!.url})`));
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    return Promise.resolve(r.clone());
  };
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, init, body });
    if (url.endsWith('/rest/v1/rpc/company_lookup_take_quota')) {
      return Promise.resolve(new Response(JSON.stringify(quota.body), { status: quota.status }));
    }
    if (url.startsWith('https://wl-api.mf.gov.pl/')) return reply(whitelist, init);
    if (url.startsWith('https://wyszukiwarkaregon.stat.gov.pl/')) {
      if (body.includes('IUslugaBIRzewnPubl/Zaloguj')) return reply(login, init);
      if (body.includes('IUslugaBIRzewnPubl/DaneSzukajPodmioty')) return reply(search, init);
      if (body.includes('IUslugaBIRzewnPubl/Wyloguj')) return Promise.resolve(soap('Wyloguj', 'true'));
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const post = (body: unknown, authorization: string | null = 'Bearer user-jwt') =>
  new Request('http://localhost/company-lookup', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify(body),
  });

function run(mock: Mock, body: unknown = { nip: NIP }, config: Config = CONFIG, authorization?: string | null) {
  const { calls, fetch } = mockFetch(mock);
  const logs: string[] = [];
  const response = handle(post(body, authorization), {
    fetch,
    config,
    now: NOW,
    timeoutMs: 20,
    log: (m) => logs.push(m),
  });
  return { calls, logs, response };
}

const registryCalls = (calls: Call[]) =>
  calls.filter((c) => c.url.startsWith('https://wl-api.mf.gov.pl/') || c.url.startsWith('https://wyszukiwarkaregon'));

// ===== AC-2, §7: walidacja NIP =====

Deno.test('AC-2: suma kontrolna NIP i normalizacja (myślniki, spacje, prefiks PL)', () => {
  assert(isValidNip('5260250274'), 'poprawny NIP');
  assert(!isValidNip('5260250275'), 'zła cyfra kontrolna');
  assert(!isValidNip('123456789'), '9 cyfr');
  assert(!isValidNip('1234567890'), 'reszta 10 — nieprawidłowy');
  assert(normalizeNip('PL 526-025-02-74') === NIP, normalizeNip('PL 526-025-02-74'));
  assert(normalizeNip('pl526 025 02 74') === NIP, 'małe pl');
});

Deno.test('AC-2: błędna suma kontrolna — 400 invalid_nip, rejestr i limit nie są odpytywane', async () => {
  for (const nip of ['526-025-02-75', '123', 'abcdefghij', '']) {
    const { calls, response } = run({}, { nip });
    const res = await response;
    assert(res.status === 400, `status ${res.status} dla ${nip}`);
    assert((await res.json()).error === 'invalid_nip', 'kod błędu');
    assert(calls.length === 0, `brak wywołań dla ${nip}`);
  }
  const { calls, response } = run({}, { nip: 5260250274 });
  assert((await response).status === 400 && calls.length === 0, 'NIP nie jako tekst');
});

Deno.test('§7: NIP z prefiksem PL i myślnikami — normalizacja do 10 cyfr przed zapytaniem', async () => {
  const { calls, response } = run({}, { nip: 'PL 526-025-02-74' });
  assert((await response).status === 200, 'status');
  assert(
    registryCalls(calls)[0].url === `https://wl-api.mf.gov.pl/api/search/nip/${NIP}?date=2026-11-19`,
    registryCalls(calls)[0].url,
  );
});

Deno.test('§7: NIP zagraniczny (prefiks inny niż PL) — 400 foreign_nip, bez zapytań', async () => {
  for (const nip of ['DE123456789', 'cz 1234-5678']) {
    const { calls, response } = run({}, { nip });
    const res = await response;
    assert(res.status === 400 && (await res.json()).error === 'foreign_nip', `foreign_nip dla ${nip}`);
    assert(calls.length === 0, 'brak wywołań');
  }
});

// ===== §8: zalogowanie i limit 20/h =====

Deno.test('§8: bez zalogowania — 401, bez zapytań', async () => {
  const { calls, response } = run({}, { nip: NIP }, CONFIG, null);
  assert((await response).status === 401, 'status');
  assert(calls.length === 0, 'brak wywołań');
});

Deno.test('§8: limit sprawdzany z JWT wywołującego przed rejestrem', async () => {
  const { calls, response } = run({});
  assert((await response).status === 200, 'status');
  assert(calls[0].url === 'https://project.supabase.co/rest/v1/rpc/company_lookup_take_quota', calls[0].url);
  const headers = new Headers(calls[0].init.headers);
  assert(headers.get('Authorization') === 'Bearer user-jwt', 'JWT wywołującego');
  assert(headers.get('apikey') === 'sb_publishable_test', 'klucz publishable');
});

Deno.test('§8: limit 20 zapytań na godzinę wyczerpany — 429 rate_limited, rejestr nie jest odpytywany', async () => {
  const { calls, response } = run({ quota: { status: 200, body: false } });
  const res = await response;
  assert(res.status === 429 && (await res.json()).error === 'rate_limited', 'rate_limited');
  assert(registryCalls(calls).length === 0, 'brak zapytań do rejestru');
});

Deno.test('§8: JWT bez konta (anon) — 401', async () => {
  const { response } = run({ quota: { status: 403, body: { code: '28000', message: 'not_authenticated' } } });
  assert((await response).status === 401, 'status');
});

Deno.test('§8: błąd bazy przy limicie — 500, rejestr nie jest odpytywany', async () => {
  const { calls, response } = run({ quota: { status: 503, body: {} } });
  assert((await response).status === 500, 'status');
  assert(registryCalls(calls).length === 0, 'brak zapytań do rejestru');
});

// ===== AC-3: Biała lista, potem REGON =====

Deno.test('AC-3: firma na Białej liście — nazwa, adres, źródło vat_whitelist; do rejestru tylko NIP', async () => {
  const { calls, response } = run({}, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  const res = await response;
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(
    JSON.stringify(body) ===
      JSON.stringify({ found: true, name: 'FIRMA SP. Z O.O.', address: 'UL. PROSTA 1, 00-001 WARSZAWA', source: 'vat_whitelist' }),
    JSON.stringify(body),
  );
  const registry = registryCalls(calls);
  assert(registry.length === 1, 'REGON nie jest odpytywany, gdy firma jest na Białej liście');
  assert(!new Headers(registry[0].init.headers).has('Authorization'), 'JWT nie trafia do rejestru');
});

Deno.test('AC-3: adres siedziby z residenceAddress, gdy brak workingAddress', async () => {
  const { response } = run({
    whitelist: whitelistSubject({ name: 'JAN KOWALSKI USŁUGI', workingAddress: null, residenceAddress: 'KRÓTKA 2, 30-001 KRAKÓW' }),
  });
  const body = await (await response).json();
  assert(body.address === 'KRÓTKA 2, 30-001 KRAKÓW', body.address);
});

Deno.test('§7: Biała lista zwraca kilka podmiotów — pierwszy „Czynny”, inaczej pierwszy', async () => {
  const subjects = [
    { name: 'ZWOLNIONA', workingAddress: 'A 1, 00-001 X', statusVat: 'Zwolniony' },
    { name: 'CZYNNA', workingAddress: 'B 2, 00-002 Y', statusVat: 'Czynny' },
  ];
  let { response } = run({ whitelist: new Response(JSON.stringify({ result: { subjects } })) });
  assert((await (await response).json()).name === 'CZYNNA', 'czynny');
  ({ response } = run({ whitelist: new Response(JSON.stringify({ result: { subjects: [subjects[0]] } })) }));
  assert((await (await response).json()).name === 'ZWOLNIONA', 'pierwszy');
});

Deno.test('AC-3, §7: brak na Białej liście (np. wykreślona z VAT), jest w REGON — źródło regon', async () => {
  const search = birData([
    '<Regon>000000000</Regon><Nazwa>STARA NAZWA</Nazwa><DataZakonczeniaDzialalnosci>2020-01-01</DataZakonczeniaDzialalnosci>' +
      '<Ulica>ul. Stara</Ulica><NrNieruchomosci>9</NrNieruchomosci><KodPocztowy>00001</KodPocztowy><Miejscowosc>Warszawa</Miejscowosc>',
    '<Regon>012345678</Regon><Nazwa>FIRMA &amp; SYN S.C.</Nazwa><Ulica>ul. Test-Krucza</Ulica>' +
      '<NrNieruchomosci>12</NrNieruchomosci><NrLokalu>3a</NrLokalu><KodPocztowy>02134</KodPocztowy>' +
      '<Miejscowosc>Wólka</Miejscowosc><MiejscowoscPoczty>Warszawa</MiejscowoscPoczty><DataZakonczeniaDzialalnosci />',
  ]);
  const { calls, response } = run({ whitelist: whitelistSubject(null), search }, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  const body = await (await response).json();
  assert(
    JSON.stringify(body) ===
      JSON.stringify({ found: true, name: 'FIRMA & SYN S.C.', address: 'ul. Test-Krucza 12/3a, 02-134 Warszawa', source: 'regon' }),
    JSON.stringify(body),
  );
  const bir = calls.filter((c) => c.url.startsWith('https://wyszukiwarkaregon'));
  assert(bir.length === 3, `Zaloguj, DaneSzukajPodmioty, Wyloguj: ${bir.length}`);
  assert(bir[0].body.includes(`<ns:pKluczUzytkownika>${BIR_KEY}</ns:pKluczUzytkownika>`), 'klucz w logowaniu');
  assert(new Headers(bir[1].init.headers).get('sid') === 'SESSION123', 'sesja w nagłówku sid');
  assert(bir[1].body.includes(`<dat:Nip>${NIP}</dat:Nip>`), 'wyszukiwanie po NIP');
  assert(!bir[1].body.includes(BIR_KEY), 'klucz tylko przy logowaniu');
});

Deno.test('AC-3: adres REGON bez ulicy (miejscowość z numerem)', async () => {
  const search = birData([
    '<Nazwa>GOSPODARSTWO</Nazwa><NrNieruchomosci>15</NrNieruchomosci><KodPocztowy>34-100</KodPocztowy><Miejscowosc>Wola</Miejscowosc>',
  ]);
  const { response } = run({ whitelist: whitelistSubject(null), search }, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  assert((await (await response).json()).address === 'Wola 15, 34-100 Wola', 'adres');
});

Deno.test('AC-3: Biała lista nie odpowiada — dane z REGON', async () => {
  const search = birData(['<Nazwa>FIRMA</Nazwa><Ulica>ul. Długa</Ulica><NrNieruchomosci>1</NrNieruchomosci><KodPocztowy>00001</KodPocztowy><Miejscowosc>Gdańsk</Miejscowosc>']);
  const { response } = run({ whitelist: 'hang', search }, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  const body = await (await response).json();
  assert(body.found === true && body.source === 'regon', JSON.stringify(body));
});

// ===== AC-4: brak w rejestrach / brak odpowiedzi =====

const NOT_FOUND = JSON.stringify({ found: false, name: null, address: null, source: null });

Deno.test('AC-4: brak firmy na Białej liście i bez klucza GUS — found: false, REGON pominięty', async () => {
  const { calls, response } = run({ whitelist: whitelistSubject(null) });
  assert(JSON.stringify(await (await response).json()) === NOT_FOUND, 'found: false');
  assert(!calls.some((c) => c.url.startsWith('https://wyszukiwarkaregon')), 'bez klucza GUS krok pominięty');
});

Deno.test('AC-4: brak firmy w obu rejestrach (ErrorCode 4 z BIR) — found: false', async () => {
  const search = birData(['<ErrorCode>4</ErrorCode><ErrorMessagePl>Nie znaleziono podmiotu</ErrorMessagePl>']);
  const { response } = run({ whitelist: whitelistSubject(null), search }, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  assert(JSON.stringify(await (await response).json()) === NOT_FOUND, 'found: false');
});

Deno.test('AC-4: rejestr nie odpowiada w limicie czasu — found: false, w logu bez NIP-u', async () => {
  const { logs, response } = run({ whitelist: 'hang', login: 'hang' }, { nip: NIP }, { ...CONFIG, gusBirKey: BIR_KEY });
  const res = await response;
  assert(res.status === 200 && JSON.stringify(await res.json()) === NOT_FOUND, 'found: false');
  assert(logs.length === 2 && logs.every((l) => l.includes('limit 5 s')), logs.join(' | '));
  assert(logs.every((l) => !l.includes(NIP)), 'NIP nie trafia do logów');
});

Deno.test('AC-4, §7: przekroczony limit Białej listy (błąd HTTP) i błąd sieci — found: false, w logu bez NIP-u ani klucza', async () => {
  const { logs, response } = run(
    { whitelist: new Response('{"code":"WL-191"}', { status: 429 }), login: 'network' },
    { nip: NIP },
    { ...CONFIG, gusBirKey: BIR_KEY },
  );
  const res = await response;
  assert(res.status === 200 && JSON.stringify(await res.json()) === NOT_FOUND, 'found: false');
  assert(logs.some((l) => l.includes('429')), logs.join(' | '));
  assert(logs.every((l) => !l.includes(NIP) && !l.includes(BIR_KEY)), logs.join(' | '));
});

Deno.test('AC-4: nieudane logowanie do BIR (zły klucz) — found: false', async () => {
  const { response } = run({ whitelist: whitelistSubject(null), login: soap('Zaloguj', '') }, { nip: NIP }, {
    ...CONFIG,
    gusBirKey: BIR_KEY,
  });
  assert(JSON.stringify(await (await response).json()) === NOT_FOUND, 'found: false');
});

// ===== Inne =====

Deno.test('company-lookup: OPTIONS (CORS), inna metoda — 405, brak konfiguracji — 500', async () => {
  const { fetch } = mockFetch();
  const deps = { fetch, config: CONFIG, log: () => {} };
  const options = await handle(new Request('http://localhost/', { method: 'OPTIONS' }), deps);
  assert(options.status === 204 && options.headers.get('Access-Control-Allow-Origin') === '*', 'CORS');
  assert((await handle(new Request('http://localhost/'), deps)).status === 405, '405');
  const res = await handle(post({ nip: NIP }), { ...deps, config: {} });
  assert(res.status === 500, '500');
});
