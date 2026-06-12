/**
 * Per-test global setup. Loaded via `vitest.config.ts > test.setupFiles`
 * before each test file's imports run, so any side-effecting top-level
 * imports in the SUT don't blow up on missing globals.
 *
 * The actual storage-shim implementation lives in `./storageShim.ts` so
 * the same code services both the vitest runner (this file) AND the
 * cartesian CLI runner (`tests/cartesian/_globals.ts`).
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { installStorageShim } from './storageShim';

installStorageShim();

// Unmount any component-test trees and reset jsdom between tests so React
// component tests (tests/component/**) don't leak DOM into one another.
// Pure-function tests render nothing, so cleanup() is a no-op for them.
afterEach(() => {
  cleanup();
});
