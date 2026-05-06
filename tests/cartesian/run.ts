/**
 * Streaming CLI runner for the full LaTeX/DOCX compile cartesian.
 *
 * Why not vitest: the cartesian is 17.7M rows. Vitest enumerates every
 * `describe.each` row up-front, allocating ~100 bytes/test name = ~1.7GB
 * just for names before any test runs. It also reports per-test progress
 * which would be unreadable. So we drive it with a plain Node script that:
 *
 *   - streams fixtures lazily via `cartesianGenerator()`
 *   - runs N compiles concurrently with simple back-pressure
 *   - reports progress every ~100 fixtures
 *   - logs each failure (truncated) to stdout + appends to a summary file
 *   - exits non-zero if any failed
 *
 * Usage (run via `npm run test:cartesian -- <args>`):
 *
 *   --doc-type=naval_letter        only one doc type (~884K fixtures)
 *   --start=0 --end=1000           offset slice within the chosen scope
 *   --shard=N/M                    1-of-M shard, M-shard split
 *   --limit=N                      stop after N fixtures (debug)
 *   --parallel=N                   concurrency (default: 4 — max useful on
 *                                  most machines for xelatex; pandoc-only
 *                                  benefits from higher)
 *   --path=latex|docx|both         which compile path (default: latex)
 *   --bail                         stop on first failure (default: continue)
 *   --dry-run                      generate names only; don't compile
 *
 * Examples:
 *
 *   # Just confirm the harness wiring + count fixtures
 *   npm run test:cartesian -- --dry-run
 *
 *   # Tiny smoke (1000 fixtures of naval_letter, ~50 min on 4-way local)
 *   npm run test:cartesian -- --doc-type=naval_letter --limit=1000
 *
 *   # Full naval_letter cartesian (884K fixtures, ~7-8 days on 4-way)
 *   npm run test:cartesian -- --doc-type=naval_letter
 *
 *   # 1-of-256 shard of full cartesian (~70K fixtures)
 *   npm run test:cartesian -- --shard=1/256
 *
 *   # Full cartesian (17.7M fixtures, ~1.7 years on 4-way; only feasible
 *   # against a massive cloud-distributed shard scheme)
 *   npm run test:cartesian
 */
// MUST be the first import — sets the localStorage / sessionStorage
// shims and other env stubs that `src/lib/debug.ts` (transitively
// imported by `compileLatex.ts`) needs at module-init time.
import './_globals';

import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cartesianGenerator,
  CARTESIAN_PER_DOCTYPE,
  CARTESIAN_TOTAL,
  ALL_DOC_TYPES,
} from '../_helpers/compileMatrix';
import { compileFixture, type CompileResult, type TestStore } from '../_helpers/compileLatex';
import { compileDocxFixture, type DocxCompileResult } from '../_helpers/compileDocx';
import { resolveRange as resolveRangeImpl } from './range';

interface Args {
  docType?: string;
  start?: number;
  end?: number;
  shard?: { n: number; m: number };
  limit?: number;
  parallel: number;
  path: 'latex' | 'docx' | 'both';
  bail: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    parallel: 4,
    path: 'latex',
    bail: false,
    dryRun: false,
  };
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val = ''] = m;
    switch (key) {
      case 'doc-type': args.docType = val; break;
      case 'start': args.start = Number(val); break;
      case 'end': args.end = Number(val); break;
      case 'shard': {
        const sm = val.match(/^(\d+)\/(\d+)$/);
        if (!sm) throw new Error(`bad --shard format: ${val} (expected N/M)`);
        args.shard = { n: Number(sm[1]), m: Number(sm[2]) };
        if (args.shard.n < 1 || args.shard.n > args.shard.m) {
          throw new Error(`shard ${args.shard.n}/${args.shard.m} out of range`);
        }
        break;
      }
      case 'limit': args.limit = Number(val); break;
      case 'parallel': args.parallel = Number(val); break;
      case 'path':
        if (val !== 'latex' && val !== 'docx' && val !== 'both') {
          throw new Error(`bad --path: ${val} (latex | docx | both)`);
        }
        args.path = val;
        break;
      case 'bail': args.bail = true; break;
      case 'dry-run': args.dryRun = true; break;
      default: throw new Error(`unknown flag: --${key}`);
    }
  }
  return args;
}

/**
 * Thin wrapper that injects the cartesian universe sizes into the pure
 * `resolveRange` from `./range.ts`. Range math is property-tested
 * separately at `tests/unit/cartesianRange.property.test.ts`.
 */
function resolveRange(args: Args): { start: number; end: number; total: number } {
  return resolveRangeImpl(args, {
    perDocType: CARTESIAN_PER_DOCTYPE,
    total: CARTESIAN_TOTAL,
  });
}

interface Outcome {
  name: string;
  ok: boolean;
  /** xelatex / pandoc exit code, -1 if spawn failed. */
  exitCode: number | null;
  /** First parsed `! ...` LaTeX error (or pandoc log first line). */
  errorSummary?: string;
  /** Path to /tmp/dondocs-compile-XXXX, kept on failure. */
  workDir?: string;
  durationMs: number;
}

// Output-size floors. Matches the integration suite's per-fixture
// assertions (latex-compile.test.ts uses `> 1000` for PDF, docx-compile
// .test.ts uses `> 2000` for DOCX). These guards catch the rare path
// where the engine exits 0 + the file is on disk but the content is
// degenerate (truncated PDF header, empty DOCX zip, etc.). xelatex
// almost never produces such output, but the same harness now matches
// the integration suite's strictness for free.
const MIN_PDF_BYTES = 1000;
const MIN_DOCX_BYTES = 2000;

async function compileOne(
  store: TestStore,
  path: 'latex' | 'docx' | 'both'
): Promise<{ ok: boolean; exitCode: number | null; errorSummary?: string; workDir?: string }> {
  if (path === 'latex' || path === 'both') {
    const r: CompileResult = await compileFixture(store);
    if (!r.ok) {
      return {
        ok: false,
        exitCode: r.exitCode,
        errorSummary: r.errors[0]?.split('\n')[0] ?? r.logTail.split('\n').slice(-1)[0],
        workDir: r.workDir,
      };
    }
    // Defensive: exit 0 + PDF on disk but tiny — treat as failure.
    const pdfSize = r.pdfBytes?.byteLength ?? 0;
    if (pdfSize <= MIN_PDF_BYTES) {
      return {
        ok: false,
        exitCode: r.exitCode,
        errorSummary: `xelatex exit 0 but PDF is suspiciously small (${pdfSize} bytes ≤ ${MIN_PDF_BYTES})`,
        workDir: r.workDir,
      };
    }
    if (path === 'latex') return { ok: true, exitCode: 0, workDir: r.workDir };
  }
  if (path === 'docx' || path === 'both') {
    const r: DocxCompileResult = await compileDocxFixture(store);
    if (!r.ok) {
      return {
        ok: false,
        exitCode: r.exitCode,
        errorSummary: r.log.split('\n').filter((l) => l.trim()).slice(-1)[0],
        workDir: r.workDir,
      };
    }
    // Same defensive size floor for DOCX.
    const docxSize = r.docxBytes?.byteLength ?? 0;
    if (docxSize <= MIN_DOCX_BYTES) {
      return {
        ok: false,
        exitCode: r.exitCode,
        errorSummary: `pandoc exit 0 but DOCX is suspiciously small (${docxSize} bytes ≤ ${MIN_DOCX_BYTES})`,
        workDir: r.workDir,
      };
    }
  }
  return { ok: true, exitCode: 0 };
}

/**
 * Stream fixtures through up to `concurrency` in-flight compiles.
 * Calls `onResult` for each as it finishes (in arbitrary order).
 * Resolves once the iterator is drained AND every in-flight compile
 * has settled.
 */
async function runConcurrent<T>(
  iter: Iterable<T>,
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const it = iter[Symbol.iterator]();
  const inFlight = new Set<Promise<void>>();

  const startNext = (): Promise<void> | null => {
    const next = it.next();
    if (next.done) return null;
    const p = worker(next.value).finally(() => { inFlight.delete(p); });
    inFlight.add(p);
    return p;
  };

  for (let i = 0; i < concurrency; i++) {
    if (!startNext()) break;
  }

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    while (inFlight.size < concurrency) {
      if (!startNext()) break;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.docType && !ALL_DOC_TYPES.includes(args.docType as never)) {
    throw new Error(`--doc-type=${args.docType} not in ALL_DOC_TYPES`);
  }

  const { start, end, total } = resolveRange(args);

  // Banner: tell the user exactly what they're about to do.
  console.log('═'.repeat(70));
  console.log(`Cartesian compile run`);
  console.log(`  Scope:       ${args.docType ?? 'ALL doc types'}`);
  console.log(`  Path:        ${args.path}`);
  console.log(`  Range:       [${start}, ${end})  →  ${total.toLocaleString()} fixtures`);
  console.log(`  Parallelism: ${args.parallel}`);
  if (args.shard) console.log(`  Shard:       ${args.shard.n} / ${args.shard.m}`);
  if (args.limit !== undefined) console.log(`  Limit:       ${args.limit}`);
  if (args.bail) console.log(`  Stop on first failure: yes`);

  // Estimate wall time so the user knows what they're committing to.
  const perFixSec = args.path === 'docx' ? 0.06 : args.path === 'both' ? 3.06 : 3;
  const wallSec = Math.ceil((total * perFixSec) / args.parallel);
  console.log(`  Est. wall:   ${formatDuration(wallSec)} (assuming ~${perFixSec}s avg)`);
  console.log('═'.repeat(70));

  if (args.dryRun) {
    console.log('Dry run — generating names only, no compile.');
    let count = 0;
    for (const fixture of cartesianGenerator(args.docType as never, start, end)) {
      if (count < 3 || count >= total - 3) {
        console.log(`  ${fixture.name}`);
      } else if (count === 3 && total > 6) {
        console.log(`  ... ${total - 6} more ...`);
      }
      count++;
    }
    console.log(`Generated ${count.toLocaleString()} fixture names.`);
    return;
  }

  // Output: results stream to .cartesian-results-<timestamp>.{log,csv}.
  const outDir = '.cartesian-results';
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(outDir, `${stamp}.log`);
  const csvPath = join(outDir, `${stamp}.csv`);
  await writeFile(csvPath, 'name,ok,exit,duration_ms,error\n');
  console.log(`Logging to ${logPath} and ${csvPath}`);
  console.log('');

  let done = 0;
  let passed = 0;
  let failed = 0;
  const failures: Outcome[] = [];
  const t0 = Date.now();
  let bailFlag = false;

  await runConcurrent(
    cartesianGenerator(args.docType as never, start, end),
    args.parallel,
    async (fixture) => {
      if (bailFlag) return;
      const fixStart = Date.now();
      try {
        const r = await compileOne(fixture.store, args.path);
        const durationMs = Date.now() - fixStart;
        const outcome: Outcome = {
          name: fixture.name,
          ok: r.ok,
          exitCode: r.exitCode,
          errorSummary: r.errorSummary,
          workDir: r.workDir,
          durationMs,
        };

        // CSV row (escape commas in error summary)
        const csvErr = (r.errorSummary ?? '').replace(/[",\n]/g, ' ');
        await appendFile(
          csvPath,
          `${fixture.name},${r.ok ? 1 : 0},${r.exitCode ?? ''},${durationMs},${csvErr}\n`
        );

        if (r.ok) {
          passed++;
        } else {
          failed++;
          failures.push(outcome);
          await appendFile(
            logPath,
            `${fixture.name}\n  exit ${r.exitCode}\n  ${r.errorSummary ?? '(no error summary)'}\n  workDir: ${r.workDir ?? '(none)'}\n\n`
          );
          if (args.bail) {
            bailFlag = true;
            return;
          }
        }
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        failures.push({
          name: fixture.name,
          ok: false,
          exitCode: -1,
          errorSummary: `harness threw: ${message}`,
          durationMs: Date.now() - fixStart,
        });
        await appendFile(logPath, `${fixture.name}\n  HARNESS THREW: ${message}\n\n`);
      } finally {
        done++;

        // Progress every 100 fixtures.
        if (done % 100 === 0 || done === total) {
          const elapsed = (Date.now() - t0) / 1000;
          const rate = done / elapsed;
          const remaining = total - done;
          const eta = rate > 0 ? Math.ceil(remaining / rate) : 0;
          process.stdout.write(
            `[${done.toLocaleString()}/${total.toLocaleString()}] ` +
            `✓${passed.toLocaleString()} ✗${failed} ` +
            `${rate.toFixed(1)}/s ETA ${formatDuration(eta)}\r`
          );
        }
      }
    }
  );

  console.log(''); // newline after progress carriage-return

  const elapsedSec = (Date.now() - t0) / 1000;
  console.log('═'.repeat(70));
  console.log(`Done in ${formatDuration(Math.ceil(elapsedSec))}.`);
  console.log(`  Total:   ${done.toLocaleString()}`);
  console.log(`  Passed:  ${passed.toLocaleString()}`);
  console.log(`  Failed:  ${failed.toLocaleString()}`);
  if (failed > 0) {
    console.log('');
    console.log(`First ${Math.min(10, failures.length)} failures:`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.name}`);
      console.log(`    exit ${f.exitCode}  →  ${f.errorSummary ?? '(no error)'}`);
    }
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more (see ${logPath})`);
    }
  }
  console.log('═'.repeat(70));
  console.log(`CSV: ${csvPath}`);
  console.log(`Log: ${logPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
}

main().catch((e: unknown) => {
  console.error('Fatal:', e instanceof Error ? e.stack : e);
  process.exit(2);
});
