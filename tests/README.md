# Tests

Run with `npm test` (one-shot) or `npm run test:watch` (watcher).

```
tests/
├── unit/           pure-function unit + property tests (fast-check)
├── regressions/    one file per closed user-reported issue
├── component/      React components
├── fuzz/           generated inputs against the generators
├── combinatorial/  the pairwise matrix builder, unit-tested
├── cartesian/      the full-matrix harness (`run.ts`, its own workflow, not a vitest suite)
├── integration/    compiles real documents and drives the companion end to end
└── _helpers/       fixtures shared across the suites
```

`npm test` runs everything but `integration/`. That suite compiles with the
real toolchain and drives the companion over HTTP and MCP; run it with
`npm run test:integration` after installing xelatex, pandoc and poppler
(`pdftotext`). Where a tool is missing the affected cases skip locally and
fail in CI, so a dropped dependency cannot turn into a green run.

## Layout philosophy

Three concentric kinds of tests, from cheapest-to-write to most-permanent:

1. **Property tests** (`tests/unit/*.property.test.ts`). Specify
   invariants that must hold for any input; let `fast-check` hunt
   for inputs that violate them. Catches **classes** of bugs
   (crashes on weird input, dropped content, infinite loops)
   without us having to enumerate the inputs.

2. **Canonical cases** (`tests/unit/*.cases.test.ts`). Hand-authored
   input → expected-output tables for the formats we contractually
   support (SECNAV labels, hanging indent, etc.). When a property
   fails, the case file gives us a human-readable diff to anchor on.

3. **Regression corpus** (`tests/regressions/`). One file per
   closed bug, named after the issue number. Tiny, deliberately
   redundant with the property suite. Even if a future refactor
   weakens a property test, the corpus prevents the **specific
   bug** from sneaking back in. See `regressions/README.md` for
   the workflow.

## When you find a new bug

1. Add a new file in `tests/regressions/issue-NNN-slug.test.ts`.
2. If the bug is an instance of a broader pattern, also tighten the
   relevant property test in `tests/unit/`.
3. Fix the bug.
4. Both new test cases pass on the fixed code (and would fail on
   the broken code — verify by reverting the fix locally).
