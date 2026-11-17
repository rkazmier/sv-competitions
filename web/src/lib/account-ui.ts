/**
 * Panel użytkownika (SPEC-002 US-2, US-3): `/konto/` — braki lub gotowość do wpisu, kod QR (pełny ekran, druk,
 * nowy kod), podgląd danych; `/konto/dane/` — formularz danych (AC-7…AC-11).
 * Logika bez DOM: lib/profile.ts, lib/qr.ts. Sesja i klauzula przy pierwszym logowaniu: lib/auth-ui.ts.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { t, type MessageKey } from '../i18n';
import { ACCOUNT_HOME, LOGIN_PAGE, withNext } from './auth';
import {
  LIMITS,
  PROFILE_FIELDS,
  missingForRangeEntry,
  normalizeProfile,
  validateProfile,
  type AccountProfile,
  type ProfileData,
  type ProfileErrors,
} from './profile';
import { renderPassesAndPayments } from './offer-ui';
import { qrSvg } from './qr';
import { getSupabase } from './supabase';

/** Kolumny profilu potrzebne w `/konto/` i `/konto/dane/`. */
export const ACCOUNT_COLUMNS = `${PROFILE_FIELDS.join(', ')}, is_range_ready, qr_token, privacy_notice_ack_at`;
export const PROFILE_FORM_PAGE = '/konto/dane/';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

const MISSING_TEXT = { fullName: 'account.missingFullName', permitOrAddress: 'account.missingPermitOrAddress' } as const;

function renderQr(token: string): void {
  const svg = qrSvg(token, t('account.qrLabel'));
  for (const box of document.querySelectorAll<HTMLElement>('[data-qr]')) box.innerHTML = svg;
}

/** Braki (AC-9) albo status „Gotowy do wpisu do książki” z kolumny `is_range_ready` (AC-10). */
function renderReadiness(profile: AccountProfile): void {
  el(document, '[data-ready]').hidden = !profile.is_range_ready;
  const block = el(document, '[data-missing]');
  block.hidden = profile.is_range_ready;
  el(block, 'ul').replaceChildren(
    ...missingForRangeEntry(profile).map((item) => {
      const li = document.createElement('li');
      li.textContent = t(MISSING_TEXT[item]);
      return li;
    }),
  );
}

/** Pełny ekran (AC-13): okno modalne z wpisem w historii — „Zamknij”, Esc i gest wstecz zamykają. */
function bindFullscreen(): void {
  const dialog = el<HTMLDialogElement>(document, 'dialog[data-qr-dialog]');
  // Przeładowanie przy otwartym pełnym ekranie zostawia jego wpis w historii — cofamy go, żeby wstecz opuszczało stronę.
  if ((window.history.state as { qrFullscreen?: boolean } | null)?.qrFullscreen) window.history.back();
  el(document, '[data-qr-fullscreen]').addEventListener('click', () => {
    dialog.showModal();
    window.history.pushState({ qrFullscreen: true }, '');
  });
  const close = () => window.history.back();
  el(dialog, '[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  window.addEventListener('popstate', () => {
    if (dialog.open) dialog.close();
  });
}

/** `/konto/` po zalogowaniu i potwierdzeniu klauzuli. */
export function renderAccount(supabase: SupabaseClient, user: User, profile: AccountProfile): void {
  renderReadiness(profile);
  renderQr(profile.qr_token);
  for (const node of document.querySelectorAll<HTMLElement>('[data-field]')) {
    const name = node.dataset.field!;
    const value = name === 'email' ? (user.email ?? null) : profile[name as keyof AccountProfile];
    node.textContent = typeof value === 'string' ? value : t('account.notProvided');
  }
  el(document, '[data-print-name]').textContent = profile.full_name ?? '';
  bindFullscreen();
  el(document, '[data-qr-print]').addEventListener('click', () => window.print());
  // SPEC-003 AC-12…AC-15: karnety, historia karnetów i płatności (pobierane osobno, nie blokują kodu QR).
  void renderPassesAndPayments(supabase, user.id);

  // AC-15: nowy kod po potwierdzeniu; stary przestaje działać od razu (rotate_qr_token w bazie).
  const rotate = el<HTMLButtonElement>(document, '[data-qr-rotate]');
  const status = el(document, '[data-qr-status]');
  rotate.addEventListener('click', async () => {
    if (!window.confirm(t('account.qrRotateConfirm'))) return;
    rotate.disabled = true;
    const { data, error } = await supabase.rpc('rotate_qr_token');
    rotate.disabled = false;
    if (error || typeof data !== 'string') {
      status.className = 'message-error';
      status.textContent = t('auth.genericError');
      return;
    }
    renderQr(data);
    status.className = '';
    status.textContent = t('account.qrRotated');
  });
}

// ===== /konto/dane/ =====

const ERROR_TEXT: Record<NonNullable<ProfileErrors[keyof ProfileErrors]>, MessageKey> = {
  length: 'profile.errorLength',
  phone: 'profile.errorPhone',
  permitPair: 'profile.errorPermitPair',
};

/** Wypełnia pola `ProfileFields.astro` danymi profilu i e-mailem (tylko do odczytu). */
export function fillProfileForm(form: HTMLFormElement, profile: ProfileData, email: string | null): void {
  for (const name of PROFILE_FIELDS) {
    (form.elements.namedItem(name) as HTMLInputElement).value = profile[name] ?? '';
  }
  (form.elements.namedItem('email') as HTMLInputElement).value = email ?? '';
}

/** Pola formularza → dane do zapisu; `null`, gdy walidacja nie przeszła (komunikaty przy polach, AC-8, AC-11). */
export function readProfileForm(form: HTMLFormElement): ProfileData | null {
  const values = normalizeProfile(
    Object.fromEntries(PROFILE_FIELDS.map((name) => [name, (form.elements.namedItem(name) as HTMLInputElement).value])),
  );
  return showProfileErrors(form, validateProfile(values)) ? null : values;
}

function showProfileErrors(form: HTMLFormElement, errors: ProfileErrors): boolean {
  for (const name of PROFILE_FIELDS) {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    const message = el(form, `[data-error-for="${name}"]`);
    const code = errors[name];
    const limits = name === 'phone' ? undefined : LIMITS[name];
    message.hidden = !code;
    message.textContent = code ? t(ERROR_TEXT[code], { min: limits?.min ?? 0, max: limits?.max ?? 0 }) : '';
    input.setAttribute('aria-invalid', String(Boolean(code)));
  }
  const first = PROFILE_FIELDS.find((name) => errors[name]);
  if (first) (form.elements.namedItem(first) as HTMLInputElement).focus();
  return Boolean(first);
}

/** `/konto/dane/` — AC-7, AC-8, AC-11. Zapis tylko własnego wiersza (RLS); bez wpisu w `audit_log` (AC-22). */
export async function mountProfileForm(): Promise<void> {
  const loading = el(document, '[data-loading]');
  const loadError = el(document, '[data-load-error]');
  let supabase: SupabaseClient;
  try {
    supabase = getSupabase();
  } catch {
    loading.hidden = true;
    loadError.hidden = false;
    return;
  }
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return window.location.replace(withNext(LOGIN_PAGE, PROFILE_FORM_PAGE));

  const { data: profile, error } = await supabase.from('profiles').select(ACCOUNT_COLUMNS).eq('id', user.id).maybeSingle<AccountProfile>();
  loading.hidden = true;
  if (error || !profile) {
    loadError.hidden = false;
    return;
  }
  // Klauzula przy pierwszym logowaniu (AC-3) jest na /konto/.
  if (!profile.privacy_notice_ack_at) return window.location.replace(withNext(ACCOUNT_HOME, PROFILE_FORM_PAGE));

  const form = el<HTMLFormElement>(document, 'form[data-profile]');
  fillProfileForm(form, profile, user.email ?? null);
  form.hidden = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formError = el(form, '[data-form-error]');
    formError.hidden = true;
    const values = readProfileForm(form);
    if (!values) return;
    const submit = el<HTMLButtonElement>(form, '[data-submit]');
    submit.disabled = true;
    const { error: saveError } = await supabase.from('profiles').update(values).eq('id', user.id);
    submit.disabled = false;
    if (saveError) {
      formError.textContent = t('profile.saveError');
      formError.hidden = false;
      return;
    }
    window.location.assign(ACCOUNT_HOME);
  });
}
