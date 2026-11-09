import { readFile, writeFile } from 'node:fs/promises';
import { resolveCapabilities, type CapabilityRequest, type CapabilitySubject } from '../src/lib/documentCapabilities';
import { documentOutputConfig } from '../src/lib/documentOutputConfig';
import { DOC_TYPE_CONFIG, DOC_TYPE_LABELS, FORM_TYPE_LABELS } from '../src/types/document';

const columns: [string, CapabilityRequest][] = [
  ['PDF', { operation: 'export', target: 'pdf' }],
  ['Word', { operation: 'export', target: 'docx' }],
  ['TeX fragments', { operation: 'export', target: 'tex' }],
  ['Flat TeX', { operation: 'export', target: 'tex', texMode: 'flat' }],
  ['Preview', { operation: 'preview', target: 'pdf' }],
  ['Batch PDF', { operation: 'batch', target: 'pdf' }],
  ['Share link', { operation: 'share', target: 'link' }],
];
const lines = [
  '# Output capabilities', '',
  'Generated from `resolveCapabilities` and `documentOutputConfig`. Update with `npm run docs:capabilities`; CI checks for drift.', '',
  'These statuses describe available operations. They do not certify regulatory compliance, completed content, engine readiness, or valid template geometry. Both document modes have the same export availability.', '',
  '| Document | ' + columns.map(([label]) => label).join(' | ') + ' |',
  '|---|' + columns.map(() => '---|').join(''),
];
function addRow(label: string, subject: CapabilitySubject) {
  const statuses = columns.map(([, request]) => resolveCapabilities(subject, request).status);
  const customStatuses = columns.map(([, request]) => resolveCapabilities({ ...subject, documentMode: 'custom' }, request).status);
  if (statuses.some((status, index) => status !== customStatuses[index])) {
    throw new Error(`Document modes differ in availability; document both modes: ${label}`);
  }
  if (statuses.some(status => status === 'invalid-data' || status === 'not-ready')) {
    throw new Error(`Invalid capability documentation example: ${label}`);
  }
  lines.push('| ' + label + ' | ' + statuses.join(' | ') + ' |');
}
for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
  addRow(DOC_TYPE_LABELS[docType] ?? docType, { kind: 'correspondence', docType, documentMode: 'compliant' });
}
for (const [formType, label] of Object.entries(FORM_TYPE_LABELS)) {
  addRow(label, { kind: 'builtin-form', formType, documentMode: 'compliant' });
}
// A synthetic checksum-bearing definition illustrates availability; no PDF is loaded or certified.
addRow('Configured form (valid definition loaded)', {
  kind: 'configured-form', formType: 'capability_example', documentMode: 'compliant',
  definition: { status: 'loaded', definition: {
    schemaVersion: 2, formId: 'capability_example', label: 'Capability example',
    definitionRevision: '1', templateRevision: '1', directory: 'capability_example',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: '0'.repeat(64) }],
    fields: { name: { kind: 'text', label: 'Name' } },
    placements: [{ fieldId: 'name', appearance: 'text', page: 1, box: { left: 72, top: 720, width: 200, height: 18 } }],
    sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {},
  } },
});
lines.push('', '## Partial operations and readiness', '',
  '- Word omits uploaded signature/figure images, merged PDF pages, and PDF signing fields. Reference link annotations require PDF. Word and PDF use separate layout engines; pagination can differ.',
  '- Normal TeX downloads contain configuration fragments, including distribution and copy-to content. They need templates and assets to form a standalone project. Flat TeX is the Pandoc input dialect.',
  '- Share links include text and form values, not attachment bytes or signature images. Configured forms also require the selected PDF template.',
  '- Configured forms must load a valid, matching definition with a SHA-256 checksum for every template page before preview, PDF export, or sharing. Missing definitions report not-ready; invalid definitions report invalid-data. Configured-form batch export is unavailable.', '',
  '## Correspondence content controls', '',
  'Each cell lists **numbered paragraphs / formal references / formal enclosures**. These flags come from the same configuration used by the editor and renderers.', '',
  '| Document | Compliant mode | Custom mode |', '|---|---|---|');
for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
  const flags = (mode: 'compliant' | 'custom') => {
    const c = documentOutputConfig(docType, mode).compliance;
    return [c.numberedParagraphs, c.allowReferences, c.allowEnclosures].map(value => value ? 'yes' : 'no').join(' / ');
  };
  lines.push(`| ${DOC_TYPE_LABELS[docType] ?? docType} | ${flags('compliant')} | ${flags('custom')} |`);
}
const content = lines.join('\n') + '\n';
const path = new URL('../docs/CAPABILITIES.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== content) throw new Error('Capability documentation is stale. Run npm run docs:capabilities.');
  console.log('Capability documentation matches the runtime configuration.');
} else {
  await writeFile(path, content);
}
