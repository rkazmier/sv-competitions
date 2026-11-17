import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QUIET_ZONE, qrMatrix, qrSvg } from './qr';

/** Odczyt kodu jak skanerem: macierz modułów → obraz RGBA → jsQR. */
function scan(payload: string): string | undefined {
  const { size, dark } = qrMatrix(payload);
  const scale = 4;
  const side = (size + 2 * QUIET_ZONE) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let py = 0; py < side; py += 1) {
    for (let px = 0; px < side; px += 1) {
      const x = Math.floor(px / scale) - QUIET_ZONE;
      const y = Math.floor(py / scale) - QUIET_ZONE;
      if (x >= 0 && y >= 0 && x < size && y < size && dark(x, y)) {
        pixels.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
      }
    }
  }
  return jsQR(pixels, side, side)?.data;
}

const token = 'q7N2xY-_abcdEFGH0123456789ijklmn';

describe('kod QR konta', () => {
  it('AC-12: kod zawiera wyłącznie qr_token (odczyt skanerem)', () => {
    expect(scan(token)).toBe(token);
  });

  it('AC-12: SVG wygenerowane lokalnie — bez odwołań do zewnętrznych adresów, z tekstem alternatywnym', () => {
    const svg = qrSvg(token, 'Kod QR konta');
    expect(svg).toMatch(/^<svg [^>]*role="img"/);
    expect(svg).toContain('<title>Kod QR konta</title>');
    expect(svg).not.toMatch(/href|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(svg).not.toContain(token);
  });

  it('AC-15: inny token → inny kod', () => {
    expect(qrSvg(token, 'x')).not.toBe(qrSvg(`${token.slice(1)}A`, 'x'));
  });
});
