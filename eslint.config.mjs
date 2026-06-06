import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/migrations/**',
      '**/*.config.{js,mjs,cjs}',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // tsc (noUnusedLocals/Parameters) already enforces unused; allow _-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // We use `as unknown as T` in a few low-level spots (globalThis caches,
      // ioredis custom commands); never bare `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Worker, scripts, and DB migrator legitimately log to the console.
    files: ['apps/worker/**', 'scripts/**', 'packages/db/src/migrate.ts'],
    rules: { 'no-console': 'off' },
  },
);
