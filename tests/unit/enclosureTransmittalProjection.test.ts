import { expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { copyPreparedDocument, prepareExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { validateLetter } from '../../companion/validateLetter';
import { collectProofreadFindings } from '@/lib/proofread';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: {
  maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'],
}, runtime: { status: 'absent' } });

it('refuses a companion transmittal request on formats or levels that cannot print it', () => {
  const input = { docType: 'business_letter', subject: 'Synthetic',
    classification: { level: 'cui', cui: { transmittalNote: true } }, enclosures: [{ title: 'Synthetic appendix' }] };
  expect(validateLetter(input).join(' ')).toMatch(/requires classification.level cui and a document type with formal enclosures/);
  expect(validateLetter({ ...input, docType: 'naval_letter', classification: { ...input.classification, level: 'unclassified' } }).join(' '))
    .toMatch(/requires classification.level cui and a document type with formal enclosures/);
});

it.each(['compliant', 'custom'] as const)('uses the transmittal note only with active enclosures in %s output', documentMode => {
  const original = createBlankSession();
  const captured = captureDocumentRevision({ documentId: 'source-synthetic', epoch: 1, editSequence: 0, capturedAt: 42 }, {
    ...original, documentMode, docType: 'business_letter', endItems: [], publicationTables: {},
    formData: { ...original.formData, classLevel: 'cui', cuiTransmittalNote: true },
    paragraphs: [{ text: 'Synthetic public letter body.', level: 0 }],
    enclosures: [{ title: 'Retained controlled appendix', marking: { classLevel: 'cui' } }],
  });
  const result = prepareExport({ id: 'synthetic-export', captured, target: 'pdf', filename: 'synthetic.pdf', policy });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  const output = copyPreparedDocument(result.job).document;
  expect(output.formData.cuiTransmittalNote).toBe(documentMode === 'custom' ? true : undefined);
  expect(output.enclosures).toHaveLength(documentMode === 'custom' ? 1 : 0);
  expect(copyCapturedDocument(captured).document.formData.cuiTransmittalNote).toBe(true);
});

it.each([false, true])('rejects the cover-only note when an active appended endorsement contains controlled portions (additional: %s)', additional => {
  const original = createBlankSession();
  const formData = { ...original.formData, docType: additional ? 'business_letter' : 'naval_letter', classLevel: 'cui', cuiTransmittalNote: true,
    from: 'Synthetic sender', to: 'Synthetic recipient', appendEndorsement: true,
    endorsementBody: additional ? 'Public acknowledgement.' : '(CUI) Controlled acknowledgement.',
    ...(additional ? { additionalEndorsements: [{ id: 'controlled-endorsement', endorsementBody: '(CUI) Controlled additional endorsement.' }] } : {}) };
  const captured = captureDocumentRevision({ documentId: 'source-synthetic', epoch: 1, editSequence: 0, capturedAt: 42 }, {
    ...original, formData, paragraphs: [{ text: 'Synthetic public letter body.', level: 0 }], endItems: [], publicationTables: {},
    enclosures: [{ title: 'Controlled appendix', marking: { classLevel: 'cui' } }],
  });
  expect(prepareExport({ id: 'synthetic-export', captured, target: 'pdf', filename: 'synthetic.pdf', policy }))
    .toMatchObject({ status: 'error', issues: [expect.stringContaining('controlled or classified')] });
  expect(collectProofreadFindings(copyCapturedDocument(captured).document).some(finding => finding.id === 'enclosure-marking:transmittal')).toBe(true);
});

it('ignores controlled endorsement text retained on a type that does not render endorsements', () => {
  const original = createBlankSession();
  const captured = captureDocumentRevision({ documentId: 'source-synthetic', epoch: 1, editSequence: 0, capturedAt: 42 }, {
    ...original, docType: 'business_letter', documentMode: 'custom', endItems: [], publicationTables: {},
    formData: { ...original.formData, docType: 'naval_letter', classLevel: 'cui', cuiTransmittalNote: true,
      from: 'Synthetic sender', to: 'Synthetic recipient', appendEndorsement: true, endorsementBody: '(CUI) Retained inactive endorsement.' },
    paragraphs: [{ text: 'Synthetic public letter body.', level: 0 }],
    enclosures: [{ title: 'Controlled appendix', marking: { classLevel: 'cui' } }],
  });
  expect(prepareExport({ id: 'synthetic-export', captured, target: 'pdf', filename: 'synthetic.pdf', policy }).status).toBe('ready');
});
