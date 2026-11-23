import { handle } from './handler.ts';

/** Klucz secret: `SUPABASE_SECRET_KEY` albo domyślny klucz z `SUPABASE_SECRET_KEYS` (JSON ustawiany przez Supabase). */
function secretKey(): string | undefined {
  const single = Deno.env.get('SUPABASE_SECRET_KEY');
  if (single) return single;
  try {
    return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
  } catch {
    return undefined;
  }
}

// Klucz certyfikatu Tpay pobierany raz na instancję funkcji.
const keyCache = new Map<string, Promise<CryptoKey>>();

// Wywołanie `mail-send` kończy się po odpowiedzi dla Tpay (SPEC-012 AC-9).
const runtime = (globalThis as { EdgeRuntime?: { waitUntil(work: Promise<unknown>): void } }).EdgeRuntime;

// SUPABASE_URL i klucze secret ustawia Supabase; TPAY_API_URL — właściciel (sandbox / produkcja, SPEC-003 §8);
// MAIL_INVOKE_SECRET — właściciel (#166, ADR-0009).
Deno.serve((request) =>
  handle(request, {
    fetch,
    keyCache,
    background: runtime ? (work) => runtime.waitUntil(work) : undefined,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      secretKey: secretKey(),
      tpayApiUrl: Deno.env.get('TPAY_API_URL'),
      mailInvokeSecret: Deno.env.get('MAIL_INVOKE_SECRET'),
    },
  }),
);
