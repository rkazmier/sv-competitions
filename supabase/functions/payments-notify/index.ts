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

// SUPABASE_URL i klucze secret ustawia Supabase; TPAY_API_URL — właściciel (sandbox / produkcja, SPEC-003 §8).
Deno.serve((request) =>
  handle(request, {
    fetch,
    keyCache,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      secretKey: secretKey(),
      tpayApiUrl: Deno.env.get('TPAY_API_URL'),
    },
  }),
);
