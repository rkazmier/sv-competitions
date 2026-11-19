import { describe, expect, it } from 'vitest';
import type { DictionaryItem } from './dictionary';
import {
  canEditOfficer,
  canToggleOfficer,
  officerTags,
  pendingMenuLabel,
  pendingSubmissions,
  reviewDoneText,
  reviewErrorText,
  submissionDetails,
} from './range-officer-review';

const officer = (overrides: Partial<DictionaryItem> = {}): DictionaryItem => ({
  id: 'a',
  name: 'Anna Prowadząca',
  is_active: true,
  license_number: '123/2024',
  institution: 'PZSS',
  institution_other: null,
  profile_id: 'p1',
  status: 'pending',
  hide_from_others: true,
  submitted_at: '2026-11-19T10:00:00Z',
  ...overrides,
});

describe('SPEC-007 US-2 zatwierdzanie zgłoszeń prowadzących z kont', () => {
  it('AC-7: „Do zatwierdzenia” — tylko aktywne zgłoszenia z kont w stanie pending, najstarsze najpierw', () => {
    const items = [
      officer({ id: 'new', submitted_at: '2026-11-19T12:00:00Z' }),
      officer({ id: 'old', submitted_at: '2026-11-18T12:00:00Z' }),
      officer({ id: 'approved', status: 'approved' }),
      officer({ id: 'rejected', status: 'rejected' }),
      officer({ id: 'removed', is_active: false }),
      officer({ id: 'admin', profile_id: null, status: 'approved', hide_from_others: false }),
    ];
    expect(pendingSubmissions(items).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('AC-7: zgłoszenie pokazuje nr legitymacji, instytucję i datę zgłoszenia (Europe/Warsaw)', () => {
    expect(submissionDetails(officer())).toBe('Nr legitymacji: 123/2024 · PZSS · zgłoszono 19.11.2026, 11:00');
    expect(submissionDetails(officer({ institution: 'OTHER', institution_other: 'Klub ABC', submitted_at: null }))).toBe(
      'Nr legitymacji: 123/2024 · Klub ABC',
    );
  });

  it('AC-7: licznik w menu dla czytników ekranu', () => {
    expect(pendingMenuLabel(2)).toBe('Prowadzący, do zatwierdzenia: 2');
  });

  it('AC-8, AC-9: komunikaty po decyzji i błąd, gdy zgłoszenie rozpatrzono w międzyczasie', () => {
    expect(reviewDoneText('approved')).toBe('Zatwierdzono.');
    expect(reviewDoneText('rejected')).toBe('Odrzucono.');
    expect(reviewErrorText({ message: 'not_pending' })).toBe('To zgłoszenie zostało już rozpatrzone. Odśwież stronę.');
    expect(reviewErrorText({ message: 'forbidden' })).toBe('Nie udało się zapisać. Spróbuj ponownie.');
  });

  it('AC-10: oznaczenia „Z konta” i „Ukryty dla innych”; prowadzący admina bez oznaczeń', () => {
    expect(officerTags(officer({ status: 'approved' }))).toEqual(['Z konta', 'Ukryty dla innych']);
    expect(officerTags(officer({ status: 'approved', hide_from_others: false }))).toEqual(['Z konta']);
    expect(officerTags(officer({ status: 'rejected', hide_from_others: false }))).toEqual(['Z konta', 'Odrzucony']);
    expect(officerTags(officer({ profile_id: null, hide_from_others: false, status: 'approved' }))).toEqual([]);
  });

  it('AC-10: Obsługa tylko odczyt; admin nie edytuje danych zgłoszeń z kont, tylko „Ukryj” / „Przywróć”', () => {
    const own = officer({ status: 'approved' });
    const added = officer({ profile_id: null, status: 'approved', hide_from_others: false });
    expect(canEditOfficer(added, 'admin')).toBe(true);
    expect(canEditOfficer(own, 'admin')).toBe(false);
    expect(canEditOfficer(added, 'staff')).toBe(false);
    expect(canToggleOfficer('admin')).toBe(true);
    expect(canToggleOfficer('staff')).toBe(false);
  });
});
