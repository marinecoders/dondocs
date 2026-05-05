# Full-cartesian compile harness

A streaming CLI runner that compiles **every combination** of every
configuration dimension on every doc type. Per-doc-type cartesian =
**884,736 fixtures**; full = **17.7M fixtures**.

> **Not a per-PR check.** The harness is wired into CI in two
> deliberately non-blocking modes — see "CI integration" below.

## CI integration

`.github/workflows/cartesian.yml` exposes two triggers:

1. **Manual `workflow_dispatch`** — pick a doc type, range, path,
   and fixture limit from the GitHub Actions UI and run a single
   shard up to the 6-hour-per-job cap. Useful for spot-checking a
   specific doc type at scale or chasing a 3-way+ flag interaction
   bug, without having to leave your laptop running for hours.

2. **Nightly `schedule`** (02:00 UTC) — runs a rotating ~50K-fixture
   DOCX-only slice of the full cartesian. DOCX is ~50× faster than
   xelatex, so the slice finishes in ~30-40 min. Over time, the
   rotation covers the full 17.7M-fixture space; if any night
   surfaces a failure, the workflow files an automated issue.

Neither trigger blocks PR CI or runs on push.

## What the cartesian covers

Per doc type, the cartesian product of:

| Dimension | Values | Count |
|---|---|---|
| `classLevel` | unclassified, cui, confidential, secret, top_secret, top_secret_sci | 6 |
| `fontSize` | 10pt, 11pt, 12pt | 3 |
| `fontFamily` | times, courier | 2 |
| `pageNumbering` | none, simple, xofy | 3 |
| `letterheadColor` | blue, black | 2 |
| `signatureType` | none, digital | 2 |
| 12 boolean flags (every combination) | 2¹² | 4096 |

`6 × 3 × 2 × 3 × 2 × 2 × 4096 = 884,736 per doc type` × 20 doc types = **17,694,720 LaTeX fixtures**.

## Timing reality

| Scope | Fixtures | Wall (4-way local) | Wall (16-way) | Wall (64-way) |
|---|---:|---:|---:|---:|
| 1 doc type, full | 884,736 | ~7-8 days | ~2 days | ~12 hours |
| All 20 doc types | 17.7M | ~1.7 years | ~39 days | ~9.7 days |

xelatex is the bottleneck (~3s/fixture). pandoc-only DOCX is ~50× faster.

## Quick checks (no real wait)

```bash
# 1. Verify wiring + count fixtures (no compile, instant)
npm run test:cartesian -- --dry-run

# 2. Same, scoped to one doc type (~30s — generates names)
npm run test:cartesian -- --dry-run --doc-type=naval_letter

# 3. Tiny smoke (50 fixtures, ~30s)
npm run test:cartesian -- --doc-type=naval_letter --limit=50
```

## Real runs

```bash
# Single doc type, first 1000 fixtures (~12 min on 4-way)
npm run test:cartesian -- --doc-type=naval_letter --limit=1000

# Full single doc type (~7-8 days on 4-way)
npm run test:cartesian -- --doc-type=naval_letter

# 1-of-256 shard of full cartesian (~70K fixtures, ~14 hours on 4-way)
npm run test:cartesian -- --shard=1/256

# Full cartesian (17.7M fixtures, ~1.7 years on 4-way — DON'T)
npm run test:cartesian
```

## DOCX-only mode (50× faster)

```bash
# Full naval_letter cartesian on DOCX (~3 hours on 4-way)
npm run test:cartesian -- --doc-type=naval_letter --path=docx
```

DOCX is bound by pandoc, which is much faster than xelatex. Useful for a
quick "does the flat-generator emit anything pandoc rejects" sweep across
the cartesian without waiting days.

## Output

Results stream into `.cartesian-results/<timestamp>.log` and `.csv`. Both
are gitignored. The CSV has one row per fixture (`name,ok,exit,duration_ms,error`)
so you can grep, sort, or load in a spreadsheet.

A failing fixture's tex work directory is preserved at
`/tmp/dondocs-compile-XXXX` (or `/tmp/dondocs-docx-XXXX`) for local repro:

```bash
cd /tmp/dondocs-compile-XXXX
xelatex -interaction=nonstopmode main.tex
# inspect main.log / document.tex / classification.tex
```

## Sharding for distributed runs

The `--shard=N/M` flag splits the offset range into M equal pieces and
runs the Nth piece. Combined with `--doc-type=X`, the shard is scoped
to that doc type's 884,736 rows.

Sharded use case (hypothetical 256-way GitHub Actions matrix):

```yaml
strategy:
  matrix:
    shard: ['1/256', '2/256', ..., '256/256']
steps:
  - run: npm run test:cartesian -- --shard=${{ matrix.shard }}
```

Each shard would handle ~70,000 fixtures (~14 hours on a 4-vCPU runner).
GitHub Actions caps individual jobs at 6 hours, so this won't fit in a
single workflow run — you'd need 3 sequential runs. Practical only for
manually-triggered nightly/weekly runs, not per-PR.

## Reproducing a single failure

Each fixture name encodes its location: `<docType>:cart#<7-digit-hex>`.
Convert hex → decimal and use `--start`/`--end`:

```bash
# naval_letter:cart#0001a3f → offset 0x1a3f = 6719
npm run test:cartesian -- --doc-type=naval_letter --start=6719 --end=6720
```

Or just keep the work dir from the original run — it's printed in the
failure log and CSV.

## Why not vitest?

The cartesian is too big for vitest's `describe.each`:

- 17.7M test names = ~1.7 GB allocated up-front
- Vitest's per-test overhead (~5ms) adds ~24 hours of pure runtime cost
  on top of the actual compile time
- The default reporter would spam millions of lines

A custom Node CLI runner streams via a generator, runs N concurrent
compiles, and reports compactly. The infrastructure shares
`compileFixture()` / `compileDocxFixture()` with the vitest pairwise
suite — only the iteration shell differs.
