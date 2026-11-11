import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formDefinitionSchema } from '../src/services/forms/model';
import { letterSchema } from '../companion/letterSchema';
import { validateLetter } from '../companion/validateLetter';
import { configSchema } from '../companion/defaults';
import { parseDraftFile } from '../src/lib/draftFile';
import { exampleSession } from '../src/lib/exampleSession';
import { EXAMPLE_DOCUMENTS } from '../src/data/exampleDocuments';
import { DOC_TYPE_CONFIG, FORM_TYPE_LABELS } from '../src/types/document';
import { DOCUMENT_TYPE_GUIDES } from '../src/data/documentGuide';
import { LETTER_TEMPLATES } from '../src/data/templates';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors: string[] = [];
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
function check(label: string, work: () => void) {
  try { work(); } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}
check('form schema', () => {
  const generated = JSON.stringify(z.toJSONSchema(formDefinitionSchema), null, 2) + '\n';
  if (read('docs/form-definition.schema.json') !== generated) throw new Error('stale; regenerate with npm run form-package -- schema docs/form-definition.schema.json');
});

// A scoped repository checker: inline/reference destinations, GitHub-style
// ATX heading slugs and explicit anchors. External sites are not contacted.
function withoutFences(text: string): string {
  let fence: string | undefined;
  return text.split('\n').map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = undefined; return ''; }
    return fence ? '' : line;
  }).join('\n');
}
function headings(text: string): Set<string> {
  const counts = new Map<string, number>();
  const result = new Set<string>();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1].replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1); result.add(base + (count ? `-${count}` : ''));
  }
  for (const match of text.matchAll(/<a\s+(?:name|id)=["']([^"']+)/g)) result.add(match[1]);
  return result;
}
const markdown = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const anchors = new Map<string, Set<string>>();
let links = 0, jsonExamples = 0, requests = 0, drafts = 0;
for (const file of new Set(markdown)) {
  const raw = read(file), text = withoutFences(raw);
  const destinations: string[] = [];
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(/g)) {
    let pos = match.index + match[0].length, depth = 1;
    const start = pos;
    for (; pos < text.length && depth; pos++) {
      if (text[pos] === '\\') { pos++; continue; }
      if (text[pos] === '(') depth++;
      if (text[pos] === ')') depth--;
    }
    if (!depth) destinations.push(text.slice(start, pos - 1).trim());
  }
  for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) destinations.push(match[1]);
  for (let target of destinations) {
    target = target.startsWith('<') ? target.slice(1, target.indexOf('>')) : target.split(/\s+["']/)[0];
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
    links++;
    check(`${file} → ${target}`, () => {
      const hash = target.indexOf('#'), path = hash < 0 ? target : target.slice(0, hash);
      const fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
      const resolved = path ? resolve(root, dirname(file), decodeURIComponent(path.split('?')[0])) : resolve(root, file);
      if (resolved !== resolve(root) && !resolved.startsWith(root)) throw new Error('destination is outside the repository');
      if (!existsSync(resolved)) throw new Error('missing local destination');
      if (fragment && extname(resolved) === '.md') {
        if (!anchors.has(resolved)) anchors.set(resolved, headings(withoutFences(readFileSync(resolved, 'utf8'))));
        if (!anchors.get(resolved)!.has(fragment)) throw new Error('missing heading/anchor');
      }
    });
  }
  for (const match of raw.matchAll(/^```json\s*\n([\s\S]*?)^```/gm)) {
    jsonExamples++;
    check(`${file} JSON example`, () => {
      const value = JSON.parse(match[1]);
      if (file === 'docs/COMPANION.md' && value.docType) validateRequest(value);
      else if (file === 'docs/COMPANION.md' && value.unit && value.signature) configSchema.parse(value);
    });
  }
  if (file === 'docs/COMPANION.md') {
    for (const match of raw.matchAll(/-d '([\s\S]*?)'/g)) check(`${file} curl JSON`, () => validateRequest(JSON.parse(match[1])));
  }
}
function validateRequest(value: unknown) {
  const parsed = letterSchema.parse(value);
  const problems = validateLetter(parsed);
  if (problems.length) throw new Error(problems.join('; '));
  requests++;
}
for (const file of readdirSync(resolve(root, 'docs/examples')).filter(file => file.endsWith('.json'))) {
  check(`docs/examples/${file}`, () => validateRequest(JSON.parse(read(`docs/examples/${file}`))));
}
for (const file of readdirSync(resolve(root, 'public/drafts')).filter(file => file.endsWith('.json'))) {
  check(`public/drafts/${file}`, () => { parseDraftFile(JSON.parse(read(`public/drafts/${file}`))); drafts++; });
}
for (const example of EXAMPLE_DOCUMENTS) check(example.id, () => { parseDraftFile(exampleSession(example)); drafts++; });
for (const type of [...Object.keys(DOC_TYPE_CONFIG), ...Object.keys(FORM_TYPE_LABELS)]) {
  if (!DOCUMENT_TYPE_GUIDES.some(guide => guide.id === type)) errors.push(`No in-app guide for ${type}`);
}
for (const template of LETTER_TEMPLATES) {
  if (!(template.docType in DOC_TYPE_CONFIG)) errors.push(`Unknown template format: ${template.id} → ${template.docType}`);
}
const references = JSON.parse(read('docs/reference-sources.json')) as { references: { file: string; sha256: string }[] };
for (const source of references.references) check(source.file, () => {
  const digest = createHash('sha256').update(readFileSync(resolve(root, 'docs', source.file))).digest('hex');
  if (digest !== source.sha256) throw new Error('PDF differs from reference manifest; review source/edition metadata');
});
if (errors.length) throw new Error(`Documentation checks failed:\n${errors.join('\n')}`);
console.log(`Documentation OK: ${markdown.length} Markdown files, ${links} local links, ${jsonExamples} JSON blocks, ${requests} companion requests, ${drafts} drafts; schema, guide coverage and reference hashes match.`);
