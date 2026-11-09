import { expect, it } from 'vitest';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { captureFormExportTemplates } from '@/lib/formExportTemplates';
import { prepareExport, copyExportReview } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useFormStore } from '@/stores/formStore';
import { detectCapturedPII } from '@/services/pii/detector';
import { fixtureInstance } from '../_helpers/formFixture';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const identity = { documentId: 'privacy', epoch: 1, editSequence: 1, capturedAt: 1 };
function page11(edipi: string, remarksText = '', placeholders?: Record<string, string>) {
  const captured = captureDocumentRevision(identity, {
    documentCategory: 'forms', documentMode: 'compliant', docType: 'standard_letter', formType: 'navmc_118_11',
    forms: { includeCoverPage: false, navmc11811: { ...useFormStore.getInitialState().navmc11811, edipi, remarksText } },
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  return prepareExport({ id: 'page11', captured, target: 'pdf', filename: 'page11.pdf', policy, placeholders,
    formTemplates: captureFormExportTemplates('builtin-form', 'navmc_118_11', { page1: new Uint8Array([1]) }) });
}

it('exempts a valid dedicated Page 11 EDIPI, including its overlapping phone match', () => {
  expect(page11('1436758291').status).toBe('ready');
  expect(page11('{{ID}}', '', { ID: '1436758291' }).status).toBe('ready');
  expect(page11('{{id}}', '', { ID: '1436758291' }).status).toBe('ready');
});
it.each(['123-45-6789', '1436758291 diagnosis', 'sample@example.com'])('still reviews malformed dedicated IDs: %s', value => {
  expect(page11(value).status).toBe('needs-review');
});
it('reviews the same valid ID when a Page 11 placeholder also renders it in free text', () => {
  const result = page11('{{ID}}', 'ID {{ID}}', { ID: '1436758291' });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings).toContainEqual(expect.objectContaining({ type: 'EDIPI', value: '1436758291', field: expect.stringContaining('remarks') }));
});
it('reviews unused raw batch values while keeping dormant correspondence fields excluded', () => {
  const captured = captureDocumentRevision(identity, {
    documentCategory: 'correspondence', documentMode: 'compliant', docType: 'standard_letter', formType: 'navmc_10274',
    formData: { subject: '{{NAME}}', seniorCommandName: 'diagnosis' }, paragraphs: [{ text: 'Training', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  const result = prepareExport({ id: 'row', captured, target: 'pdf', filename: 'row.pdf', policy, placeholders: { NAME: 'Sample', UNUSED: 'SSN 123-45-6789' } });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.summary).toMatchObject({ ssn: 1, medicalKeywords: 0 });
  expect(copyExportReview(result.job).privacy.findings[0].field).toContain('UNUSED');
});

it.each(['navmc10274', 'navmc11811'] as const)('inspects %s signature statements and excludes image bytes', key => {
  const formType = key === 'navmc10274' ? 'navmc_10274' : 'navmc_118_11';
  useFormStore.getState().clearNavmc10274();useFormStore.getState().clearNavmc11811();
  const form = { ...useFormStore.getState()[key], signatureBlocks: [{ name: 'Sample', statement: 'SSN 123-45-6789', style: 'image', image: 'data:image/png;base64,diagnosis' }] };
  const captured = captureDocumentRevision(identity, {
    documentCategory: 'forms', documentMode: 'compliant', docType: 'standard_letter', formType,
    forms: { includeCoverPage: false, [key]: form }, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    endItems: [], publicationTables: {},
  });
  const result = detectCapturedPII(captured);
  expect(result.summary).toMatchObject({ ssn: 1, medicalKeywords: 0 });
});

it('inspects configured-form text answers and repeated rows', () => {
  const genericForm = fixtureInstance();genericForm.answers.name = 'SSN 123-45-6789';
  genericForm.rows.roster = [{ id: 'one', answers: { date: 'diagnosis' } }];
  const captured = captureDocumentRevision(identity, {
    documentCategory: 'forms', documentMode: 'compliant', docType: 'standard_letter', formType: 'fixture', genericForm,
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  expect(detectCapturedPII(captured).summary).toMatchObject({ ssn: 1, medicalKeywords: 1 });
});

it('keeps unused row IDs in privacy review even beside a valid dedicated ID', () => {
  expect(page11('{{ID}}', '', { ID: '1436758291', UNUSED: '1436758291' }).status).toBe('needs-review');
  expect(page11('{{id}}', '', { id: '1436758291' }).status).toBe('needs-review');
});
