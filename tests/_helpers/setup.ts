/**
 * Per-test global setup. Loaded via `vitest.config.ts > test.setupFiles`
 * before each test file's imports run, so any side-effecting top-level
 * imports in the SUT don't blow up on missing globals.
 *
 * The actual storage-shim implementation lives in `./storageShim.ts` so
 * the same code services both the vitest runner (this file) AND the
 * cartesian CLI runner (`tests/cartesian/_globals.ts`).
 */
import { installStorageShim } from './storageShim';

installStorageShim();
