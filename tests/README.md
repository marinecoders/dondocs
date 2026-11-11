# Tests

Run with `npm test` (one-shot) or `npm run test:watch` (watcher).

```
tests/
├── unit/           pure-function unit + property tests (fast-check)
├── regressions/    focused checks for previously corrected behavior
├── component/      React components
├── fuzz/           generated inputs against the generators
├── combinatorial/  the pairwise matrix builder, unit-tested
├── cartesian/      the full-matrix harness (`run.ts`, its own workflow, not a vitest suite)
├── integration/    compiles real documents and drives the companion end to end
├── browser/        Playwright app, upgrade and managed-release tests
└── _helpers/       fixtures shared across the suites
```

`npm test` runs Vitest `.test.ts` and `.test.tsx` files outside `integration/`.
The integration suite compiles with the real toolchain and drives the companion
over HTTP and MCP; run it with
`npm run test:integration` after installing native pdfTeX (`pdflatex`), Pandoc and Poppler
(`pdftotext`, `pdfinfo`). Some cases skip locally when tools are missing;
others have explicit requirements. CI installs the required toolchain. Inspect
the skip summary and see [integration prerequisites](integration/README.md#prerequisites).

Browser checks run separately from Vitest. See [browser/README.md](browser/README.md)
for suite coverage, commands and native-device verification checks.

## Layout philosophy

Three common test patterns:

1. **Property tests** (`tests/unit/*.property.test.ts`). Specify
   invariants that must hold for any input; let `fast-check` hunt
   for inputs that violate them. Catches **classes** of bugs
   (crashes on weird input, dropped content, infinite loops)
   without us having to enumerate the inputs.

2. **Canonical cases** (`tests/unit/*.cases.test.ts`). Hand-authored
   input → expected-output tables for supported formats
   (SECNAV labels, hanging indent, etc.). When a property
   fails, the case file gives us a human-readable diff to anchor on.

3. **Regression cases** (`tests/regressions/`). Small reproductions
   with descriptive names and issue/PR references where appropriate.
   They preserve specific behavior through later changes. See
   [regression guidance](regressions/README.md) for placement and naming.

## When you find a new bug

1. Add or update a focused test in the appropriate suite; follow the
   regression guide when adding a case to `tests/regressions/`.
2. If the bug is an instance of a broader pattern, also tighten the
   relevant property test in `tests/unit/`.
3. Fix the bug.
4. Verify the relevant checks pass after the fix and detect the original
   behavior. Use an isolated checkout when comparing revisions.

Documentation and form-import checks are separate: `npm run docs:check` validates generated contracts/examples/links, and `for test in scripts/test-*.py; do python3 "$test" || exit 1; done` runs Python pipeline tests. See [contributor setup](../docs/CONTRIBUTING.md#testing) and the [generated fixture inventory](../docs/PROJECT_INVENTORY.md).
