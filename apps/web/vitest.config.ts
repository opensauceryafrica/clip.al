import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` path alias. Scoped to `@/` so it never matches
    // `@clipal/*` workspace package specifiers.
    alias: [{ find: /^@\/(.*)/, replacement: resolve(root, '$1') }],
  },
});
