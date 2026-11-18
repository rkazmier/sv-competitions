/**
 * Pole podpisu palcem / rysikiem (SPEC-005 AC-14, AC-15) i zapis wpisu (AC-15, AC-16).
 * Podczas rysowania strona się nie przewija (`touch-action: none` w CSS + `preventDefault`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_SIGNATURE_BYTES, isAlreadyUploaded, isSignatureComplete, type EntryPerson, type Stroke } from './range-sign';

export interface SignaturePad {
  readonly complete: boolean;
  /** Zmienia się przy każdej zmianie podpisu — po „Wyczyść” i ponownym podpisie wpis dostaje nowy plik. */
  readonly version: number;
  clear(): void;
  toPng(): Promise<Blob | null>;
}

function draw(context: CanvasRenderingContext2D, strokes: readonly Stroke[], scale: number): void {
  context.lineWidth = 2.5 * scale;
  context.lineCap = context.lineJoin = 'round';
  context.strokeStyle = '#000';
  for (const stroke of strokes) {
    context.beginPath();
    stroke.forEach((p, i) => (i ? context.lineTo(p.x * scale, p.y * scale) : context.moveTo(p.x * scale, p.y * scale)));
    if (stroke.length === 1) context.lineTo(stroke[0].x * scale + 0.1, stroke[0].y * scale);
    context.stroke();
  }
}

export function mountSignaturePad(canvas: HTMLCanvasElement, onChange: () => void): SignaturePad {
  let strokes: Stroke[] = [];
  let drawing = false;
  let version = 0;
  const context = canvas.getContext('2d')!;

  const redraw = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    draw(context, strokes, ratio);
  };
  const point = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const changed = () => {
    version += 1;
    onChange();
  };

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    strokes.push([point(event)]);
    redraw();
    changed();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    strokes[strokes.length - 1].push(point(event));
    redraw();
    changed();
  });
  const stop = () => (drawing = false);
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  new ResizeObserver(redraw).observe(canvas);

  return {
    get complete() {
      return isSignatureComplete(strokes);
    },
    get version() {
      return version;
    },
    clear() {
      strokes = [];
      redraw();
      changed();
    },
    // AC-15: PNG na białym tle, maks. 200 KB — przy przekroczeniu mniejsza rozdzielczość.
    async toPng() {
      for (const scale of [1, 0.5]) {
        const out = document.createElement('canvas');
        out.width = Math.round(canvas.clientWidth * scale);
        out.height = Math.round(canvas.clientHeight * scale);
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out.width, out.height);
        draw(ctx, strokes, scale);
        const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
        if (blob && blob.size <= MAX_SIGNATURE_BYTES) return blob;
      }
      return null;
    },
  };
}

export interface EntryRequest {
  id: string;
  path: string;
  png: Blob;
  officerId: string;
  profileId: string | null;
  passId: string | null;
  companion: boolean;
  /** Osoba bez konta (AC-18) — dane podane na miejscu; z kontem baza kopiuje dane z profilu. */
  guest: EntryPerson | null;
}

/** AC-15, AC-16: plik podpisu, potem wpis i zużycie w jednej transakcji `create_range_log_entry`. */
export async function saveRangeEntry(
  supabase: SupabaseClient,
  request: EntryRequest,
): Promise<{ entered_at: string } | { error: { message?: string } }> {
  const upload = await supabase.storage
    .from('signatures')
    .upload(request.path, request.png, { contentType: 'image/png', upsert: false });
  if (upload.error && !isAlreadyUploaded(upload.error as { message?: string; statusCode?: string })) {
    return { error: { message: 'upload_failed' } };
  }
  const { data, error } = await supabase.rpc('create_range_log_entry', {
    p_id: request.id,
    p_signature_path: request.path,
    p_range_officer_id: request.officerId,
    p_profile_id: request.profileId,
    p_user_pass_id: request.companion ? null : request.passId,
    p_is_companion: request.companion,
    p_full_name: request.guest?.full_name ?? null,
    p_permit_number: request.guest?.permit_number ?? null,
    p_permit_authority: request.guest?.permit_authority ?? null,
    p_address: request.guest?.address ?? null,
  });
  const row = ((data ?? []) as { entered_at: string }[])[0];
  return error || !row ? { error: error ?? {} } : row;
}
