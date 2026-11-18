import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { contentState, resolvePanelState, stateForRole } from './panel';

/** Minimalny klient: sesja i odpowiedź `profiles.select('role')`. */
function client(options: { session?: boolean; role?: string | null; error?: boolean }): SupabaseClient {
  const result = { data: options.role === undefined ? null : { role: options.role }, error: options.error ? new Error('x') : null };
  const query = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve(result) };
  return {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: options.session === false ? null : { user: { id: 'u1' } } }, error: null }),
    },
    from: () => query,
  } as unknown as SupabaseClient;
}

describe('bramka panelu (SPEC-002 US-7, ADR-0004)', () => {
  it('admin → pełny panel', () => {
    expect(stateForRole('admin')).toBe('admin');
  });

  it('AC-26: obsługa → menu obsługi, bez kalendarza', () => {
    expect(stateForRole('staff')).toBe('staff');
  });

  it('AC-27: użytkownik i nieznana rola → brak uprawnień', () => {
    expect(stateForRole('user')).toBe('forbidden');
    expect(stateForRole('organizer')).toBe('forbidden');
    expect(stateForRole(undefined)).toBe('forbidden');
  });

  it('rola z profiles, nie z JWT; brak sesji i błąd sieci', async () => {
    expect(await resolvePanelState(client({ role: 'admin' }))).toBe('admin');
    expect(await resolvePanelState(client({ role: 'staff' }))).toBe('staff');
    expect(await resolvePanelState(client({ role: 'user' }))).toBe('forbidden');
    expect(await resolvePanelState(client({}))).toBe('forbidden');
    expect(await resolvePanelState(client({ session: false }))).toBe('signedOut');
    expect(await resolvePanelState(client({ role: 'admin', error: true }))).toBe('error');
  });

  it('SPEC-003 AC-21: strona obsługi (Sprzedaż) — treść dla obsługi i admina, nie dla użytkownika', () => {
    expect(contentState('staff', 'staff')).toBe('admin');
    expect(contentState('admin', 'staff')).toBe('admin');
    expect(contentState('forbidden', 'staff')).toBe('forbidden');
    expect(contentState('staff', 'admin')).toBe('staff');
  });
});
