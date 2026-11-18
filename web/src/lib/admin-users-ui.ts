/**
 * Wyspy panelu admina — konta użytkowników (SPEC-002 US-4, US-5). Tylko admin (`requireAdmin`).
 * `/panel/uzytkownicy/` — lista z wyszukiwarką (AC-16); `/panel/uzytkownicy/profil/?id=` — dane (AC-20),
 * rola (AC-17, AC-18), „Historia zmian” (AC-21), „Usuń konto” (AC-23…AC-25, Edge Function `admin-delete-user`),
 * „Karnety i zużycie” z „Cofnij zużycie” (SPEC-005 AC-23, lib/range-revert-ui.ts).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 * Wpisy w `audit_log` tworzy baza (wyzwalacz `audit_profile_changes`, `set_user_role`), nie ten kod.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { ACCOUNT_COLUMNS, fillProfileForm, readProfileForm } from './account-ui';
import { entryUrlFor } from './range-entry';
import { mountPassUsages } from './range-revert-ui';
import {
  DELETE_USER_FUNCTION,
  HISTORY_LIMIT,
  actorName,
  canDeleteAccount,
  deleteResultKey,
  describeChanges,
  formatDateTime,
  formatDay,
  isDeleteConfirmed,
  pageCount,
  roleErrorKey,
  roleLabel,
  searchTerm,
  userCardHref,
  userIdFromSearch,
  type AuditEntry,
  type UserRow,
} from './admin-users';
import { requireAdmin, showLoadError } from './panel';
import type { AccountProfile } from './profile';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

// ===== /panel/uzytkownicy/ (AC-16) =====

export async function mountUserList(root: HTMLElement): Promise<void> {
  const supabase = await requireAdmin();
  const status = el(root, '[data-status]');
  const list = el(root, '[data-list]');
  const pager = el(root, '[data-pager]');
  const previous = el<HTMLButtonElement>(root, '[data-previous]');
  const next = el<HTMLButtonElement>(root, '[data-next]');
  const template = el<HTMLTemplateElement>(root, 'template[data-row]');
  let term: string | null = null;
  let page = 1;

  async function load(): Promise<void> {
    status.textContent = t('panel.loading');
    const { data, error } = await supabase.rpc('admin_list_users', { search: term, page });
    if (error) return showLoadError();
    const rows = (data ?? []) as UserRow[];
    const total = Number(rows[0]?.total_count ?? 0);
    const pages = pageCount(total);
    list.replaceChildren(
      ...rows.map((row) => {
        const item = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
        const link = el<HTMLAnchorElement>(item, '[data-name]');
        link.href = userCardHref(row.id);
        link.textContent = row.full_name ?? t('users.noName');
        el(item, '[data-email]').textContent = row.email ?? '';
        el(item, '[data-role]').textContent = roleLabel(row.role);
        el(item, '[data-ready]').textContent = row.is_range_ready ? t('users.yes') : t('users.no');
        el(item, '[data-created]').textContent = formatDay(row.created_at);
        return item;
      }),
    );
    status.textContent = rows.length
      ? `${t('users.count', { count: total })}. ${t('users.page', { page, pages })}`
      : t('users.empty');
    pager.hidden = pages < 2;
    previous.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  el<HTMLFormElement>(root, 'form[data-search]').addEventListener('submit', (event) => {
    event.preventDefault();
    term = searchTerm(el<HTMLInputElement>(root, '#u-search').value);
    page = 1;
    void load();
  });
  previous.addEventListener('click', () => {
    page -= 1;
    void load();
  });
  next.addEventListener('click', () => {
    page += 1;
    void load();
  });
  await load();
}

// ===== /panel/uzytkownicy/profil/?id= (AC-17, AC-18, AC-20, AC-21, AC-23…AC-25) =====

type CardProfile = AccountProfile & { role: string };

async function loadHistory(supabase: SupabaseClient, root: HTMLElement, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, changes, created_at, actor:profiles!audit_log_actor_id_fkey(full_name)')
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return showLoadError();
  const entries = (data ?? []) as unknown as AuditEntry[];
  el(root, '[data-history-empty]').hidden = entries.length > 0;
  el(root, '[data-history]').replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement('li');
      const head = document.createElement('p');
      const time = document.createElement('time');
      time.dateTime = entry.created_at;
      time.textContent = formatDateTime(entry.created_at);
      head.append(time, ` — ${actorName(entry)}`);
      const changes = document.createElement('ul');
      changes.replaceChildren(
        ...describeChanges(entry).map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }),
      );
      item.append(head, changes);
      return item;
    }),
  );
}

export async function mountUserCard(root: HTMLElement): Promise<void> {
  const supabase = await requireAdmin();
  const loading = el(root, '[data-loading]');
  const userId = userIdFromSearch(window.location.search);
  const notFound = () => {
    loading.hidden = true;
    el(root, '[data-not-found]').hidden = false;
  };
  if (!userId) return notFound();

  const [profileResult, emailResult] = await Promise.all([
    supabase.from('profiles').select(`${ACCOUNT_COLUMNS}, role`).eq('id', userId).maybeSingle<CardProfile>(),
    supabase.rpc('admin_user_email', { user_id: userId }),
  ]);
  if (profileResult.error || emailResult.error) return showLoadError();
  const profile = profileResult.data;
  if (!profile) return notFound();
  const email = (emailResult.data as string | null) ?? null;

  const title = el(root, '[data-title]');
  const ready = el(root, '[data-ready]');
  const showHeader = (data: CardProfile) => {
    title.textContent = data.full_name ?? email ?? t('users.noName');
    ready.hidden = !data.is_range_ready;
  };
  showHeader(profile);
  // SPEC-005 AC-8: ten sam przebieg wpisu co po skanie, od razu ta osoba.
  el<HTMLAnchorElement>(root, '[data-start-entry]').href = entryUrlFor(userId);

  // Dane (AC-20): te same pola i walidacja co /konto/dane/; wpis w audit_log robi wyzwalacz w bazie.
  const form = el<HTMLFormElement>(root, 'form[data-profile]');
  fillProfileForm(form, profile, email);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formError = el(form, '[data-form-error]');
    const formStatus = el(form, '[data-form-status]');
    formError.hidden = true;
    formStatus.textContent = '';
    const values = readProfileForm(form);
    if (!values) return;
    const submit = el<HTMLButtonElement>(form, '[data-submit]');
    submit.disabled = true;
    const { data, error } = await supabase
      .from('profiles')
      .update(values)
      .eq('id', userId)
      .select(`${ACCOUNT_COLUMNS}, role`)
      .maybeSingle<CardProfile>();
    submit.disabled = false;
    if (error || !data) {
      formError.textContent = t('profile.saveError');
      formError.hidden = false;
      return;
    }
    showHeader(data);
    formStatus.textContent = t('panel.saved');
    await loadHistory(supabase, root, userId);
  });

  // Rola (AC-17, AC-18): set_user_role sprawdza admina i ostatniego admina w bazie.
  const roleForm = el<HTMLFormElement>(root, 'form[data-role-form]');
  const roleSelect = el<HTMLSelectElement>(roleForm, 'select');
  let currentRole = profile.role;
  roleSelect.value = currentRole;
  roleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const roleError = el(roleForm, '[data-role-error]');
    const roleStatus = el(roleForm, '[data-role-status]');
    roleError.hidden = true;
    roleStatus.textContent = '';
    const role = roleSelect.value;
    if (role === currentRole || !window.confirm(t('users.confirmRole', { role: roleLabel(role) }))) return;
    const submit = el<HTMLButtonElement>(roleForm, '[data-role-submit]');
    submit.disabled = true;
    const { error } = await supabase.rpc('set_user_role', { user_id: userId, role });
    submit.disabled = false;
    if (error) {
      roleSelect.value = currentRole;
      roleError.textContent = t(roleErrorKey(error));
      roleError.hidden = false;
      return;
    }
    currentRole = role;
    // Admin odebrał sobie rolę (był inny admin) — od razu traci dostęp do panelu admina (§7).
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id === userId && role !== 'admin') return window.location.reload();
    roleStatus.textContent = t('users.roleChanged');
    await loadHistory(supabase, root, userId);
  });

  // Usunięcie konta (AC-23…AC-25): ostrzeżenie i „USUŃ”; własnego konta nie da się usunąć (sprawdza też funkcja).
  const { data: sessionData } = await supabase.auth.getSession();
  mountDelete(supabase, root, userId, canDeleteAccount(sessionData.session?.user.id, userId));

  // SPEC-005 AC-23: „Karnety i zużycie” z „Cofnij zużycie”; po cofnięciu nowy wpis w „Historii zmian”.
  await Promise.all([
    loadHistory(supabase, root, userId),
    mountPassUsages(supabase, root, userId, () => loadHistory(supabase, root, userId)),
  ]);
  loading.hidden = true;
  el(root, '[data-content]').hidden = false;
}

/** Status HTTP z błędu `functions.invoke` (FunctionsHttpError ma `context: Response`). */
function errorStatus(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  return context instanceof Response ? context.status : null;
}

function mountDelete(supabase: SupabaseClient, root: HTMLElement, userId: string, allowed: boolean): void {
  const open = el<HTMLButtonElement>(root, '[data-delete-open]');
  const form = el<HTMLFormElement>(root, 'form[data-delete-form]');
  const input = el<HTMLInputElement>(form, '#u-delete-confirm');
  const submit = el<HTMLButtonElement>(form, '[data-delete-submit]');
  const error = el(form, '[data-delete-error]');

  // AC-25: przycisk niedostępny z podpowiedzią.
  if (!allowed) {
    open.disabled = true;
    el(root, '[data-delete-own]').hidden = false;
    return;
  }
  open.removeAttribute('aria-describedby');

  const close = () => {
    form.hidden = true;
    open.hidden = false;
    input.value = '';
    submit.disabled = true;
    error.hidden = true;
    open.focus();
  };
  open.addEventListener('click', () => {
    open.hidden = true;
    form.hidden = false;
    input.focus();
  });
  el(form, '[data-delete-cancel]').addEventListener('click', close);
  input.addEventListener('input', () => {
    submit.disabled = !isDeleteConfirmed(input.value);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isDeleteConfirmed(input.value)) return;
    error.hidden = true;
    submit.disabled = true;
    let status: number | null;
    try {
      const result = await supabase.functions.invoke(DELETE_USER_FUNCTION, { body: { user_id: userId } });
      status = result.error ? errorStatus(result.error) : 204;
    } catch {
      status = null;
    }
    if (status === 204) {
      el(root, '[data-content]').hidden = true;
      el(root, '[data-title]').textContent = t('users.cardTitle');
      el(root, '[data-deleted]').hidden = false;
      return;
    }
    submit.disabled = false;
    error.textContent = t(deleteResultKey(status));
    error.hidden = false;
  });
}
