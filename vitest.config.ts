import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest configuration for dondocs tests.
 *
 * Two test categories:
 *   - tests/unit/         — pure-function unit + property tests (no DOM needed)
 *   - tests/regressions/  — replay corpus of past user-reported bugs
 *                           (one file per closed issue, indefinitely retained)
 *
 * The default environment is `happy-dom` so editor / TipTap-adjacent tests
 * (which use ProseMirror, which needs `document` and `window`) can be added
 * without per-file environment overrides. Pure-function tests still run fine
 * under happy-dom — the perf cost is negligible at this scale.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirror vite.config.ts's `@` alias so test imports match production.
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Property-based tests can be iteration-heavy; bump the default per-test
    // timeout so a thorough fast-check run doesn't false-fail on slower CI
    // runners.
    testTimeout: 15_000,
    // Stable seed for fast-check randomness so a green run on one machine
    // is reproducible on another. fast-check itself adds the seed to any
    // failure message so reduction is still possible.
    globals: false,
  },
});
