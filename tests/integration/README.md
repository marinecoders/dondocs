# Integration tests

[All suites](../README.md) · [Generated fixture inventory](../../docs/PROJECT_INVENTORY.md)

The separate integration suite compiles real PDF/Word output, measures layout/content and drives the local companion over HTTP/MCP. The pairwise matrix is one part of the suite; publication, form, storage/output-policy and companion tests also have focused files here.

## Running locally

```sh
npm run test:integration
# Narrow to files when testing a specific contract:
npm run test:integration -- tests/integration/subparagraph-spacing.test.ts tests/integration/docx-subparagraph-spacing.test.ts
# A document-type or exact pairwise fixture name (four-digit hexadecimal suffix):
npx vitest run --config vitest.integration.config.ts -t 'naval_letter:pw#000a'
# Differential content checks:
npm run test:integration -- tests/integration/differential.test.ts
```

Runtime depends on the selected files, fixtures, toolchain and parallelism; old whole-suite timing/count estimates are not a current budget. Both `npm test` and `npm run test:watch` exclude this directory.

## Prerequisites

| Tool | Used for | Example installation |
|---|---|---|
| `pdflatex` and required TeX packages/fonts | Native PDF compile and layout checks | MacTeX/TeX Live; Linux: `texlive-latex-base texlive-latex-extra texlive-fonts-recommended` (consult CI for additional packages). |
| `pandoc` | Native Word conversion | macOS: `brew install pandoc`; Linux: `apt install pandoc`. |
| Poppler `pdftotext` and `pdfinfo` | Rendered text, coordinates and page counts | macOS: `brew install poppler`; Linux: `apt install poppler-utils`. |
| npm dependencies / staged assets | Companion, packaged-engine and JS output readers | `npm ci`; normal build/vendor staging as required by the selected test. |

Toolchain probes differ by file. Some mark affected cases skipped locally; dedicated requirements/CI setup ensure required tools are present. Inspect the actual skip summary. A skipped case is not proof that rendering passed. System Pandoc can differ from the browser's vendored WASM version.

## The compile matrix

| File | Contract |
|---|---|
| `latex-compile.test.ts` | `pairwiseMatrix()` through native `pdflatex`; valid, nonempty PDF. |
| `docx-compile.test.ts` | The same builder through system Pandoc; valid, nonempty DOCX. |
| `differential.test.ts` | Curated PDF/Word pairs; extracted input tokens survive both paths. |

The [generated inventory](../../docs/PROJECT_INVENTORY.md#compile-fixture-builders) gives exact current format, pairwise, smoke and Cartesian counts. The generic builder currently omits SL-4 and TM/IETM; their dedicated files cover their structured profiles. Internal generator coverage does not advertise a Word UI/API for PDF-only publication families. See [product capabilities](../../docs/CAPABILITIES.md).

```text
compileLatex.ts  → captured TestStore → generated TeX → pdflatex → PDF
compileDocx.ts   → captured TestStore → flat TeX      → pandoc   → DOCX
compileMatrix.ts → baselines / pairwise dimensions / streamed Cartesian offsets
```

## Engine choice

Production correspondence/publication PDF uses the SwiftLaTeX **pdfTeX** WASM build. Native `pdflatex` shares its font/input model more closely than XeTeX; production is not a XeTeX fork. Native compilation still does not reproduce every packaged-engine behavior, so existing WASM/companion/browser tests remain useful.

On failure, preserve the printed `/tmp/dondocs-compile-*` or `/tmp/dondocs-docx-*` directory and inspect its generated files/log. To reproduce native PDF:

```sh
cd /tmp/dondocs-compile-AbCdEf
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

CI retains failed compile directories as artifacts. Check logs for sensitive content before posting them publicly.

## Adding coverage

- Change a pairwise dimension/baseline in `tests/_helpers/compileMatrix.ts` when adding a supported flag/format; integration compile files consume `pairwiseMatrix()`.
- Add a focused regression for a specific failing combination, or a curated fixture in `differential.test.ts` when content disappears in one path.
- Adding only to `smokeMatrix()` does **not** add an integration test. That builder is available for explicit local use, not consumed by the pairwise suites.
- Layout checks already measure baselines, margins, wrapping, page furniture and labels in dedicated tests. Use a rendered assertion for the affected behavior; compile success alone does not establish visual correctness.
- Regenerate `npm run docs:inventory` after builder changes. The full [Cartesian harness](../cartesian/README.md) is separate and far larger than a PR check.

For companion coverage, see `companion-*.test.ts`: request/transport parity, PDF/Word behavior, publication preflight, tool/resources, host protocol revisions, defaults, output confinement, timeouts and stdout hygiene. Consult each file for its specific prerequisites.
