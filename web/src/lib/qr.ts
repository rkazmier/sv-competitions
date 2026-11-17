/**
 * Kod QR konta (SPEC-002 AC-12): SVG generowany w przeglądarce z pakietu `qrcode` — bez usług zewnętrznych.
 * Treść kodu to wyłącznie `qr_token` (losowy, bez danych osobowych).
 */
import QRCode from 'qrcode';

/** Margines wokół kodu w modułach (strefa ciszy wymagana przez czytniki). */
export const QUIET_ZONE = 4;

export interface QrMatrix {
  size: number;
  /** `true` = ciemny moduł; wiersz po wierszu. */
  dark: (x: number, y: number) => boolean;
}

/** Macierz modułów kodu dla treści (poziom korekcji M — działa z porysowanego wydruku i ekranu). */
export function qrMatrix(payload: string): QrMatrix {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  return { size: modules.size, dark: (x, y) => Boolean(modules.get(y, x)) };
}

/**
 * Kod jako `<svg>`: czarne moduły na białym tle, jedna ścieżka, skalowalny (rozmiar ustala CSS).
 * `label` — tekst alternatywny dla czytników ekranu.
 */
export function qrSvg(payload: string, label: string): string {
  const { size, dark } = qrMatrix(payload);
  const total = size + 2 * QUIET_ZONE;
  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (dark(x, y)) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  const title = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" ` +
    `shape-rendering="crispEdges"><title>${title}</title>` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`
  );
}
