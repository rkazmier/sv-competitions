/**
 * Skan kodu QR kamerą (SPEC-005 AC-5, §6): `BarcodeDetector`, a gdy niedostępny — `jsqr` (biblioteka JS
 * w paczce strony, bez usług zewnętrznych). Kamera tylna domyślnie. Używane w `/panel/ksiazka/` i `/panel/sprzedaz/`.
 * Okno skanera: components/QrScanDialog.astro.
 */
import { t } from '../i18n';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

/** `BarcodeDetector` z obsługą formatu `qr_code`, inaczej `null` (np. Firefox, Safari na starszym iOS). */
async function nativeDecoder(): Promise<Decoder | null> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    if (!(await Detector.getSupportedFormats()).includes('qr_code')) return null;
  } catch {
    return null;
  }
  const detector = new Detector({ formats: ['qr_code'] });
  return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
}

/** Zapasowo: klatka z wideo na kanwę → `jsqr` (ładowany dopiero, gdy potrzebny). */
async function fallbackDecoder(): Promise<Decoder> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!context || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * Otwiera okno skanera i czeka na pierwszy odczytany kod. `null` = zamknięto okno.
 * Brak kamery lub zgody → komunikat w oknie (obsługa wyszukuje osobę ręcznie, AC-6).
 */
export async function scanQrCode(dialog: HTMLDialogElement): Promise<string | null> {
  const video = dialog.querySelector<HTMLVideoElement>('video')!;
  const status = dialog.querySelector<HTMLElement>('[data-scan-status]')!;
  status.textContent = t('scan.starting');
  dialog.showModal();

  let stream: MediaStream | null = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  };

  return new Promise<string | null>((resolve) => {
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stopStream();
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.addEventListener('close', () => finish(null), { once: true });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        status.textContent = t('scan.noCamera');
        return;
      }
      // Okno zamknięto, zanim kamera wystartowała (np. podczas monitu o zgodę) — `finish` już się wykonał,
      // więc strumień trzeba zatrzymać tutaj, inaczej kamera zostaje włączona.
      if (finished) return stopStream();
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (finished) return stopStream();
      const decode = (await nativeDecoder()) ?? (await fallbackDecoder());
      if (finished) return stopStream();
      status.textContent = t('scan.hint');
      const tick = async () => {
        if (finished) return;
        const text = await decode(video).catch(() => null);
        if (text) return finish(text);
        timer = setTimeout(() => void tick(), 200);
      };
      void tick();
    })();
  });
}
