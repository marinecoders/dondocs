import { measurePlacements } from './form-quality';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, cpSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { adaptLegacyForm, compileFormDefinition, type FormDefinition } from '../src/services/forms/model';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); renameSync(temp, path);
};
export function packageFolder(root: string, folder: string): string {
  const base = realpathSync(root);
  const path = resolve(base, folder);
  if (dirname(path) !== base || (existsSync(path) && realpathSync(path) !== path) || existsSync(join(path, 'boxes.json'))) throw new Error('Expected an unprotected source folder directly under templates');
  const protectedRow = read(join(root, 'index.json')).templates.some((row: { id: string; builtin?: boolean; sourceDirectory?: string; directory: string }) =>
    (row.builtin || ['navmc10274', 'navmc11811'].includes(row.id)) && resolve(base, row.sourceDirectory ?? row.directory) === path);
  if (protectedRow) throw new Error('Built-in form is protected from publication');
  return path;
}

function stableFields(d: FormDefinition): FormDefinition {
  const mapping = new Map<string, string>();
  const fields: FormDefinition['fields'] = {};
  for (const [key, field] of Object.entries(d.fields)) {
    const stable = field.sourceIds?.length ? `field_${hash(JSON.stringify(field.sourceIds)).slice(0, 24)}` : key;
    const previous = fields[stable];
    if (previous && JSON.stringify({ ...previous, legacyKeys: undefined }) !== JSON.stringify({ ...field, legacyKeys: undefined })) throw new Error(`Ambiguous source mapping: ${key}`);
    fields[stable] = previous ? { ...field, legacyKeys: [...new Set([...(previous.legacyKeys ?? []), ...(field.legacyKeys ?? [])])] } : field;
    mapping.set(key, stable);
  }
  const rowGroups: FormDefinition['rowGroups'] = {};
  for (const [key, group] of Object.entries(d.rowGroups)) {
    const columns: typeof group.columns = {};
    const columnIds = new Map<string, string>();
    for (const [columnKey, column] of Object.entries(group.columns)) {
      const stable = column.sourceIds?.length ? `column_${hash(JSON.stringify([...column.sourceIds].sort())).slice(0, 24)}` : columnKey;
      if (columns[stable]) throw new Error(`Ambiguous source column: ${columnKey}`);
      columnIds.set(columnKey, stable); columns[stable] = column;
    }
    const stable = `rows_${hash(JSON.stringify([...columnIds.values()].sort())).slice(0, 24)}`;
    if (rowGroups[stable]) throw new Error(`Ambiguous source table: ${key}`);
    rowGroups[stable] = { ...group, columns, rows: group.rows.map(row => row.map(p => ({ ...p, fieldId: columnIds.get(p.fieldId)! }))) };
  }
  const seen = new Set<string>();
  return { ...d, fields, rowGroups, placements: d.placements.map(p => ({ ...p, fieldId: mapping.get(p.fieldId)! })), sections: d.sections.map(s => ({ ...s, fields: s.fields.map(key => mapping.get(key)!).filter(key => { if (seen.has(key)) return false; seen.add(key); return true; }) })) };
}

export async function preparePackage(root: string, folder: string): Promise<FormDefinition> {
  const dir = packageFolder(root, folder);
  const draft = read(join(dir, 'form.draft.json'));
  const filenames: string[] = draft.schemaVersion === 2 ? draft.pages.map((p: { file: string }) => p.file) : draft.pages;
  const pages = await Promise.all(filenames.map(async file => {
    if (!/^[A-Za-z0-9_.-]+\.pdf$/.test(file)) throw new Error('Invalid template filename');
    const bytes = readFileSync(join(dir, file));
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw new Error(`${file} must contain one page`);
    return { file, sha256: hash(bytes), width: pdf.getPage(0).getWidth(), height: pdf.getPage(0).getHeight() };
  }));
  let d = draft.schemaVersion === 2 ? compileFormDefinition(draft) : stableFields(adaptLegacyForm(draft, pages));
  d = { ...d, directory: folder, pages, templateRevision: hash(JSON.stringify(pages)), definitionRevision: 'candidate' };
  d = compileFormDefinition(d);
  const evidencePath = join(dir, 'extraction.json');
  if (!existsSync(evidencePath)) throw new Error('Missing extraction provenance');
  const evidence = read(evidencePath);
  if (!evidence.sourceSha256 || !Array.isArray(evidence.diagnostics)) throw new Error('Invalid extraction provenance');
  const changes = packageChanges(root, d);
  const acceptance = await measurePlacements(d, dir, true);
  write(join(dir, 'placement-report.json'), acceptance);
  write(join(dir, 'form.candidate.json'), d);
  write(join(dir, 'changes.json'), changes);
  // Prior reviewed definitions and assets are never rewritten by extraction.
  return d;
}

function packageChanges(root: string, d: FormDefinition) {
  const index = read(join(root, 'index.json'));
  const row = index.templates.find((r: { id: string }) => r.id === d.formId);
  if (!row) throw new Error('Register the source before preparing it');
  const previousPath = join(root, row.directory, 'form.json');
  const previous = existsSync(previousPath) ? read(previousPath) : null;
  const changes = { previousRevision: previous?.definitionRevision ?? null, added: [] as string[], removed: [] as string[], changed: [] as string[], geometryChanged: false, rowsChanged: false };
  if (previous?.schemaVersion === 2) {
    for (const key of Object.keys(d.fields)) {
      if (!previous.fields[key]) changes.added.push(key);
      else if (JSON.stringify(previous.fields[key]) !== JSON.stringify(d.fields[key])) changes.changed.push(key);
    }
    changes.removed = Object.keys(previous.fields).filter(key => !d.fields[key]);
    changes.geometryChanged = JSON.stringify(previous.placements) !== JSON.stringify(d.placements);
    changes.rowsChanged = JSON.stringify(previous.rowGroups) !== JSON.stringify(d.rowGroups);
  } else changes.added = Object.keys(d.fields);
  return changes;
}

function candidate(root: string, folder: string) {
  const dir = packageFolder(root, folder);
  const d = compileFormDefinition(read(join(dir, 'form.candidate.json')));
  if (d.directory !== folder) throw new Error('Candidate directory must match its source folder');
  const row = read(join(root, 'index.json')).templates.find((r: { sourceDirectory?: string; directory: string }) => (r.sourceDirectory ?? r.directory) === folder);
  if (row?.id !== d.formId) throw new Error('Candidate form ID must match its catalog entry');
  const evidence = read(join(dir, 'extraction.json'));
  const changes = read(join(dir, 'changes.json'));
  const placementReport = read(join(dir, 'placement-report.json'));
  for (const page of d.pages) if (hash(readFileSync(join(dir, page.file))) !== page.sha256) throw new Error('Template changed after preparation; prepare again');
  return { dir, d, evidence, changes, placementReport, candidateDigest: hash(JSON.stringify({ d, evidence, changes, placementReport })) };
}

export async function checkPackage(root: string, folder: string): Promise<void> {
  const current = candidate(root, folder);
  write(join(current.dir, 'placement-report.json'), await measurePlacements(current.d, current.dir, true));
  write(join(current.dir, 'changes.json'), packageChanges(root, current.d));
}

export async function reviewPackage(root: string, folder: string, reviewer: string, notes: string, acceptWarnings: boolean): Promise<void> {
  if (!reviewer.trim() || !notes.trim()) throw new Error('Review requires a reviewer and placement/behavior notes');
  await checkPackage(root, folder);
  const { dir, evidence, placementReport, candidateDigest } = candidate(root, folder);
  if (!placementReport.tested || placementReport.failures.length) throw new Error('Resolve placement-check failures before review');
  if (evidence.diagnostics.some((d: { severity: string }) => d.severity === 'error')) throw new Error('Resolve extraction errors before review');
  if (evidence.diagnostics.length && !acceptWarnings) throw new Error('Review must explicitly accept extraction warnings');
  write(join(dir, 'review.json'), { status: 'reviewed', candidateDigest, reviewer, notes, acceptedWarnings: acceptWarnings, reviewedAt: new Date().toISOString() });
}

export function publishPackage(root: string, folder: string, scripts: string): string {
  const { dir, d, candidateDigest, evidence, changes, placementReport } = candidate(root, folder);
  const review = read(join(dir, 'review.json'));
  if (review.status !== 'reviewed' || review.candidateDigest !== candidateDigest) throw new Error('Candidate has not been reviewed, or changed after review');
  const revision = candidateDigest;
  const directory = `${folder}/revisions/${revision}`;
  const published = compileFormDefinition({ ...d, directory, definitionRevision: revision });
  const destination = join(root, directory);
  if (!existsSync(destination)) {
    const temp = `${destination}.${process.pid}.tmp`;
    mkdirSync(temp, { recursive: true });
    for (const page of d.pages) cpSync(join(dir, page.file), join(temp, page.file));
    write(join(temp, 'form.json'), published);
    write(join(temp, 'review.json'), review);
    write(join(temp, 'extraction.json'), evidence);
    write(join(temp, 'changes.json'), changes);
    write(join(temp, 'placement-report.json'), placementReport);
    renameSync(temp, destination);
  } else {
    const expected = { 'form.json': published, 'review.json': review, 'extraction.json': evidence, 'changes.json': changes, 'placement-report.json': placementReport };
    for (const [file, value] of Object.entries(expected)) if (JSON.stringify(read(join(destination, file))) !== JSON.stringify(value)) throw new Error('Published revision is immutable');
    for (const page of d.pages) if (hash(readFileSync(join(destination, page.file))) !== page.sha256) throw new Error('Published template bytes changed');
  }
  const result = spawnSync('python3', [join(scripts, 'index_json.py'), '--compare-patch', join(root, 'index.json')], { input: JSON.stringify({ expected: { [folder]: changes.previousRevision }, rows: { [folder]: { directory, sourceDirectory: folder, config: true, renderer: 'generic', status: 'published', verified: true, definitionRevision: revision, templateRevision: d.templateRevision, pages: d.pages.map(p => p.file) } } }), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Catalog publication failed');
  return directory;
}

export function retirePackage(root: string, folder: string, scripts: string): void {
  packageFolder(root, folder);
  const row = read(join(root, 'index.json')).templates.find((r: { directory: string; sourceDirectory?: string }) => (r.sourceDirectory ?? r.directory) === folder);
  if (!row || row.status !== 'published') throw new Error('Expected a published form');
  const result = spawnSync('python3', [join(scripts, 'index_json.py'), '--patch', join(root, 'index.json')], { input: JSON.stringify({ [folder]: { status: 'retired' } }), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Catalog retirement failed');
}
