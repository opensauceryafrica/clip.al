import { createServer, type Server } from 'node:http';

/** Shared worker state, surfaced by the health endpoint and updated by loops. */
export const workerState = {
  startedAt: Date.now(),
  lastClickBatchAt: 0,
  processedClicks: 0,
};

/**
 * Minimal HTTP health endpoint so the worker container has a healthcheck
 * (docker-compose hits :9090/health). Liveness only — 200 while the process runs.
 */
export function startHealthServer(port = 9090): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptimeMs: Date.now() - workerState.startedAt,
          processedClicks: workerState.processedClicks,
          lastClickBatchAt: workerState.lastClickBatchAt,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => console.log(`[health] listening on :${port}`));
  return server;
}
