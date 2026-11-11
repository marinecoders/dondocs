# Full-Cartesian compile harness

[All suites](../README.md) · [Generated fixture inventory](../../docs/PROJECT_INVENTORY.md#compile-fixture-builders)

A streaming CLI enumerates combinations for the matrix's configured formats and drives native PDF (`pdflatex`) or Word (system Pandoc) helpers. It is not a per-PR check. The exact size is generated from the builder, rather than copied into multiple guides.

## What the Cartesian covers

| Dimension | Values | Count |
|---|---|---:|
| Classification | Unclassified, CUI, Confidential, Secret, Top Secret, TS/SCI | 6 |
| Font size | 10 pt, 11 pt, 12 pt | 3 |
| Font family | Times, Courier | 2 |
| Page numbering | None, simple, X of Y | 3 |
| Letterhead color | Blue, black | 2 |
| Signature type | None, digital | 2 |
| Boolean flags | All combinations of 12 flags | 4,096 |

`6 × 3 × 2 × 3 × 2 × 2 × 4,096 = 1,769,472` fixtures per matrix format. Multiply by the current matrix-format count in the [inventory](../../docs/PROJECT_INVENTORY.md). SL-4, TM/IETM and forms have dedicated tests outside this generic matrix. Internal conversion checks do not imply an advertised Word export for PDF-only formats.

## Bounded checks

Even a dry run enumerates fixtures: **bound it** for a quick wiring check.

```sh
npm run test:cartesian -- --dry-run --doc-type=naval_letter --limit=1
npm run test:cartesian -- --doc-type=naval_letter --limit=50
npm run test:cartesian -- --doc-type=naval_letter --path=docx --limit=50
```

Runtime varies greatly by host, content and path. Measure a small representative slice before selecting a long run. Do not extrapolate the former guide's speed ratios or multi-day totals as a current guarantee.

## Ranges and sharding

```sh
# First 1,000 fixtures in one format:
npm run test:cartesian -- --doc-type=naval_letter --start=0 --end=1000
# A bounded part of a distributed shard:
npm run test:cartesian -- --shard=1/256 --limit=1000
```

`--shard=N/M` splits the selected offset space into M pieces; combining it with `--doc-type` scopes that space to one format. `--parallel=N` controls concurrency. GitHub Actions has per-job runtime limits; choose explicit bounds that fit them. An unbounded `npm run test:cartesian` is intentionally expensive and does not belong in normal contributor checks.

## CI integration and coverage limit

`.github/workflows/cartesian.yml` supports manual dispatch with a selected format/range/path/limit and a nonblocking scheduled DOCX slice at 02:00 UTC. Failures can produce an automated issue. These jobs do not run on PRs/pushes.

The current nightly calculation uses **day-of-year × 50,000** offsets and resets each January. With the current larger matrix it does **not** traverse the full space annually or guarantee eventual full coverage: later offsets are not reached by that schedule. Use explicit manual ranges/shards for those offsets. Changing the scheduler is separate from documenting its current coverage; do not interpret a green nightly slice as a complete Cartesian pass.

## Results and failure reproduction

Results stream to ignored `.cartesian-results/<timestamp>.log` and `.csv`. Each CSV row records fixture name, success, exit status, duration and error. Failed work directories are retained under `/tmp/dondocs-compile-*` or `/tmp/dondocs-docx-*`.

```sh
cd /tmp/dondocs-compile-XXXX
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

A fixture name is `<docType>:cart#<7-digit-hex>`. Convert its hexadecimal offset to decimal and select a one-row interval:

```sh
# naval_letter:cart#0001a3f → offset 6719
npm run test:cartesian -- --doc-type=naval_letter --start=6719 --end=6720
```

## Why a streaming CLI

Vitest's `describe.each` would allocate/report millions of cases before compilation. This harness streams fixtures with bounded concurrency and shares `compileFixture()` / `compileDocxFixture()` with integration tests. Use the ordinary pairwise/focused suites for fast feedback and bounded Cartesian slices for additional interaction coverage.
