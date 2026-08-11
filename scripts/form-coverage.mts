// Fill-smoke coverage: render every committed config form with a unique short
// token in each text field, then check (via pdftotext) that each token lands
// on its declared page. Off-page boxes and mis-detected table geometry surface
// mechanically instead of by hand — the safety net for a large auto-harvested
// catalog. Run: `npm run form-coverage`. Requires poppler (pdftotext).
import { renderFormPdf } from '../src/services/pdf/genericFormRenderer';
import { assertFormConfig, type FormConfig } from '../src/types/formConfig';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'public/templates');
const loader = async (dir: string, page: string) =>
  new Uint8Array(readFileSync(join(TEMPLATES, dir, page)));

// Short, unique, tiny-box-friendly tokens: AAA, AAB, … (base-26).
const token = (n: number) =>
  String.fromCharCode(65 + Math.floor(n / 676), 65 + (Math.floor(n / 26) % 26), 65 + (n % 26));

type Row = { id: string; textFields: number; landed: number; offPage: number };
const rows: Row[] = [];

for (const dir of readdirSync(TEMPLATES)) {
  const p = join(TEMPLATES, dir, 'form.json');
  if (!existsSync(p)) continue;
  let cfg: FormConfig;
  try {
    cfg = assertFormConfig(JSON.parse(readFileSync(p, 'utf8')), dir);
  } catch {
    rows.push({ id: dir, textFields: -1, landed: 0, offPage: 0 });
    continue;
  }
  const values: Record<string, string> = {};
  const declared: Record<string, number> = {};
  let n = 0;
  for (const [key, f] of Object.entries(cfg.fields)) {
    if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'signature') continue;
    const t = token(n++);
    values[key] = t;
    declared[t] = f.page;
  }
  if (n === 0) {
    rows.push({ id: dir, textFields: 0, landed: 0, offPage: 0 });
    continue;
  }
  let bytes: Uint8Array;
  try {
    bytes = await renderFormPdf(cfg, values, {}, loader);
  } catch {
    rows.push({ id: dir, textFields: n, landed: 0, offPage: -1 });
    continue;
  }
  const pdf = join(mkdtempSync(join(tmpdir(), 'cov-')), 'o.pdf');
  writeFileSync(pdf, bytes);
  const pageText: string[] = [];
  for (let pg = 1; pg <= cfg.pages.length; pg++) {
    pageText[pg] = spawnSync('pdftotext', ['-f', String(pg), '-l', String(pg), pdf, '-'], {
      encoding: 'utf-8',
    }).stdout;
  }
  let landed = 0;
  let offPage = 0;
  for (const [t, page] of Object.entries(declared)) {
    if ((pageText[page] ?? '').includes(t)) landed++;
    else if (pageText.some((txt) => (txt ?? '').includes(t))) offPage++;
  }
  rows.push({ id: dir, textFields: n, landed, offPage });
}

const scored = rows.filter((r) => r.textFields > 0);
const totalFields = scored.reduce((s, r) => s + r.textFields, 0);
const totalLanded = scored.reduce((s, r) => s + r.landed, 0);
const totalOffPage = scored.reduce((s, r) => s + r.offPage, 0);
const crashed = rows.filter((r) => r.offPage === -1).length;
const invalid = rows.filter((r) => r.textFields === -1).length;

console.log(`forms rendered: ${scored.length} | invalid: ${invalid} | render-crashed: ${crashed}`);
console.log(`corpus field-landing: ${totalLanded}/${totalFields} (${Math.round((totalLanded / totalFields) * 100)}%)`);
console.log(`fields drawn on the WRONG page (real bug): ${totalOffPage}`);
console.log(`\nworst 20 forms by landing rate (text fields >= 5):`);
scored
  .filter((r) => r.textFields >= 5)
  .map((r) => ({ ...r, rate: r.landed / r.textFields }))
  .sort((a, b) => a.rate - b.rate)
  .slice(0, 20)
  .forEach((r) =>
    console.log(`  ${Math.round(r.rate * 100).toString().padStart(3)}%  ${r.landed}/${r.textFields}  off:${r.offPage}  ${r.id.slice(0, 52)}`)
  );

// Non-zero exit if anything crashed or is invalid — those are always bugs.
process.exit(crashed + invalid > 0 ? 1 : 0);
