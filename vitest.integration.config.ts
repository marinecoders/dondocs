import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

/**
 * Vitest config for the integration suite (LaTeX + DOCX compile matrix).
 *
 * Standalone (NOT mergeConfig) — vitest's mergeConfig appends arrays
 * like `include` rather than overriding, which loaded the entire unit
 * suite alongside integration tests. We duplicate the relevant base
 * settings (alias, define, environment) to keep this config independent.
 *
 * Why a separate config:
 *   - Each test spawns `xelatex` or `pandoc` and waits 1-3 seconds — too
 *     slow for the default suite.
 *   - Higher per-test timeout (60s) for cold xelatex starts.
 *   - Coverage is meaningless here (we're testing external binaries).
 *
 * Run with: `npm run test:integration` (locally) or via the
 * `compile-matrix` job in CI (which installs xelatex + pandoc first).
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00Z'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // happy-dom isn't strictly needed (no DOM-touching code in the
    // integration tests), but the same setup file expects it. Cheaper
    // to keep than to fork a no-environment setup.
    environment: 'happy-dom',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/_helpers/setup.ts'],
    testTimeout: 60_000,
    pool: 'threads',
    // 4 parallel compile processes — fast enough to finish in a few
    // minutes, slow enough not to OOM a 4GB CI runner.
    maxConcurrency: 4,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
