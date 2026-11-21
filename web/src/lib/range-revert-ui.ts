/**
 * Karta użytkownika `/panel/uzytkownicy/profil/` — „Karnety i zużycie” (SPEC-005 AC-23, AC-25). Tylko admin.
 * Przy każdym zużyciu „Cofnij zużycie” → `rpc/revert_pass_usage` (licznik +1 / zdjęcie aktywacji, adnotacja do wpisu,
 * `audit_log` `pass_usage_revert` — wszystko w bazie). Wpis w książce zostaje.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { formatDateTime, passGiftText, type CardPassOrder } from './admin-users';
import { revertErrorKey, usageHistory, type PassUsage } from './range-history';

interface CardPass {
  id: string;
  created_at: string;
  orders: CardPassOrder | null;
  pass_usages: PassUsage[];
}

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/** Wczytuje karnety osoby; `onReverted` — np. odświeżenie „Historii zmian”. */
export async function mountPassUsages(
  supabase: SupabaseClient,
  root: HTMLElement,
  userId: string,
  onReverted: () => Promise<void>,
): Promise<void> {
  const section = el(root, '[data-pass-usages]');
  const list = el(section, '[data-pass-list]');
  const status = el(section, '[data-revert-status]');
  const error = el(section, '[data-revert-error]');

  async function load(): Promise<void> {
    const { data, error: loadError } = await supabase
      .from('user_passes')
      // SPEC-010 AC-16: powód przyznania z `order_grants` (RLS: tylko admin — ta karta jest tylko dla admina).
      .select('id, created_at, orders(item_name, order_grants(reason)), pass_usages(id, used_on, created_at, reverted_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (loadError) {
      error.textContent = t('rangeHistory.loadError');
      error.hidden = false;
      return;
    }
    const passes = (data ?? []) as unknown as CardPass[];
    el(section, '[data-pass-empty]').hidden = passes.length > 0;
    list.replaceChildren(...passes.map(renderPass));
  }

  function renderPass(pass: CardPass): HTMLElement {
    const item = document.createElement('li');
    const name = document.createElement('h3');
    name.textContent = pass.orders?.item_name ?? '';
    const usages = usageHistory(pass.pass_usages);
    const rows = document.createElement('ul');
    rows.replaceChildren(
      ...usages.map((usage) => {
        const li = document.createElement('li');
        const time = formatDateTime(usage.created_at);
        const text = document.createElement('span');
        text.textContent = time;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button';
        button.textContent = t('rangeHistory.revert');
        const sr = document.createElement('span');
        sr.className = 'visually-hidden';
        sr.textContent = ` ${t('rangeHistory.revertSr', { time })}`;
        button.append(sr);
        button.addEventListener('click', () => void revert(usage.id, time, button));
        li.append(text, ' ', button);
        return li;
      }),
    );
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = t('rangeHistory.usageEmpty');
    item.append(name);
    const gift = passGiftText(pass.orders);
    if (gift) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = gift;
      item.append(p);
    }
    item.append(usages.length ? rows : none);
    return item;
  }

  async function revert(usageId: string, time: string, button: HTMLButtonElement): Promise<void> {
    if (!window.confirm(t('rangeHistory.revertConfirm', { time }))) return;
    status.textContent = '';
    error.hidden = true;
    button.disabled = true;
    const { error: rpcError } = await supabase.rpc('revert_pass_usage', { p_usage_id: usageId });
    button.disabled = false;
    if (rpcError) {
      error.textContent = t(revertErrorKey(rpcError.message));
      error.hidden = false;
      return;
    }
    status.textContent = t('rangeHistory.revertDone');
    await Promise.all([load(), onReverted()]);
  }

  await load();
}
