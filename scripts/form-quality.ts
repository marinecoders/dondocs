import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { compileFormDefinition, type AnswerField, type Answers, type FormDefinition, type Placement } from '../src/services/forms/model';
import { renderForm } from '../src/services/forms/render';

export interface PlacementReport { tested: number; matched: number; signaturePlacements: number; negativeTested: number; failures: string[]; method: 'rendered-bounds'; independentlyReviewed: false }
export function decodeXmlText(text: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (entity, name: string) => {
    if (!name.startsWith('#')) return entities[name];
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}
export async function measurePlacements(definition: FormDefinition, directory: string, previews = false): Promise<PlacementReport> {
  const d = compileFormDefinition(definition);
  const report: PlacementReport = { tested: 0, matched: 0, signaturePlacements: 0, negativeTested: 0, failures: [], method: 'rendered-bounds', independentlyReviewed: false };
  const loader = async (_dir: string, file: string) => {
    const bytes = readFileSync(join(directory, file));
    const expected = d.pages.find(p => p.file === file);
    if (createHash('sha256').update(bytes).digest('hex') !== expected?.sha256) throw new Error(`Checksum mismatch: ${file}`);
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1 || Math.abs(pdf.getPage(0).getWidth() - expected.width) > 0.1 || Math.abs(pdf.getPage(0).getHeight() - expected.height) > 0.1) throw new Error(`Template dimensions mismatch: ${file}`);
    return new Uint8Array(bytes);
  };
  let sampleIndex = 0;
  const sample = (f: AnswerField, iteration: number) => {
    if (f.options) return f.kind === 'multipleChoice' ? [f.options[iteration % f.options.length].id] : f.options[iteration % f.options.length].id;
    if (f.kind === 'boolean') return iteration % 2 === 0;
    if (f.kind === 'date') return `2026-01-${String(1 + sampleIndex++ % 28).padStart(2, '0')}`;
    if (f.kind === 'decimal') return String(++sampleIndex);
    return `A${(sampleIndex++).toString(36).padStart(2, '0')}`;
  };
  const allFields = [...Object.values(d.fields), ...Object.values(d.rowGroups).flatMap(g => Object.values(g.columns))];
  const iterations = Math.max(2, ...allFields.map(f => f.options?.length ?? 0));
  const temp = mkdtempSync(join(tmpdir(), 'form-quality-'));
  const extract = (pdf: string) => {
    const output = spawnSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
    if (output.status !== 0) throw new Error(output.stderr || 'pdftotext is required');
    return [...output.stdout.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/g)].map(match => [...match[1].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g)].map(w => ({ left: +w[1], top: +w[2], right: +w[3], bottom: +w[4], text: decodeXmlText(w[5]) })));
  };
  try {
    const blank = await renderForm({ definition: d, answers: {}, rows: {}, answerRevision: 0 }, 'preview', loader);
    const blankPath = join(temp, 'blank.pdf');
    writeFileSync(blankPath, blank.bytes);
    const baseline = extract(blankPath);
    const wordKey = (word: (typeof baseline)[number][number]) => `${word.text}:${word.left.toFixed(2)}:${word.top.toFixed(2)}`;
    const baselineKeys = baseline.map(page => new Set(page.map(wordKey)));
    for (let iteration = 0; iteration <= iterations; iteration++) {
      sampleIndex = 0;

      const fill = (fields: Record<string, AnswerField>): Answers => iteration === iterations ? {} : Object.fromEntries(Object.entries(fields).filter(([, f]) => f.kind !== 'signature').map(([key, f]) => [key, sample(f, iteration)]));
      const answers = fill(d.fields);
      const rows = Object.fromEntries(Object.entries(d.rowGroups).map(([key, g]) => [key, g.rows.map((_, i) => ({ id: `${key}_${i}`, answers: fill(g.columns) }))]));
      const rendered = await renderForm({ definition: d, answers, rows, answerRevision: 0 }, 'preview', loader);
      report.failures.push(...rendered.diagnostics.map(i => `${i.path}: ${i.message}`));
      const pdf = join(temp, 'filled.pdf');
      writeFileSync(pdf, rendered.bytes);
      if (previews) writeFileSync(join(directory, `review-fill-${iteration + 1}.pdf`), rendered.bytes);
      const pages = extract(pdf);
      const check = (p: Placement, field: AnswerField, values: Answers, path: string) => {
        if (field.kind === 'signature') { if (iteration === 0) report.signaturePlacements++; return; }
        const answer = values[p.fieldId];
        const unselected = p.optionId && (Array.isArray(answer) ? !answer.includes(p.optionId) : answer !== p.optionId);
        const absent = answer === undefined || unselected || (p.appearance === 'mark' && answer === false);
        report.tested++;
        const b = p.box;
        const top = d.pages[p.page - 1].height - b.top;
        const words = (pages[p.page - 1] ?? []).filter(w => !baselineKeys[p.page - 1]?.has(wordKey(w))).filter(w => w.left >= b.left - 1 && w.right <= b.left + b.width + 1 && w.top >= top - 1 && w.bottom <= top + b.height + 1);
        if (absent) {
          report.negativeTested++;
          if (!words.length) report.matched++;
          else report.failures.push(`${path}: unselected or cleared answer added text on page ${p.page}`);
          return;
        }
        const expected = p.appearance === 'mark' ? 'X' : field.options ? (Array.isArray(answer) ? answer : [answer]).map(v => field.options!.find(o => o.id === v)?.label ?? '').join(', ') : typeof answer === 'boolean' ? answer ? 'Yes' : 'No' : String(answer);
        let target = expected;
        if (field.kind === 'date' && p.dateFormat && p.dateFormat !== 'iso') {
          const [y, m, day] = expected.split('-'); target = p.dateFormat === 'mdy' ? `${m}/${day}/${y}` : `${day}/${m}/${y}`;
        }
        if (words.map(w => w.text).join(' ').includes(target)) report.matched++;
        else report.failures.push(`${path}: expected value is not contained by its box on page ${p.page}`);
      };
      d.placements.forEach((p, i) => check(p, d.fields[p.fieldId], answers, `placements.${i}`));
      for (const [key, g] of Object.entries(d.rowGroups)) g.rows.forEach((placements, i) => placements.forEach((p, j) => check(p, g.columns[p.fieldId], rows[key][i].answers, `${key}.${i}.${j}`)));
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
  report.failures = [...new Set(report.failures)];
  return report;
}
