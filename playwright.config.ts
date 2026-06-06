import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for critical flows only. Requires the stack running and reachable at
 * PLAYWRIGHT_BASE_URL (default http://localhost:3000). Run: `pnpm test:e2e`
 * (after `pnpm exec playwright install chromium`). Not part of `pnpm test`/CI.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
