/**
 * GET /api/qr — render a QR code for a short URL.
 *
 * Query params:
 *   data    (required) url-encoded http/https URL to encode
 *   format  png | svg   (default png)
 *   fg      preset name (mono|zinc|blue|green|amber, default mono)
 *   size    256 | 512 | 1024 (default 512; coerced to nearest)
 *
 * The full style lives in the query string and the output is content-addressed,
 * so the response is safely immutable + long-cacheable. All inputs are
 * validated: `data` must be a real http(s) URL and colours must be presets —
 * anything else is a 400 (brand discipline; no arbitrary styling).
 *
 * Node runtime: depends on the `qrcode` renderer and the MinIO S3 cache.
 */
import {
  coerceQrSize,
  generateQr,
  isQrPreset,
  type QrFormat,
} from '@/lib/qr';

export const runtime = 'nodejs';

const ONE_YEAR = 60 * 60 * 24 * 365;

function bad(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}

/** Accept only absolute http/https URLs as QR payloads. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const data = searchParams.get('data');
  if (!data || !isHttpUrl(data)) {
    return bad('`data` must be an http(s) URL');
  }

  const formatParam = searchParams.get('format') ?? 'png';
  if (formatParam !== 'png' && formatParam !== 'svg') {
    return bad('`format` must be png or svg');
  }
  const format: QrFormat = formatParam;

  const fgParam = searchParams.get('fg') ?? 'mono';
  if (!isQrPreset(fgParam)) {
    return bad('`fg` must be a known colour preset');
  }

  const sizeRaw = searchParams.get('size');
  const size = coerceQrSize(sizeRaw ? Number(sizeRaw) : undefined);

  let result;
  try {
    result = await generateQr({ data, format, fg: fgParam, size });
  } catch {
    return new Response('Failed to render QR code', {
      status: 500,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  }

  // SVG bytes are utf8 text; PNG bytes are binary. Both ship as immutable.
  const body = format === 'svg' ? result.bytes.toString('utf8') : new Uint8Array(result.bytes);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': `public, max-age=${ONE_YEAR}, immutable`,
      'X-QR-Cache': result.cached ? 'hit' : 'miss',
    },
  });
}
