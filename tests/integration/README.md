# Integration tests

End-to-end compile matrix for the LaTeX → PDF and LaTeX → DOCX paths.
Runs `xelatex` and `pandoc` on every meaningful fixture from
`tests/_helpers/compileMatrix.ts` and asserts each produces valid output.

## Why this exists

Two gaps the rest of the suite can't close:

**1. "The generated LaTeX is valid"** — unit / property / fuzz tests
under `tests/unit/`, `tests/fuzz/`, and `tests/regressions/` assert
on the **string** that `generator.ts` produces. They never ask the
engine whether that string actually compiles. Most "compiles in dev,
breaks in prod" bugs hide in this gap:

- Mismatched braces from a bad escape combination
- Undefined macros (e.g. the `\setCUI` bug this PR caught and fixed)
- Math-mode-from-text crashes (escaper let a `$` through)
- Package interactions that compile in isolation but fail together
- Unbalanced `\if` / `\fi` (e.g. the business_letter signature-block
  bug this PR caught)

The pairwise compile matrix (`latex-compile.test.ts` +
`docx-compile.test.ts`) closes this gap.

**2. "Both export paths agree on content"** — the PDF and DOCX
paths use entirely separate generators (`generator.ts` for the
SwiftLaTeX template, `flat-generator.ts` for the pandoc-friendly
flat LaTeX). They can drift: PDF emits a field, DOCX silently drops
it. Compile-pass on both doesn't catch this.

The differential test (`differential.test.ts`) closes this gap by
extracting plain text from each output and asserting the user's
input survives in BOTH.

## Running locally

```bash
# All integration tests (770 tests: 760 pairwise + 10 differential).
# Wall time ~5 min on a 4-way pool.
npm run test:integration

# Single doc type (covers all ~19 pairwise rows for that doc type, both paths)
npx vitest run --config vitest.integration.config.ts -t "naval_letter"

# Single fixture by name
npx vitest run --config vitest.integration.config.ts -t "naval_letter:pw#000a"

# Differential test only (~7 s, 10 fixtures)
npx vitest run --config vitest.integration.config.ts tests/integration/differential.test.ts
```

## Prerequisites

| Tool | Required by | Install |
|------|-------------|---------|
| `xelatex` | `latex-compile.test.ts` | macOS: MacTeX or BasicTeX. Linux: `apt install texlive-xetex texlive-latex-extra texlive-fonts-recommended` |
| `pandoc` | `docx-compile.test.ts` | macOS: `brew install pandoc`. Linux: `apt install pandoc` |

If a binary is missing, the corresponding tests skip with a console
warning rather than failing — so a fresh checkout doesn't false-fail.

## Three test files in this directory

| File | What it does | Fixtures | Wall time |
|------|--------------|---------:|----------:|
| `latex-compile.test.ts` | Compiles each pairwise fixture with xelatex; asserts PDF > 1000 bytes | 380 | ~3-4 min |
| `docx-compile.test.ts` | Compiles each pairwise fixture with pandoc; asserts DOCX > 2000 bytes | 380 | ~30 s |
| `differential.test.ts` | For 10 curated fixtures, compiles BOTH paths, extracts text via `pdf-parse` + `mammoth`, asserts a distinctive token appears in BOTH outputs (catches one-path-drops-content bugs) | 10 | ~7 s |

## Architecture

```
compileLatex.ts   ──▶  generateAllLatexFiles(store) ──▶ xelatex ──▶ PDF
compileDocx.ts    ──▶  generateFlatLatex(store)     ──▶ pandoc  ──▶ DOCX
compileMatrix.ts  ──▶  pairwise covering array of 18 dimensions per
                        doc type (~19 rows × 20 doc types = ~380
                        fixtures × 2 paths = ~760 tests)
differential.test ──▶  compile both paths + extract text + assert
                        token-survives-in-both (10 curated fixtures)
```

## When to use which test

- **Adding a new generator-output assertion** → unit/property test under `tests/unit/`. Fast. No toolchain needed.
- **Catching "compiles fine but emits wrong content"** → strengthen the unit/property test on the generator output string.
- **Catching "the generated string isn't valid LaTeX"** → covered automatically by the pairwise compile matrix; no test addition needed unless you've added a new dimension to the matrix.
- **Catching "PDF and DOCX paths drift apart in content"** → add a fixture to `differential.test.ts`.
- **Visual / layout drift** (e.g. a margin moved 3pt, a banner color regressed) → NOT covered here; would need a visual-regression layer with golden PNG diffs (out of scope for this harness).

### Why pairwise (and not full cartesian)?

Full cartesian product of the dimensions we care about (classLevel × 6,
fontSize × 3, fontFamily × 2, pageNumbering × 3, letterheadColor × 2,
signatureType × 2, plus 12 boolean flags) is roughly 5,000+ rows per
doc type × 20 = **100,000+ compiles** — multi-hour even on a 16-way
pool. Empirically, the vast majority of compile regressions are 1-
or 2-flag interactions, and pairwise (Tatsumi/IPOG-style covering
arrays) hits every (dim_a=val_x, dim_b=val_y) pair with ~36 rows
per doc type. Strict superset of "every flag toggled individually"
(the older smoke matrix), at ~3× the size.

The IPOG implementation lives in `tests/_helpers/combinatorial.ts`
and is unit-tested at `combinatorial.test.ts`. `smokeMatrix()` is
still exported from `compileMatrix.ts` if a fast (~260-fixture)
sanity run is wanted locally — invoke it manually by importing.

Each test runs in an isolated temp directory under `/tmp/dondocs-compile-*`
or `/tmp/dondocs-docx-*`. On failure the directory is preserved (CI
uploads them as artifacts under `failing-compile-artifacts`) so devs can:

```bash
cd /tmp/dondocs-compile-AbCdEf
xelatex -interaction=nonstopmode main.tex
# inspect main.log, document.tex, etc.
```

## Why xelatex (not pdflatex)?

SwiftLaTeX in production is a XeTeX fork, so `xelatex` locally is the
closest available engine. A bug that compiles in xelatex but fails in
SwiftLaTeX would still be a SwiftLaTeX quirk worth knowing about — but
the inverse (compiles in SwiftLaTeX, fails in xelatex) is what we mostly
catch here. The `\setCUI` bug that landed this harness is exactly that
shape: SwiftLaTeX silently swallowed the unknown control sequence;
xelatex's strict mode flagged it.

## Adding a new fixture

Most regressions in this repo come from a previously-untested
combination of flags. To add coverage:

1. Identify the (docType, flagSet) combination
2. Edit `tests/_helpers/compileMatrix.ts` and add to `smokeMatrix()`
3. `npm run test:integration -- -t "newFixtureName"`
4. If it fails, the harness shows the parsed `! ...` LaTeX errors and
   the work-dir path

## Why a separate vitest config?

These tests spawn child processes and take 1-2 seconds each. Running
260 of them on every save (the default `npm test` watch loop) would
make TDD untenable. The base `vitest.config.ts` excludes
`tests/integration/**`; this config (`vitest.integration.config.ts`)
explicitly includes only that directory.
