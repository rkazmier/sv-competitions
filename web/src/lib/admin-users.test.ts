import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  actorName,
  canDeleteAccount,
  deleteResultKey,
  describeChanges,
  formatDateTime,
  isDeleteConfirmed,
  pageCount,
  roleErrorKey,
  roleLabel,
  searchTerm,
  userCardHref,
  userIdFromSearch,
} from './admin-users';

describe('lista kont', () => {
  it('AC-16: wyszukiwanie od 2 znaków po trim, krótsza fraza bez filtra', () => {
    expect(searchTerm('  ko ')).toBe('ko');
    expect(searchTerm(' k ')).toBeNull();
    expect(searchTerm('')).toBeNull();
    expect(searchTerm('Łu')).toBe('Łu');
  });

  it('AC-16: 50 kont na stronę, zawsze co najmniej jedna strona', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
  });

  it('AC-16: role po polsku', () => {
    expect(roleLabel('user')).toBe('Użytkownik');
    expect(roleLabel('staff')).toBe('Obsługa strzelnicy');
    expect(roleLabel('admin')).toBe('Admin');
  });

  it('karta użytkownika: ?id= tylko w formacie uuid', () => {
    const id = '0a1b2c3d-0000-4000-8000-00000000abcd';
    expect(userIdFromSearch(new URL(userCardHref(id), 'http://x').search)).toBe(id);
    expect(userIdFromSearch('?id=abc')).toBeNull();
    expect(userIdFromSearch('')).toBeNull();
  });
});

describe('zmiana roli', () => {
  it('AC-18: ostatni admin → „Musi zostać co najmniej jeden admin.”', () => {
    expect(roleErrorKey({ message: 'last_admin' })).toBe('users.lastAdmin');
    expect(roleErrorKey({ message: 'forbidden' })).toBe('panel.saveError');
  });
});

describe('historia zmian', () => {
  it('AC-21: zmiana roli i pól danych — stara i nowa wartość po polsku', () => {
    expect(describeChanges({ action: 'role_change', changes: { role: ['user', 'staff'] } })).toEqual([
      'Rola: Użytkownik → Obsługa strzelnicy',
    ]);
    expect(
      describeChanges({ action: 'profile_update', changes: { phone: [null, '600 100 200'], full_name: ['Jan', 'Jan Nowak'] } }),
    ).toEqual(['Telefon: nie podano → 600 100 200', 'Imię i nazwisko: Jan → Jan Nowak']);
  });

  it('AC-21: kto — imię i nazwisko autora albo opis zastępczy', () => {
    expect(actorName({ actor: { full_name: 'Anna Admin' } })).toBe('Anna Admin');
    expect(actorName({ actor: { full_name: null } })).toBe('(konto bez imienia i nazwiska)');
    expect(actorName({ actor: null })).toBe('(konto usunięte)');
  });

  it('AC-21: data i godzina w strefie Europe/Warsaw', () => {
    expect(formatDateTime('2027-01-15T11:05:00Z')).toBe('15.01.2027, 12:05');
  });
});

describe('usunięcie konta', () => {
  it('AC-23: potwierdzenie wymaga wpisania „USUŃ”', () => {
    expect(isDeleteConfirmed('USUŃ')).toBe(true);
    expect(isDeleteConfirmed('  USUŃ ')).toBe(true);
    expect(isDeleteConfirmed('USUN')).toBe(false);
    expect(isDeleteConfirmed('usuń')).toBe(false);
    expect(isDeleteConfirmed('')).toBe(false);
  });

  it('AC-25: admin nie usuwa własnego konta', () => {
    expect(canDeleteAccount('a', 'a')).toBe(false);
    expect(canDeleteAccount('a', 'b')).toBe(true);
    expect(canDeleteAccount(null, 'b')).toBe(false);
  });

  it('AC-24, AC-25: odpowiedź admin-delete-user → komunikat', () => {
    expect(t(deleteResultKey(204))).toBe('Konto zostało usunięte.');
    expect(t(deleteResultKey(409))).toBe('Nie możesz usunąć własnego konta.');
    expect(t(deleteResultKey(404))).toBe('Nie znaleziono konta.');
    expect(t(deleteResultKey(403))).toBe('Nie masz uprawnień do usunięcia konta.');
    expect(t(deleteResultKey(500))).toBe('Nie udało się usunąć konta. Spróbuj ponownie.');
    expect(t(deleteResultKey(null))).toBe('Nie udało się usunąć konta. Spróbuj ponownie.');
  });
});
