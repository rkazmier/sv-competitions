import { describe, expect, it } from 'vitest';
import {
  firstRow,
  institutionText,
  savedText,
  saveErrorText,
  statusText,
  visibleSubmission,
  type MyRangeOfficer,
} from './range-officer-account';

const row = (overrides: Partial<MyRangeOfficer> = {}): MyRangeOfficer => ({
  status: 'pending',
  license_number: '123/2024',
  institution: 'PZSS',
  institution_other: null,
  hide_from_others: true,
  is_active: true,
  submitted_at: '2026-11-19T10:00:00Z',
  ...overrides,
});

describe('SPEC-007 uprawnienia prowadzącego z konta', () => {
  it('AC-1: brak zgłoszenia → nic do pokazania (przycisk „Dodaj uprawnienia prowadzącego”)', () => {
    expect(firstRow([])).toBeNull();
    expect(firstRow(null)).toBeNull();
    expect(visibleSubmission(null)).toBeNull();
  });

  it('AC-13: usunięte zgłoszenie (is_active = false) traktowane jak brak', () => {
    expect(visibleSubmission(row({ is_active: false }))).toBeNull();
    expect(visibleSubmission(row())).toEqual(row());
  });

  it('AC-4, AC-8, AC-9: tekst statusu', () => {
    expect(statusText('pending')).toBe('Uprawnienia prowadzącego: czekają na zatwierdzenie');
    expect(statusText('approved')).toBe('Uprawnienia prowadzącego: zatwierdzone');
    expect(statusText('rejected')).toBe(
      'Uprawnienia prowadzącego: odrzucone. Popraw dane i wyślij ponownie albo skontaktuj się z obsługą strzelnicy.',
    );
  });

  it('AC-4: instytucja — etykieta kodu albo nazwa przy „Inne”', () => {
    expect(institutionText(row({ institution: 'PZL' }))).toBe('PZŁ');
    expect(institutionText(row({ institution: 'OTHER', institution_other: 'Klub Strzelecki X' }))).toBe('Klub Strzelecki X');
  });

  it('AC-3: błąd bazy full_name_required → komunikat o imieniu i nazwisku; inne → ogólny', () => {
    expect(saveErrorText({ message: 'full_name_required' })).toBe(
      'Uzupełnij imię i nazwisko w „Twoje dane”, aby dodać uprawnienia prowadzącego.',
    );
    expect(saveErrorText({ message: 'boom' })).toBe('Nie udało się zapisać. Spróbuj ponownie.');
  });

  it('AC-11: po zapisie — „czekają na zatwierdzenie” tylko gdy status wrócił do pending', () => {
    expect(savedText(row())).toBe('Zapisano. Uprawnienia czekają na zatwierdzenie.');
    expect(savedText(row({ status: 'approved' }))).toBe('Zapisano.');
  });
});
