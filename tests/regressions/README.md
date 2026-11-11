# Regression tests

This directory holds focused checks for behavior that has been corrected. Keep each case small enough that a later failure shows which behavior changed. Tests run with the normal Vitest suite.

## Run

From the repository root after `npm ci`:

```sh
npm test -- tests/regressions
npm test -- tests/regressions/enclosure-number-agreement.test.ts
```

`npm test` and `npm run test:coverage` include these files. The [Vitest config](../../vitest.config.ts) matches `.test.ts` and `.test.tsx`, using `happy-dom` by default. Integration and Playwright tests have separate runners; see the [test guide](../README.md) and [browser guide](../browser/README.md).

## Add or revise a case

1. Reduce the input and sequence of actions to the smallest useful reproduction. Use synthetic document data and deterministic values.
2. Assert the expected behavior at the appropriate boundary: stored values, generated content, rendered output or user interaction. Prefer an observable result over a snapshot of implementation details.
3. Confirm the case fails for the relevant behavior before the fix and passes afterward when practical. Use an isolated checkout or worktree to compare revisions without disturbing current work.
4. Explain what the test protects in a short comment. Link a public issue or PR when available and appropriate.
5. Run the focused case and the related tests for the changed code.

Use `short-behavior-name.test.ts`, or `.test.tsx` for React cases. Existing `issue-NNN-...` and `pr-NNN-...` names retain their traceability; those prefixes are optional for new cases. Follow nearby fixtures and cleanup patterns, including restoring mocks/timers and resetting stores or browser storage.

A unit, component, integration or browser test may be the better home for a reproduction. Avoid adding a duplicate here solely to label it a regression. PDF/Word layout changes should have rendered-output checks in the [integration suite](../integration/README.md); broader input invariants may also warrant a property test.

## Test data and reports

Keep credentials, real document contents, personal information, CUI and classified information out of fixtures, comments, screenshots and logs. Keep private report details private and follow [SECURITY.md](../../SECURITY.md) for vulnerability reporting. The [contribution guide](../../docs/CONTRIBUTING.md#before-posting) covers public examples and submissions.

Retain a useful regression check when refactoring. Consolidate or move it only when equivalent behavioral coverage remains, and explain that change in the PR.
