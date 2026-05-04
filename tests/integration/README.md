# Integration tests

End-to-end compile matrix for the LaTeX → PDF and LaTeX → DOCX paths.
Runs `xelatex` and `pandoc` on every meaningful fixture from
`tests/_helpers/compileMatrix.ts` and asserts each produces valid output.

## Why this exists

The unit / property / fuzz tests under `tests/unit/`, `tests/fuzz/`, and
`tests/regressions/` all assert on the **string** that `generator.ts`
produces — they never ask the engine whether that string actually compiles.
Most "compiles in dev, breaks in prod" bugs hide in that gap:

- Mismatched braces from a bad escape combination
- Undefined macros (e.g. the `\setCUI` bug this PR caught and fixed)
- Math-mode-from-text crashes (escaper let a `$` through)
- Package interactions that compile in isolation but fail together

## Running locally

```bash
# All integration tests (LaTeX + DOCX). ~6-10 min on a 4-way pool.
npm run test:integration

# Single doc type
npx vitest run --config vitest.integration.config.ts -t "naval_letter"

# Single fixture
npx vitest run --config vitest.integration.config.ts -t "naval_letter:cui"
```

## Prerequisites

| Tool | Required by | Install |
|------|-------------|---------|
| `xelatex` | `latex-compile.test.ts` | macOS: MacTeX or BasicTeX. Linux: `apt install texlive-xetex texlive-latex-extra texlive-fonts-recommended` |
| `pandoc` | `docx-compile.test.ts` | macOS: `brew install pandoc`. Linux: `apt install pandoc` |

If a binary is missing, the corresponding tests skip with a console
warning rather than failing — so a fresh checkout doesn't false-fail.

## Architecture

```
compileLatex.ts  ──▶  generateAllLatexFiles(store) ──▶ xelatex ──▶ PDF
compileDocx.ts   ──▶  generateFlatLatex(store)     ──▶ pandoc  ──▶ DOCX
compileMatrix.ts ──▶  fixtures: 20 doc types × ~13 flag variants ≈ 260
```

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
