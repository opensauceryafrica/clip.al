/**
 * Tiny interval scheduler. Runs a job immediately and then every `ms`, never
 * overlapping a slow run, and never letting a job error kill the process.
 */
export function every(name: string, ms: number, job: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      console.error(`[${name}] error`, err);
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, ms);
}
