import { describe, expect, it } from 'vitest';
import {
  RULEBOOK_MAX_BYTES,
  canDelete,
  fromRow,
  hasPdfSignature,
  rulebookPath,
  sortRulebooks,
  uploadDay,
  validateFile,
  validateTitle,
  type Rulebook,
} from './rulebooks';

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7');
const pdf = (size: number, name = 'regulamin.pdf', type = 'application/pdf') => ({ name, type, size });

describe('regulaminy — walidacja pliku', () => {
  it('AC-12: PDF do 20 MB jest przyjmowany (także dokładnie 20 MB)', () => {
    expect(validateFile(pdf(1024), PDF_HEAD)).toBeNull();
    expect(validateFile(pdf(RULEBOOK_MAX_BYTES), PDF_HEAD)).toBeNull();
  });

  it('AC-12: brak pliku', () => {
    expect(validateFile(null)).toBe('required');
  });

  it('AC-13: plik ponad 20 MB jest za duży', () => {
    expect(validateFile(pdf(RULEBOOK_MAX_BYTES + 1), PDF_HEAD)).toBe('tooLarge');
  });

  it('AC-13: plik, który nie jest PDF (typ, rozszerzenie, sygnatura, pusty)', () => {
    expect(validateFile(pdf(1024, 'zdjecie.jpg', 'image/jpeg'))).toBe('notPdf');
    expect(validateFile(pdf(1024, 'regulamin.docx', ''))).toBe('notPdf');
    expect(validateFile(pdf(1024, 'udaje.pdf'), new TextEncoder().encode('<html>'))).toBe('notPdf');
    expect(validateFile(pdf(0))).toBe('notPdf');
  });

  it('AC-13: nie-PDF ponad 20 MB — komunikat o typie pliku', () => {
    expect(validateFile(pdf(RULEBOOK_MAX_BYTES + 1, 'film.mp4', 'video/mp4'))).toBe('notPdf');
  });

  it('AC-12: pusty typ MIME (telefon) — decyduje rozszerzenie i sygnatura', () => {
    expect(validateFile(pdf(1024, 'REGULAMIN.PDF', ''), PDF_HEAD)).toBeNull();
  });

  it('AC-13: sygnatura %PDF-', () => {
    expect(hasPdfSignature(PDF_HEAD)).toBe(true);
    expect(hasPdfSignature(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('regulaminy — tytuł i ścieżka', () => {
  it('AC-12: tytuł wymagany, maks. 200 znaków po trim', () => {
    expect(validateTitle('Regulamin Pucharu 2027')).toBeNull();
    expect(validateTitle('   ')).toBe('required');
    expect(validateTitle(` ${'ą'.repeat(200)} `)).toBeNull();
    expect(validateTitle('a'.repeat(201))).toBe('tooLong');
  });

  it('AC-12: ścieżka w Storage rulebooks/<uuid>.pdf, bez nazwy oryginalnego pliku', () => {
    expect(rulebookPath('0b6c2f4e-1111-4222-8333-444455556666')).toBe(
      'rulebooks/0b6c2f4e-1111-4222-8333-444455556666.pdf',
    );
  });
});

const base: Rulebook = {
  id: '1',
  title: 'A',
  file_path: 'rulebooks/1.pdf',
  file_size: 1,
  is_archived: false,
  created_at: '2026-11-10T10:00:00Z',
  usage: 0,
};

describe('regulaminy — lista', () => {
  it('AC-15: „Usuń” tylko dla nieużywanych', () => {
    expect(canDelete({ usage: 0 })).toBe(true);
    expect(canDelete({ usage: 2 })).toBe(false);
  });

  it('AC-12: liczba zawodów z competitions(id)', () => {
    const { usage } = fromRow({ ...base, competitions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(usage).toBe(3);
    expect(fromRow({ ...base, competitions: [] }).usage).toBe(0);
  });

  it('AC-14: zarchiwizowane na końcu, w grupie od najnowszych', () => {
    const sorted = sortRulebooks([
      { ...base, id: 'old', created_at: '2026-01-01T00:00:00Z' },
      { ...base, id: 'arch', is_archived: true, created_at: '2026-12-01T00:00:00Z' },
      { ...base, id: 'new', created_at: '2026-06-01T00:00:00Z' },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old', 'arch']);
  });

  it('AC-12: data wczytania w strefie Europe/Warsaw', () => {
    expect(uploadDay('2026-11-13T23:30:00Z')).toBe('2026-11-14');
    expect(uploadDay('2026-07-01T21:59:00Z')).toBe('2026-07-01');
  });
});
