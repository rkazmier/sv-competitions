/**
 * Bramka panelu (SPEC-001 AC-4, AC-5; SPEC-002 AC-26, AC-27; ADR-0004). Działa w przeglądarce.
 *
 * Stany (elementy `[data-panel-state]` w PanelLayout):
 * - `signedOut` — przycisk „Zaloguj się przez Google”, powrót do `/panel/` (AC-4),
 * - `forbidden` — rola `user`: „Nie masz uprawnień do panelu.”, link do konta, bez pobierania danych (AC-27),
 * - `staff` — obsługa strzelnicy: menu obsługi, bez kalendarza i słowników (AC-26); treść tylko stron
 *   dostępnych dla obsługi (`PanelLayout access="staff"`, np. książka — SPEC-005),
 * - `admin` — treść strony i pełne menu panelu,
 * - `duty` — rola `user`, która jest teraz dyżurnym Prowadzącym (`rpc/is_range_duty_officer`, SPEC-008 AC-2…AC-4):
 *   menu tylko „Książka”, treść tylko stron `PanelLayout access="duty"` (`/panel/ksiazka/`); `/panel/` przekierowuje
 *   do książki, pozostałe strony — `forbidden`. Uprawnienia i tak sprawdza baza przy każdym wywołaniu.
 * - `error` — błąd sieci przy sprawdzaniu roli.
 *
 * Rola z `profiles` (to samo źródło co RLS — `is_staff()` / `is_admin()`), nie z claimu JWT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { forgetDuty, rememberDuty } from './duty-link-ui';
import { getSupabase } from './supabase';

export type PanelState = 'loading' | 'signedOut' | 'forbidden' | 'staff' | 'admin' | 'duty' | 'error';

/** Rola konta → stan panelu (hierarchia admin ⊃ staff ⊃ user). */
export function stateForRole(role: unknown): PanelState {
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff';
  return 'forbidden';
}

/** Strona startowa panelu — tu wraca logowanie Google. */
export const PANEL_HOME = '/panel/';
/** Jedyna strona panelu dyżurnego Prowadzącego z konta (SPEC-008 §6). */
export const DUTY_HOME = '/panel/ksiazka/';

/**
 * Stan pokazywany na danej stronie (SPEC-008 AC-2, AC-4): dyżurny widzi tylko strony dostępne dla dyżurnego;
 * na pozostałych — „Nie masz uprawnień do panelu.”. `redirect` — `/panel/` prowadzi dyżurnego do książki.
 */
export function pageState(state: PanelState, dutyAllowed: boolean, pathname: string): { state: PanelState; redirect?: string } {
  if (state !== 'duty' || dutyAllowed) return { state };
  if (pathname === PANEL_HOME) return { state: 'loading', redirect: DUTY_HOME };
  return { state: 'forbidden' };
}

export async function resolvePanelState(supabase: SupabaseClient): Promise<PanelState> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return 'error';
  const session = sessionData.session;
  if (!session) return 'signedOut';
  const { data, error } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  if (error) return 'error';
  const state = stateForRole(data?.role);
  if (state !== 'forbidden' || data?.role !== 'user') return state;
  // SPEC-008 §6: użytkownik, który teraz jest dyżurnym Prowadzącym (sprawdza baza).
  const duty = await supabase.rpc('is_range_duty_officer');
  if (duty.error) return 'error';
  // SPEC-009 AC-9, AC-11: wynik dla linku „Książka” w nagłówku stron publicznych (np. `false` po utracie dyżuru).
  rememberDuty(session.user.id, duty.data === true);
  return duty.data === true ? 'duty' : 'forbidden';
}

function show(state: PanelState): void {
  // `data-panel-state` może zawierać kilka stanów, np. „admin staff” — strona dostępna dla obsługi (SPEC-005).
  for (const element of document.querySelectorAll<HTMLElement>('[data-panel-state]')) {
    element.hidden = !(element.dataset.panelState ?? '').split(' ').includes(state);
  }
  for (const menu of document.querySelectorAll<HTMLElement>('[data-panel-menu]')) {
    menu.hidden = menu.dataset.panelMenu !== state;
  }
}

function bindButtons(supabase: SupabaseClient): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sign-in]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: new URL(PANEL_HOME, window.location.origin).href },
      });
      if (error) {
        button.disabled = false;
        show('error');
      }
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sign-out]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await supabase.auth.signOut();
      forgetDuty(); // SPEC-009 AC-10
      window.location.assign(PANEL_HOME);
    });
  }
}

let ready: Promise<{ supabase: SupabaseClient; state: PanelState }> | undefined;

/** Uruchamia bramkę (raz na stronę): ustala stan, pokazuje odpowiednią część układu. */
function startPanel(): Promise<{ supabase: SupabaseClient; state: PanelState }> {
  ready ??= (async () => {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabase();
    } catch {
      show('error');
      return new Promise<never>(() => {});
    }
    bindButtons(supabase);
    const resolved = await resolvePanelState(supabase).catch((): PanelState => 'error');
    const dutyAllowed = Boolean(document.querySelector('[data-panel-state~="duty"]'));
    const { state, redirect } = pageState(resolved, dutyAllowed, window.location.pathname);
    if (redirect) {
      window.location.replace(redirect);
      return new Promise<never>(() => {});
    }
    show(state);
    return { supabase, state };
  })();
  return ready;
}

/**
 * Zwraca klienta tylko adminowi (strony kalendarza, słowników, prowadzących).
 * Dla pozostałych stanów obietnica się nie spełnia — strona nie pobiera danych.
 */
export async function requireAdmin(): Promise<SupabaseClient> {
  const { supabase, state } = await startPanel();
  if (state !== 'admin') return new Promise<never>(() => {});
  return supabase;
}

/** Jak `requireAdmin`, ale wpuszcza też obsługę strzelnicy (książka — SPEC-005). Zwraca rolę. */
export async function requireStaff(): Promise<{ supabase: SupabaseClient; role: 'staff' | 'admin' }> {
  const { supabase, state } = await startPanel();
  if (state !== 'admin' && state !== 'staff') return new Promise<never>(() => {});
  return { supabase, role: state };
}

/**
 * Książka rejestru pobytu: obsługa, admin i dyżurny Prowadzący z konta (SPEC-005, SPEC-008). Zwraca rolę —
 * `duty` ukrywa zmianę dyżurnego i sprzedaż na miejscu.
 */
export async function requireRangeLog(): Promise<{ supabase: SupabaseClient; role: 'staff' | 'admin' | 'duty' }> {
  const { supabase, state } = await startPanel();
  if (state !== 'admin' && state !== 'staff' && state !== 'duty') return new Promise<never>(() => {});
  return { supabase, role: state };
}

/** Pokazuje stan błędu wczytywania (np. gdy zapytanie strony się nie powiodło). */
export function showLoadError(): void {
  show('error');
}
