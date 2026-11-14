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
  'This matrix describes operations in the browser app. For the separate local service, see the [companion guide](COMPANION.md).', '',
  '## Reading the matrix', '',
  '| Status | Meaning |', '|---|---|',
  '| supported | The operation is available for this format. Rendering and document checks still apply. |',
  '| partial | The operation is available with the omissions or additional resources described below. |',
  '| unsupported | The operation is unavailable for this format. |',
  '| not-ready | A required form definition has not loaded successfully. |',
  '| invalid-data | The request, document type, mode or form definition is invalid or mismatched. |', '',
  'The table uses recognized document types and a valid loaded definition for the configured-form example. It therefore shows supported, partial or unsupported, rather than transient load or validation states.', '',
  'Compliant and Custom are application modes. Both have the same operation availability; their letter and memorandum content controls differ in the final table. Neither mode certifies regulatory compliance.', '',
  '## Available operations', '',
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
  '- Word omits uploaded signature/figure images, merged PDF pages, and PDF signing fields. Reference titles with safe URLs remain linked in Word; the hyperlink checkbox controls PDF links separately. Word and PDF use separate layout engines; pagination can differ.',
  '- Normal TeX downloads contain configuration fragments, including distribution and copy-to content. They need templates and assets to form a standalone project. Flat TeX is the Pandoc input dialect.',
  '- Share links transfer a draft snapshot, including retained fields that may not appear in the current rendered format. They omit attachment bytes and signature images. Configured forms also require the selected PDF template. Review the [sharing workflow](USER_GUIDE.md#password-protected-sharing) before transfer.',
  '- Configured forms must load a valid, matching definition with a SHA-256 checksum for every template page before preview, PDF export, or sharing. Missing or failed definition loads report not-ready; invalid definitions report invalid-data. Configured-form batch export is unavailable.',
  '- A valid definition does not mean the template PDF bytes are already available offline. Preview and export also need the matching template pages. See [form templates](FORM_TEMPLATES.md) and [output limits](OUTPUT_LIMITS.md).',
  '- Preview does not issue export or privacy approval. Correspondence previews can initially omit appended PDF pages while an enhancement pass runs; check the finished download before distribution.', '',
  'Operation availability does not establish engine readiness, valid template geometry, completed content or processing authorization. PDF, Word and TeX exports also require a ready [deployment policy](CLASSIFICATION_CONFIG.md), available rendering resources and any required content review. See the [export workflow](USER_GUIDE.md#export-and-sign).', '',
  '## Correspondence content controls', '',
  'This table covers letters, endorsements, memoranda and agreements. Each cell lists **numbered paragraphs / formal references / formal enclosures** for rendered output. The values come from the same configuration used by the editor and renderers.', '',
  '| Document | Compliant mode | Custom mode |', '|---|---|---|');
for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
  // PDF-only publications use dedicated content models and template overrides.
  if (DOC_TYPE_CONFIG[docType].pdfOnly) continue;
  const flags = (mode: 'compliant' | 'custom') => {
    const c = documentOutputConfig(docType, mode).compliance;
    return [c.numberedParagraphs, c.allowReferences, c.allowEnclosures].map(value => value ? 'yes' : 'no').join(' / ');
  };
  lines.push(`| ${DOC_TYPE_LABELS[docType] ?? docType} | ${flags('compliant')} | ${flags('custom')} |`);
}
lines.push('', 'Technical publications use their own content models: I-Type instructions, structured SL-3/SL-4 stock lists, and TM/IETM cover and authentication pages. The general correspondence flags do not describe those models. SL-3/SL-4 templates suppress ordinary formal reference and enclosure lists. SL-4 and TM/IETM output also exclude retained correspondence body and list fields, including in Custom mode. See [technical publications](TECHNICAL_PUBLICATIONS.md).');
const content = lines.join('\n') + '\n';
const path = new URL('../docs/CAPABILITIES.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== content) throw new Error('Capability documentation is stale. Run npm run docs:capabilities.');
  console.log('Capability documentation matches the runtime configuration.');
} else {
  await writeFile(path, content);
}
