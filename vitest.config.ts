import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

// Mirror the Vite-injected globals from vite.config.ts so test files that
// import modules consuming them (e.g. anything that transitively imports
// `src/lib/version.ts`, which is most of `src/lib/`) don't crash with
// `__APP_VERSION__ is not defined`. Values are static for tests — git SHA
// and build time aren't meaningful in a test run.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

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
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00Z'),
  },
  resolve: {
    alias: {
      // Mirror vite.config.ts's `@` alias so test imports match production.
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/_helpers/setup.ts'],
    // Property-based tests can be iteration-heavy; bump the default per-test
    // timeout so a thorough fast-check run doesn't false-fail on slower CI
    // runners.
    testTimeout: 15_000,
    // Stable seed for fast-check randomness so a green run on one machine
    // is reproducible on another. fast-check itself adds the seed to any
    // failure message so reduction is still possible.
    globals: false,
    coverage: {
      provider: 'v8',
      // Whole-source thresholds. Set just below the current numbers
      // (Statements 9.21%, Branches 7.87%, Functions 7.15%, Lines 9.54%)
      // so a future PR can't accidentally drop coverage by removing tests
      // — even one test file going missing fails the gate. Bump these
      // upward as the suite grows.
      thresholds: {
        statements: 9,
        branches: 7,
        functions: 7,
        lines: 9,
      },
      // Report on the whole src/ surface, not just imported files. That
      // way the threshold reflects the actual proportion of the codebase
      // under test, and "I added a new module" → "I owe a test" is
      // visible in the percent rather than masked by averaging only over
      // already-tested files.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Exclude generated / static / type-only / config files.
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
