/**
 * Tiny in-process counters for the hot path. When Redis is down we still
 * redirect (§10) but lose the click; we bump `lostClicks` so the loss is
 * observable rather than silent.
 */
export const metrics = {
  lostClicks: 0,
  redirectErrors: 0,
};

export function recordLostClick(): void {
  metrics.lostClicks += 1;
  // Surfaced in container logs; aggregate via your log pipeline.
  if (metrics.lostClicks % 100 === 1) {
    console.warn(`[redirect] lost ${metrics.lostClicks} click event(s) — analytics enqueue failing`);
  }
}
