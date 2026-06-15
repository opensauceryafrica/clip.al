import { can, resolvePlan } from '@clipal/billing';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  apiError,
  authFailureResponse,
  replayIdempotent,
  storeIdempotent,
  validate,
} from '@/lib/api-response';
import { coerceQrSize, generateQr, isQrPreset, QR_FG_PRESETS } from '@/lib/qr';

/**
 * POST /api/v1/qr  (links:read)
 *
 * Render a brand-disciplined QR code for an http(s) URL. The QR feature is
 * plan-gated (`qr` capability). Unlike the public `/api/qr` GET (which returns
 * raw image bytes), this returns the bytes inline as a base64 data payload so it
 * fits the JSON error-envelope contract and supports `Idempotency-Key` replay.
 */
export const runtime = 'nodejs';

const qrSchema = z
  .object({
    data: z
      .string()
      .url()
      .refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Must be an http(s) URL.'),
    format: z.enum(['png', 'svg']).default('png'),
    fg: z
      .string()
      .refine(isQrPreset, `Must be one of: ${Object.keys(QR_FG_PRESETS).join(', ')}.`)
      .default('mono'),
    size: z.number().int().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, 'links:read');
  if (!auth.ok) return authFailureResponse(auth);

  const idempotencyKey = request.headers.get('idempotency-key');
  const replay = await replayIdempotent(auth.user.id, idempotencyKey);
  if (replay) return replay;

  const plan = await resolvePlan(auth.user.id);
  if (!can(plan, 'qr')) {
    return apiError('plan_required', 'QR generation is not available on your plan.', { plan });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError('invalid_request', 'Request body must be valid JSON.');
  }
  const parsed = validate(qrSchema, json);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  let result;
  try {
    result = await generateQr({
      data: input.data,
      format: input.format,
      // `isQrPreset` already narrowed via the zod refine; cast is safe here.
      fg: input.fg as keyof typeof QR_FG_PRESETS,
      size: coerceQrSize(input.size),
    });
  } catch {
    return apiError('invalid_request', 'Failed to render the QR code.');
  }

  const body = JSON.stringify({
    format: input.format,
    contentType: result.contentType,
    encoding: 'base64',
    image: result.bytes.toString('base64'),
  });
  const response = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  return storeIdempotent(auth.user.id, idempotencyKey, response);
}
