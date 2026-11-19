import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { calendarDutyError, calendarDutyFromRows, needsRebuild } from './calendar-duty';

describe('dyżurny Prowadzący zawodów i wydarzeń (SPEC-007 US-7)', () => {
  it('AC-26: pole opcjonalne — brak wiersza z bazy to „Nie wskazano”; podpowiedź ze specyfikacji', () => {
    expect(calendarDutyFromRows([])).toBeNull();
    expect(calendarDutyFromRows(null)).toBeNull();
    const duty = { range_officer_id: 'o1', full_name: 'Anna Nowak', on_list: true };
    expect(calendarDutyFromRows([duty])).toEqual(duty);
    expect(t('calendarDuty.label')).toBe('Dyżurny Prowadzący (opcjonalnie)');
    expect(t('calendarDuty.none')).toBe('Nie wskazano');
    expect(t('calendarDuty.hint')).toBe(
      'Obowiązuje we wszystkie dni zawodów lub wydarzenia. Możesz uzupełnić później. Bez dyżurnego obowiązuje grafik dyżurów.',
    );
  });

  it('AC-28: prowadzący spoza listy — komunikat przy zapisie i przy wczytanym dyżurnym', () => {
    expect(calendarDutyError({ code: 'P0001', message: 'range_officer_inactive' })).toBe(
      'Ten prowadzący nie jest już dostępny — wybierz innego.',
    );
    expect(t('calendarDuty.unavailable')).toBe('Wskazany dyżurny nie jest już dostępny — wybierz innego.');
  });

  it('AC-29: konflikt terminów — dzień i nazwa z `detail` błędu', () => {
    expect(
      calendarDutyError({
        code: 'P0001',
        message: 'range_duty_conflict',
        details: '{"day": "2027-06-14", "name": "Puchar Doliny"}',
      }),
    ).toBe('W dniu 14 czerwca 2027 dyżurnego wskazuje już „Puchar Doliny”. Usuń tam dyżurnego albo wskaż tę samą osobę.');
    expect(calendarDutyError({ code: 'P0001', message: 'range_duty_conflict', details: 'zepsute' })).toContain('dyżurnego wskazuje już');
  });

  it('inne błędy obsługuje formularz', () => {
    expect(calendarDutyError(null)).toBeNull();
    expect(calendarDutyError({ code: '23514', message: 'range_officer_inactive' })).toBeNull();
    expect(calendarDutyError({ code: 'P0001', message: 'event_has_tickets' })).toBeNull();
  });

  it('AC-30: zmiana samego dyżurnego nie uruchamia przebudowy strony publicznej', () => {
    const row = { name: 'Puchar', starts_on: '2027-06-14' };
    expect(needsRebuild(false, true, row, { ...row })).toBe(false);
    expect(needsRebuild(false, true, row, { ...row, name: 'Puchar II' })).toBe(true);
    expect(needsRebuild(true, false, null, row)).toBe(true);
    expect(needsRebuild(false, false, row, { ...row, name: 'Szkic' })).toBe(false);
  });
});
