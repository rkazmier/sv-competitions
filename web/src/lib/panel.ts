/**
 * Bramka panelu (SPEC-001 AC-4, AC-5; SPEC-002 AC-26, AC-27; ADR-0004). Działa w przeglądarce.
 *
 * Stany (elementy `[data-panel-state]` w PanelLayout):
 * - `signedOut` — przycisk „Zaloguj się przez Google”, powrót do `/panel/` (AC-4),
 * - `forbidden` — rola `user`: „Nie masz uprawnień do panelu.”, link do konta, bez pobierania danych (AC-27),
 * - `staff` — obsługa strzelnicy: menu obsługi, bez kalendarza i słowników (AC-26),
 * - `admin` — treść strony i pełne menu panelu,
 * - `error` — błąd sieci przy sprawdzaniu roli.
 *
 * Rola z `profiles` (to samo źródło co RLS — `is_staff()` / `is_admin()`), nie z claimu JWT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type PanelState = 'loading' | 'signedOut' | 'forbidden' | 'staff' | 'admin' | 'error';

/** Rola konta → stan panelu (hierarchia admin ⊃ staff ⊃ user). */
export function stateForRole(role: unknown): PanelState {
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff';
  return 'forbidden';
}

/** Strona startowa panelu — tu wraca logowanie Google. */
export const PANEL_HOME = '/panel/';

export async function resolvePanelState(supabase: SupabaseClient): Promise<PanelState> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return 'error';
  const session = sessionData.session;
  if (!session) return 'signedOut';
  const { data, error } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  if (error) return 'error';
  return stateForRole(data?.role);
}

function show(state: PanelState): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-panel-state]')) {
    element.hidden = element.dataset.panelState !== state;
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
      window.location.assign(PANEL_HOME);
    });
  }
}

let ready: Promise<SupabaseClient> | undefined;

/**
 * Uruchamia bramkę (raz na stronę) i zwraca klienta tylko adminowi (strony kalendarza i słowników).
 * Dla pozostałych stanów obietnica się nie spełnia — strona nie pobiera danych.
 */
export function requireAdmin(): Promise<SupabaseClient> {
  ready ??= (async () => {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabase();
    } catch {
      show('error');
      return new Promise<never>(() => {});
    }
    bindButtons(supabase);
    const state = await resolvePanelState(supabase).catch((): PanelState => 'error');
    show(state);
    if (state !== 'admin') return new Promise<never>(() => {});
    return supabase;
  })();
  return ready;
}

/** Pokazuje stan błędu wczytywania (np. gdy zapytanie strony się nie powiodło). */
export function showLoadError(): void {
  show('error');
}
