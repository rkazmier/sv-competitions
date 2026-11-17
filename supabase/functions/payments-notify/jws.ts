/**
 * Weryfikacja podpisu JWS powiadomień Tpay (ADR-0002): nagłówek `X-JWS-Signature` = `<header>..<signature>`
 * (payload odłączony = surowe body), algorytm RS256, certyfikat z adresu `x5u`, który musi być dokładnie
 * adresem certyfikatu Tpay dla danego środowiska (zaufanie: stały adres na domenie Tpay + HTTPS).
 */

/** Certyfikat podpisu powiadomień dla adresu API Tpay; `undefined` — nieznane środowisko. */
export function certificateUrl(tpayApiUrl: string): string | undefined {
  const base = tpayApiUrl.replace(/\/$/, '');
  if (base === 'https://openapi.sandbox.tpay.com') return 'https://secure.sandbox.tpay.com/x509/notifications-jws.pem';
  if (base === 'https://api.tpay.com') return 'https://secure.tpay.com/x509/notifications-jws.pem';
  return undefined;
}

/** Bajty na zwykłym `ArrayBuffer` (wymaganie typów WebCrypto). */
export type Bytes = Uint8Array<ArrayBuffer>;

export function base64UrlDecode(text: string): Bytes {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Element DER pod `offset`: zakres całego elementu i jego zawartości. */
function derElement(der: Uint8Array, offset: number): { start: number; content: number; end: number } {
  let length = der[offset + 1];
  let content = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + der[content + i];
    content += bytes;
  }
  if (content + length > der.length) throw new Error('der_truncated');
  return { start: offset, content, end: content + length };
}

/** `SubjectPublicKeyInfo` z certyfikatu X.509 (DER): Certificate → tbsCertificate → 7. element (6., gdy bez wersji). */
export function publicKeyInfo(certificate: Bytes): Bytes {
  const tbs = derElement(certificate, derElement(certificate, 0).content);
  let offset = tbs.content;
  if (certificate[offset] === 0xa0) offset = derElement(certificate, offset).end; // [0] version
  for (let i = 0; i < 5; i++) offset = derElement(certificate, offset).end; // serial, alg, issuer, validity, subject
  const spki = derElement(certificate, offset);
  if (certificate[offset] !== 0x30) throw new Error('der_no_spki');
  return certificate.slice(spki.start, spki.end);
}

export function pemToDer(pem: string): Bytes {
  const body = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)?.[1];
  if (!body) throw new Error('pem_invalid');
  return Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
}

export type KeyLoader = (url: string) => Promise<CryptoKey>;

/** Klucz publiczny z certyfikatu PEM pobranego z `url`. */
export function keyLoader(fetchFn: typeof fetch, cache?: Map<string, Promise<CryptoKey>>): KeyLoader {
  return (url) => {
    const cached = cache?.get(url);
    if (cached) return cached;
    const key = (async () => {
      const response = await fetchFn(url);
      if (!response.ok) throw new Error(`certificate_${response.status}`);
      const spki = publicKeyInfo(pemToDer(await response.text()));
      return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    })();
    cache?.set(url, key);
    key.catch(() => cache?.delete(url));
    return key;
  };
}

/** `true` tylko dla poprawnego podpisu RS256 certyfikatem z oczekiwanego adresu. */
export async function verifyDetachedJws(
  signature: string,
  body: Bytes,
  expectedCertificateUrl: string,
  loadKey: KeyLoader,
): Promise<boolean> {
  const parts = signature.split('.');
  if (parts.length !== 3 || parts[1] !== '' || !parts[0] || !parts[2]) return false;
  let header: { alg?: string; x5u?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  } catch {
    return false;
  }
  if (header?.alg !== 'RS256' || header.x5u !== expectedCertificateUrl) return false;
  const key = await loadKey(expectedCertificateUrl);
  const input = new TextEncoder().encode(`${parts[0]}.${base64UrlEncode(body)}`);
  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(parts[2]), input);
  } catch {
    return false;
  }
}
