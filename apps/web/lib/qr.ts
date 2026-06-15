/**
 * QR-code generation with brand-disciplined styling and a MinIO byte cache.
 *
 * We only ever render QR codes in a curated palette (monochrome plus four
 * desaturated accents) — arbitrary colours are rejected so every generated code
 * stays on-brand. Results are content-addressed and cached in object storage
 * keyed by the *style* (data + format + colours + size), so a repeat request
 * for an identical code is a single MinIO GET instead of a re-render.
 *
 * Server-only: uses the `qrcode` package's pure-JS renderers
 * (`toBuffer` for PNG, `toString` for SVG) — no native canvas dependency.
 */
import { createHash } from 'node:crypto';
import { getObject, putObject } from '@clipal/s3';
import QRCode from 'qrcode';

export type QrFormat = 'png' | 'svg';

/**
 * The only foreground colours a QR code may use. Keys are the stable preset
 * *names* exposed to the UI / query string; values are the hex actually fed to
 * the renderer. Background is always paper-white for maximum scan contrast.
 *
 * `mono` is the default (near-black zinc-950, never pure #000 — house rule).
 * The four accents are deliberately desaturated to match the monochrome system.
 */
export const QR_FG_PRESETS = {
  mono: '#0a0a0a', // zinc-950 — default, never pure black
  zinc: '#52525b', // zinc-600 — soft grey
  blue: '#3f5b8b', // desaturated slate-blue accent
  green: '#3f6b52', // desaturated forest accent
  amber: '#8b6b3f', // desaturated amber accent
} as const;

export type QrPreset = keyof typeof QR_FG_PRESETS;

/** Paper-white background — fixed, not user-selectable (contrast/brand). */
export const QR_BG = '#ffffff';

/** Allowed module sizes (px) for the PNG raster. SVG scales freely but we still
 * clamp the requested size into this set to bound the cache key-space. */
export const QR_SIZES = [256, 512, 1024] as const;
export type QrSize = (typeof QR_SIZES)[number];

export const QR_DEFAULT_SIZE: QrSize = 512;

/** Type guard: is `v` a known foreground preset name? */
export function isQrPreset(v: string): v is QrPreset {
  return Object.prototype.hasOwnProperty.call(QR_FG_PRESETS, v);
}

/** Coerce an arbitrary number into one of the allowed sizes (nearest, clamped). */
export function coerceQrSize(n: number | undefined): QrSize {
  if (!n || !Number.isFinite(n)) return QR_DEFAULT_SIZE;
  let best: QrSize = QR_SIZES[0];
  let bestDelta = Math.abs(n - best);
  for (const s of QR_SIZES) {
    const d = Math.abs(n - s);
    if (d < bestDelta) {
      best = s;
      bestDelta = d;
    }
  }
  return best;
}

export interface GenerateQrInput {
  /** The payload to encode — for our use always an http(s) short URL. */
  data: string;
  format: QrFormat;
  /** Foreground preset name; defaults to `mono`. Arbitrary hex is rejected. */
  fg?: QrPreset;
  /** Module raster size in px (PNG); SVG uses it as the nominal width. */
  size?: QrSize;
}

export interface GeneratedQr {
  bytes: Buffer;
  contentType: string;
  /** Object-storage key the bytes are cached under. */
  cacheKey: string;
  /** Whether the bytes came from the MinIO cache (vs. freshly rendered). */
  cached: boolean;
}

const CONTENT_TYPE: Record<QrFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
};

/**
 * Build the content-addressed cache key. The hash covers everything that can
 * change the rendered bytes, so distinct styles never collide and identical
 * styles always hit.
 */
function cacheKeyFor(input: Required<GenerateQrInput>): string {
  const style = `${input.data}|${input.format}|${input.fg}|${input.size}`;
  const digest = createHash('sha256').update(style).digest('hex');
  const ext = input.format === 'png' ? 'png' : 'svg';
  return `qr/${digest}.${ext}`;
}

/**
 * Generate (or fetch from cache) a QR code for `data` in the requested style.
 * Always returns the bytes; on a cache miss it renders, writes through to
 * MinIO, and returns the fresh bytes.
 *
 * TODO(logo overlay): an optional centre logo would need `sharp` to composite
 * the PNG (and inline-SVG splicing for the vector path) plus a bump to the QR
 * error-correction level. Deliberately left out — not worth the native dep yet.
 */
export async function generateQr(rawInput: GenerateQrInput): Promise<GeneratedQr> {
  const input: Required<GenerateQrInput> = {
    data: rawInput.data,
    format: rawInput.format,
    fg: rawInput.fg ?? 'mono',
    size: rawInput.size ?? QR_DEFAULT_SIZE,
  };

  // Brand discipline: only preset colours are ever rendered.
  if (!isQrPreset(input.fg)) {
    throw new Error(`Unknown QR colour preset: ${String(input.fg)}`);
  }

  const cacheKey = cacheKeyFor(input);

  const hit = await getObject(cacheKey);
  if (hit) {
    return {
      bytes: hit,
      contentType: CONTENT_TYPE[input.format],
      cacheKey,
      cached: true,
    };
  }

  const fgHex = QR_FG_PRESETS[input.fg];
  const bytes = await render(input, fgHex);

  // Write through to the cache. Best-effort: a storage hiccup shouldn't fail
  // the request when we already hold valid bytes in hand.
  try {
    await putObject(cacheKey, bytes, CONTENT_TYPE[input.format]);
  } catch {
    // swallow — the caller still gets a valid QR code
  }

  return {
    bytes,
    contentType: CONTENT_TYPE[input.format],
    cacheKey,
    cached: false,
  };
}

/** Render the QR bytes for either format using the resolved foreground hex. */
async function render(input: Required<GenerateQrInput>, fgHex: string): Promise<Buffer> {
  const color = { dark: fgHex, light: QR_BG } as const;

  if (input.format === 'png') {
    return QRCode.toBuffer(input.data, {
      type: 'png',
      width: input.size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color,
    });
  }

  const svg = await QRCode.toString(input.data, {
    type: 'svg',
    width: input.size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color,
  });
  return Buffer.from(svg, 'utf8');
}
