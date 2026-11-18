import { handle } from './handler.ts';

// SUPABASE_URL i SUPABASE_ANON_KEY ustawia Supabase. GUS_BIR_KEY (opcjonalny) — sekret projektu;
// GUS_BIR_URL (opcjonalny) — np. środowisko testowe BIR, domyślnie produkcja.
Deno.serve((request) =>
  handle(request, {
    fetch,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      supabaseKey: Deno.env.get('SUPABASE_ANON_KEY'),
      gusBirKey: Deno.env.get('GUS_BIR_KEY') || undefined,
      gusBirUrl: Deno.env.get('GUS_BIR_URL') || undefined,
    },
  }),
);
