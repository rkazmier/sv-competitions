/**
 * Sekcja „Do zatwierdzenia (n)” w `/panel/prowadzacy/` (SPEC-007 AC-7…AC-9) — Obsługa i admin.
 * Decyzja przez `review_range_officer` (baza zapisuje `reviewed_by`, `reviewed_at` i `audit_log`).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { DictionaryItem } from './dictionary';
import {
  PENDING_COUNT_EVENT,
  pendingSubmissions,
  reviewDoneText,
  reviewErrorText,
  submissionDetails,
  type ReviewDecision,
} from './range-officer-review';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/**
 * Podłącza sekcję; zwraca `render(items)` wywoływane po każdej zmianie listy prowadzących.
 * `onReviewed(id, decision)` aktualizuje wiersz na liście (bez ponownego pobierania).
 */
export function mountOfficerReview(
  root: HTMLElement,
  supabase: SupabaseClient,
  onReviewed: (id: string, decision: ReviewDecision, message: string) => void,
): (items: readonly DictionaryItem[]) => void {
  const section = el(root, '[data-review]');
  const heading = el(section, '[data-review-heading]');
  const list = el<HTMLUListElement>(section, '[data-review-list]');
  const status = el(section, '[data-review-status]');
  const template = el<HTMLTemplateElement>(section, '[data-review-template]');

  async function decide(item: DictionaryItem, decision: ReviewDecision, buttons: HTMLButtonElement[]): Promise<void> {
    // AC-9: odrzucenie po potwierdzeniu.
    if (decision === 'rejected' && !window.confirm(t('officerReview.rejectConfirm', { name: item.name }))) return;
    status.className = '';
    status.textContent = '';
    for (const button of buttons) button.disabled = true;
    const { error } = await supabase.rpc('review_range_officer', { p_id: item.id, p_decision: decision });
    for (const button of buttons) button.disabled = false;
    if (error) {
      status.className = 'message-error';
      status.textContent = reviewErrorText(error);
      return;
    }
    onReviewed(item.id, decision, reviewDoneText(decision));
  }

  function renderItem(item: DictionaryItem): HTMLLIElement {
    const li = el<HTMLLIElement>(template.content.cloneNode(true) as DocumentFragment, '[data-review-item]');
    el(li, '[data-review-name]').textContent = item.name;
    el(li, '[data-review-details]').textContent = submissionDetails(item);
    for (const span of li.querySelectorAll<HTMLElement>('[data-sr-name]')) span.textContent = `: ${item.name}`;
    const approve = el<HTMLButtonElement>(li, '[data-approve]');
    const reject = el<HTMLButtonElement>(li, '[data-reject]');
    approve.addEventListener('click', () => void decide(item, 'approved', [approve, reject]));
    reject.addEventListener('click', () => void decide(item, 'rejected', [approve, reject]));
    return li;
  }

  return (items) => {
    const pending = pendingSubmissions(items);
    section.hidden = pending.length === 0;
    heading.textContent = t('officerReview.heading', { count: pending.length });
    list.replaceChildren(...pending.map(renderItem));
    document.dispatchEvent(new CustomEvent(PENDING_COUNT_EVENT, { detail: pending.length }));
  };
}
