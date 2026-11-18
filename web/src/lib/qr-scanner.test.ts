import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanQrCode } from './qr-scanner';

/** Minimalna atrapa `<dialog>` z `<video>` i polem statusu — testy działają bez DOM. */
function fakeDialog() {
  const listeners: Array<() => void> = [];
  const video = { srcObject: null as unknown, play: vi.fn(async () => undefined), videoWidth: 0 };
  const status = { textContent: '' };
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      listeners.splice(0).forEach((listener) => listener());
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.push(listener);
    },
    querySelector(selector: string) {
      return selector === 'video' ? video : status;
    },
  };
  return { dialog: dialog as unknown as HTMLDialogElement, video };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scanQrCode', () => {
  it('zatrzymuje kamerę, gdy okno zamknięto przed startem strumienia (monit o zgodę)', async () => {
    const { dialog, video } = fakeDialog();
    const { track, stream } = fakeStream();
    let grant!: (value: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => (grant = resolve)));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    const result = scanQrCode(dialog);
    dialog.close();
    await expect(result).resolves.toBeNull();

    grant(stream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('zatrzymuje kamerę, gdy okno zamknięto w trakcie uruchamiania podglądu', async () => {
    const { dialog, video } = fakeDialog();
    const { track, stream } = fakeStream();
    video.play.mockImplementation(async () => {
      dialog.close();
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });

    await expect(scanQrCode(dialog)).resolves.toBeNull();
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(video.srcObject).toBeNull();
  });
});
