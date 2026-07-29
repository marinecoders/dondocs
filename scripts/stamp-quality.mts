// Stamp each config form's field-landing rate into public/templates/index.json
// (the same fill-smoke measure as `form-coverage`, persisted). The catalog
// reads it to warn on forms whose fields largely don't land where declared —
// so a Marine is never handed a badly-detected form as if it were fine.
// Run: `npm run stamp-quality`. Requires poppler (pdftotext).
import { renderFormPdf } from '../src/services/pdf/genericFormRenderer';
import { assertFormConfig } from '../src/types/formConfig';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'public/templates');
const INDEX = join(TEMPLATES, 'index.json');
const loader = async (dir: string, page: string) =>
  new Uint8Array(readFileSync(join(TEMPLATES, dir, page)));
const token = (n: number) =>
  String.fromCharCode(65 + Math.floor(n / 676), 65 + (Math.floor(n / 26) % 26), 65 + (n % 26));

const index = JSON.parse(readFileSync(INDEX, 'utf-8')) as {
  templates: Array<{ directory: string; config?: boolean; fieldLanding?: number }>;
};

let stamped = 0;
for (const entry of index.templates) {
  if (!entry.config) continue;
  const cfgPath = join(TEMPLATES, entry.directory, 'form.json');
  let cfg;
  try {
    cfg = assertFormConfig(JSON.parse(readFileSync(cfgPath, 'utf8')), entry.directory);
  } catch {
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
    entry.fieldLanding = 100; // nothing text-ish to place → nothing to get wrong
    stamped++;
    continue;
  }
  let bytes: Uint8Array;
  try {
    bytes = await renderFormPdf(cfg, values, {}, loader);
  } catch {
    entry.fieldLanding = 0;
    stamped++;
    continue;
  }
  const pdf = join(mkdtempSync(join(tmpdir(), 'q-')), 'o.pdf');
  writeFileSync(pdf, bytes);
  const pageText: string[] = [];
  for (let pg = 1; pg <= cfg.pages.length; pg++) {
    pageText[pg] = spawnSync('pdftotext', ['-f', String(pg), '-l', String(pg), pdf, '-'], {
      encoding: 'utf-8',
    }).stdout;
  }
  let landed = 0;
  for (const [t, page] of Object.entries(declared)) if ((pageText[page] ?? '').includes(t)) landed++;
  entry.fieldLanding = Math.round((landed / n) * 100);
  stamped++;
}

writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
const low = index.templates.filter((t) => t.config && (t.fieldLanding ?? 100) < 50).length;
console.log(`stamped fieldLanding on ${stamped} forms | flagged low-quality (<50%): ${low}`);
