import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUTY_LINK_KEY, parseDutyMemory } from './duty-link';
import { DUTY_HOME, PANEL_HOME, pageState, resolvePanelState, stateForRole } from './panel';

/** Minimalny klient: sesja i odpowiedź `profiles.select('role')`. */
function client(options: {
  session?: boolean;
  role?: string | null;
  error?: boolean;
  duty?: boolean | 'error';
}): SupabaseClient {
  const result = { data: options.role === undefined ? null : { role: options.role }, error: options.error ? new Error('x') : null };
  const query = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve(result) };
  return {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: options.session === false ? null : { user: { id: 'u1' } } }, error: null }),
    },
    from: () => query,
    rpc: (name: string) =>
      Promise.resolve(
        name === 'is_range_duty_officer' && options.duty !== 'error'
          ? { data: options.duty ?? false, error: null }
          : { data: null, error: new Error('x') },
      ),
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

});

describe('dyżurny Prowadzący z konta w panelu (SPEC-008)', () => {
  it('AC-2: rola user + is_range_duty_officer → stan duty', async () => {
    expect(await resolvePanelState(client({ role: 'user', duty: true }))).toBe('duty');
  });

  it('AC-3: user, który nie jest dziś dyżurnym → brak uprawnień; błąd sprawdzenia → błąd', async () => {
    expect(await resolvePanelState(client({ role: 'user', duty: false }))).toBe('forbidden');
    expect(await resolvePanelState(client({ role: 'user', duty: 'error' }))).toBe('error');
  });

  it('obsługa i admin będący dyżurnym korzystają z uprawnień swojej roli', async () => {
    expect(await resolvePanelState(client({ role: 'staff', duty: true }))).toBe('staff');
    expect(await resolvePanelState(client({ role: 'admin', duty: true }))).toBe('admin');
  });

  it('AC-2: książka (strona dla dyżurnego) → treść; /panel/ → przekierowanie do książki', () => {
    expect(pageState('duty', true, DUTY_HOME)).toEqual({ state: 'duty' });
    expect(pageState('duty', false, PANEL_HOME)).toEqual({ state: 'loading', redirect: DUTY_HOME });
  });

  it('AC-4: pozostałe strony panelu → „Nie masz uprawnień do panelu.”', () => {
    for (const path of ['/panel/dyzury/', '/panel/prowadzacy/', '/panel/sprzedaz/', '/panel/ksiazka/przeglad/']) {
      expect(pageState('duty', false, path)).toEqual({ state: 'forbidden' });
    }
  });

  it('inne stany bez zmian', () => {
    expect(pageState('staff', false, PANEL_HOME)).toEqual({ state: 'staff' });
    expect(pageState('forbidden', true, DUTY_HOME)).toEqual({ state: 'forbidden' });
  });
});

describe('bramka panelu zapisuje dyżur dla nagłówka (SPEC-009)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('AC-9, AC-11: wynik is_range_duty_officer trafia do pamięci; błąd i Obsługa — bez zapisu', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    vi.stubGlobal('window', { sessionStorage: storage, localStorage: storage });

    await resolvePanelState(client({ role: 'user', duty: true }));
    expect(parseDutyMemory(data.get(DUTY_LINK_KEY) ?? null)).toMatchObject({ sub: 'u1', duty: true });
    await resolvePanelState(client({ role: 'user', duty: false }));
    expect(parseDutyMemory(data.get(DUTY_LINK_KEY) ?? null)).toMatchObject({ sub: 'u1', duty: false });
    data.clear();
    await resolvePanelState(client({ role: 'user', duty: 'error' }));
    await resolvePanelState(client({ role: 'staff' }));
    expect(data.has(DUTY_LINK_KEY)).toBe(false);
  });
});
