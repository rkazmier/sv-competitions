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

// SUPABASE_* ustawia Supabase; TPAY_* i MAIL_INVOKE_SECRET — właściciel (sekrety Supabase, SPEC-003 §8, ADR-0009).
Deno.serve((request) =>
  handle(request, {
    fetch,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      supabaseKey: Deno.env.get('SUPABASE_ANON_KEY'),
      secretKey: secretKey(),
      invokeSecret: Deno.env.get('MAIL_INVOKE_SECRET'),
      tpayApiUrl: Deno.env.get('TPAY_API_URL'),
      tpayClientId: Deno.env.get('TPAY_CLIENT_ID'),
      tpayClientSecret: Deno.env.get('TPAY_CLIENT_SECRET'),
    },
  })
);
