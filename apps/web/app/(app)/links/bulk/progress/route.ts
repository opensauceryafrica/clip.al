import { keys, redis } from '@clipal/cache';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Snapshot emitted to the client on each tick. */
interface Progress {
  total: number;
  done: number;
  ok: number;
  failed: number;
  status: string;
}

function parseProgress(h: Record<string, string>): Progress {
  return {
    total: Number(h['total'] ?? 0),
    done: Number(h['done'] ?? 0),
    ok: Number(h['ok'] ?? 0),
    failed: Number(h['failed'] ?? 0),
    status: h['status'] ?? 'running',
  };
}

/**
 * SSE progress for a bulk CSV import (§8/AC7). Polls the `bulk:progress:<id>`
 * hash (written by the worker bulk-import loop) and streams `progress` events
 * until `status === 'done'` (or the row count is fully accounted for), then ends.
 *
 * Ownership: the import is bound to the caller via the audit row at enqueue time;
 * the progress hash itself is anonymous, so we additionally require the live
 * session here (`requireUser`) before opening the stream. The `importId` is an
 * unguessable UUID, so a leaked id is the only exposure vector and it carries no
 * PII (just counts).
 */
export async function GET(req: Request): Promise<Response> {
  await requireUser();

  const importId = new URL(req.url).searchParams.get('importId');
  if (!importId) {
    return new Response('missing importId', { status: 400 });
  }

  const key = keys.bulkProgress(importId);

  // Guard against a typo'd / expired id: no hash → nothing to stream.
  const exists = await redis.exists(key);
  if (!exists) {
    return new Response('unknown import', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // End the stream if the client disconnects.
      req.signal.addEventListener('abort', close);

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const MAX_TICKS = 20 * 60; // ~20 min ceiling at 1s/tick
      for (let tick = 0; tick < MAX_TICKS && !closed; tick++) {
        const h = (await redis.hgetall(key).catch(() => ({}))) as Record<string, string>;
        if (Object.keys(h).length === 0) {
          // Hash expired out from under us — treat as finished.
          send('done', { status: 'done' });
          break;
        }

        const p = parseProgress(h);
        send('progress', p);

        const finished = p.status === 'done' || (p.total > 0 && p.done >= p.total);
        if (finished) {
          send('done', p);
          break;
        }

        await new Promise((r) => setTimeout(r, 1000));
      }

      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
