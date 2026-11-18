import { describe, expect, it } from 'vitest';
import {
  annotationAuthor,
  annotationError,
  annotationSaveErrorKey,
  entryPassText,
  groupAnnotations,
  revertErrorKey,
  usageHistory,
  type Annotation,
} from './range-history';

const annotation = (overrides: Partial<Annotation>): Annotation => ({
  id: 'a1',
  entry_id: 'e1',
  body: 'Literówka w nazwisku',
  created_at: '2026-11-18T10:00:00Z',
  author: { full_name: 'Anna Obsługa' },
  ...overrides,
});

describe('SPEC-005 US-7: adnotacje i cofnięcie zużycia', () => {
  it('AC-21: treść adnotacji 5–500 znaków po przycięciu', () => {
    expect(annotationError('  abc ')).toBe('rangeHistory.annotationTooShort');
    expect(annotationError('abcde')).toBeNull();
    expect(annotationError('x'.repeat(500))).toBeNull();
    expect(annotationError('x'.repeat(501))).toBe('rangeHistory.annotationTooLong');
  });

  it('AC-21: adnotacja pokazuje autora; konto usunięte → „—”', () => {
    expect(annotationAuthor(annotation({}))).toBe('Anna Obsługa');
    expect(annotationAuthor(annotation({ author: null }))).toBe('—');
    expect(annotationAuthor(annotation({ author: { full_name: null } }))).toBe('—');
  });

  it('AC-21: adnotacje pod właściwym wpisem, od najstarszej', () => {
    const groups = groupAnnotations([
      annotation({ id: 'a2', created_at: '2026-11-18T12:00:00Z' }),
      annotation({ id: 'a3', entry_id: 'e2' }),
      annotation({ id: 'a1', created_at: '2026-11-18T09:00:00Z' }),
    ]);
    expect(groups.get('e1')?.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(groups.get('e2')?.map((a) => a.id)).toEqual(['a3']);
  });

  it('AC-22: odrzucenie przez RLS (wpis z innego dnia) ma osobny komunikat', () => {
    expect(annotationSaveErrorKey('42501')).toBe('rangeHistory.annotationForbidden');
    expect(annotationSaveErrorKey(undefined)).toBe('rangeHistory.annotationError');
  });

  it('AC-23: komunikaty błędów cofnięcia zużycia', () => {
    expect(revertErrorKey('usage_already_reverted')).toBe('rangeHistory.revertAlready');
    expect(revertErrorKey('forbidden')).toBe('rangeHistory.revertForbidden');
    expect(revertErrorKey('cokolwiek')).toBe('rangeHistory.revertError');
  });
});

describe('SPEC-005 US-8: historia wejść i zużycia', () => {
  it('AC-24: wykorzystane uprawnienie, osoba towarzysząca bez uprawnienia', () => {
    expect(entryPassText({ is_companion: false, pass_name: 'Karnet 10 wejść' })).toEqual({ text: 'Karnet 10 wejść' });
    expect(entryPassText({ is_companion: true, pass_name: null })).toEqual({ key: 'rangeHistory.companion' });
    expect(entryPassText({ is_companion: false, pass_name: null })).toEqual({ key: 'rangeHistory.noPass' });
  });

  it('AC-25: historia zużycia bez cofniętych, od najnowszych', () => {
    const usages = [
      { id: 'u1', used_on: '2026-11-10', created_at: '2026-11-10T09:00:00Z', reverted_at: null },
      { id: 'u2', used_on: '2026-11-12', created_at: '2026-11-12T09:00:00Z', reverted_at: '2026-11-12T10:00:00Z' },
      { id: 'u3', used_on: '2026-11-14', created_at: '2026-11-14T09:00:00Z', reverted_at: null },
    ];
    expect(usageHistory(usages).map((u) => u.id)).toEqual(['u3', 'u1']);
  });
});

describe('SPEC-005 AC-23: historia zmian w karcie użytkownika', () => {
  it('AC-23: wpis audit_log pass_usage_revert jako jedno zdanie z datą zużycia', async () => {
    const { describeChanges } = await import('./admin-users');
    const changes = { used_on: '2026-11-18', effect: 'decremented' } as unknown as Record<string, [unknown, unknown]>;
    expect(describeChanges({ action: 'pass_usage_revert', changes })).toEqual(['Cofnięto zużycie karnetu z dnia 18 listopada 2026']);
  });
});
