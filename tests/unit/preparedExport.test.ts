import { expect, it } from 'vitest';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { prepareExport, acknowledgePreparedExport, copyPreparedDocument, copyExportReview, preparedExportMarking, assertReadyExport } from '@/lib/preparedExport';
import { capturedTextFields, projectCapturedOutput } from '@/lib/documentFields';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';
import { manualPacket } from '../_helpers/manualPacket';

const source = { documentId: 'original', epoch: 1, editSequence: 2, capturedAt: Date.UTC(2026, 10, 8, 12) };
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
function snapshot(patch: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: 'Original' }, paragraphs: [{ text: 'Body', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, ...patch };
}
function request(data = snapshot()) { return { id: 'export-one', captured: captureDocumentRevision(source, data), target: 'pdf' as const, filename: 'original.pdf', policy }; }

it('substitutes before privacy inspection and excludes inactive-format text', () => {
  const input = request(snapshot({ formData: { subject: '{{NAME}}', seniorCommandName: 'SSN 456-67-8912' }, paragraphs: [{ text: '{{IDENTIFIER}}', level: 0 }] }));
  const values = { NAME: 'Resolved', IDENTIFIER: 'SSN 123-45-6789' };
  const result = prepareExport({ ...input, placeholders: values });
  expect(result.status).toBe('needs-review');
  if (result.status !== 'needs-review') throw new Error('Expected review');
  values.NAME = 'Changed';
  const review = copyExportReview(result.job);
  expect(review.privacy.findings.filter(f => f.type === 'SSN').map(f => f.value)).toEqual(['123-45-6789']);
  const ready = acknowledgePreparedExport(result.job);
  expect(copyPreparedDocument(ready).document.formData).toMatchObject({ subject: 'Resolved' });
  expect(copyPreparedDocument(ready).document.formData.seniorCommandName).toBeUndefined();
  expect(copyCapturedDocument(input.captured).document.formData.seniorCommandName).toBe('SSN 456-67-8912');
});
it('binds approval to one immutable revision and policy while copies remain independently writable', () => {
  const raw = snapshot({ paragraphs: [{ text: 'SSN 123-45-6789', level: 0 }] });
  const result = prepareExport(request(raw));
  if (result.status !== 'needs-review') throw new Error('Expected review');
  raw.formData.subject = 'Different live draft';
  const ready = acknowledgePreparedExport(result.job);
  const copy = copyPreparedDocument(ready);copy.document.formData.subject = 'Mutated copy';
  expect(copyPreparedDocument(ready).document.formData.subject).toBe('Original');
  expect(ready.job.filename).toBe('original.pdf');
  expect(ready.job.source).toEqual(source);
  expect(() => assertReadyExport({ ...ready })).toThrow();
  expect(() => acknowledgePreparedExport({ ...result.job })).toThrow();
  expect(() => Object.assign(ready.job, { filename: 'different.pdf' })).toThrow();
  const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'other.test', environment: null, runtime: { status: 'absent' } });
  const other = prepareExport({ ...request(raw), policy: otherPolicy });
  if (other.status !== 'needs-review') throw new Error('Expected review');
  expect(other.job.policyIdentity).not.toBe(result.job.policyIdentity);
  expect(copyPreparedDocument(acknowledgePreparedExport(other.job)).document.formData.subject).toBe('Different live draft');
});
it('uses the same highest classification for document output and assembly marking', () => {
  const result = prepareExport(request(snapshot({ formData: { classLevel: 'cui' }, paragraphs: [{ text: 'Portioned body', level: 0, portionMarking: 'S' }] })));
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(copyPreparedDocument(result.job).document.formData.classLevel).toBe('secret');
  expect(preparedExportMarking(result.job)).toEqual({ level: 'secret', marking: 'SECRET' });
});
it('carries custom banner text into assembly and rejects disallowed effective markings', () => {
  const result = prepareExport(request(snapshot({ formData: { classLevel: 'custom', customClassification: 'CUI//TEST' } })));
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(preparedExportMarking(result.job)).toEqual({ level: 'custom', marking: 'CUI//TEST' });
  const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(prepareExport({ ...request(snapshot({ paragraphs: [{ text: 'Body', level: 0, portionMarking: 'S' }] })), policy: restricted })).toMatchObject({ status: 'error', issues: [expect.stringContaining('SECRET')] });
});
it('does not issue a job while policy is unresolved or invalid', () => {
  expect(prepareExport({ ...request(), policy: { status: 'not-ready', message: 'Loading policy' } })).toEqual({ status: 'not-ready', issues: ['Loading policy'] });
  expect(prepareExport({ ...request(), policy: { status: 'error', message: 'Bad policy' } })).toEqual({ status: 'error', issues: ['Bad policy'] });
  expect(prepareExport({ ...request(), target: 'docx', captured: captureDocumentRevision(source, snapshot({ docType: 'sl3' })) })).toMatchObject({ status: 'error' });
});
it('projects complete built-in form data and output options without correspondence leftovers', () => {
  const form = useFormStore.getInitialState().navmc10274;
  const captured = captureDocumentRevision(source, snapshot({ documentCategory: 'forms', formType: 'navmc_10274', forms: { includeCoverPage: true, navmc10274: { ...form, natureOfAction: 'Form content' } } }));
  const projected = copyCapturedDocument(projectCapturedOutput(captured)).document;
  expect(projected.forms).toMatchObject({ includeCoverPage: true, navmc10274: { natureOfAction: 'Form content' } });
  expect(projected.formData).toEqual({});
  expect(projected.paragraphs).toEqual([]);
});

it.each(['TOP SECRET (DRAFT)', 'TS//SCI', 'SECRET - DRAFT', 'LIMITED DISTRIBUTION', 'Derived from: Multiple Sources'])('requires review when a custom banner cannot be ranked: %s', customClassification => {
  const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const result = prepareExport({ ...request(snapshot({ formData: { classLevel: 'custom', customClassification } })), policy: restricted });
  expect(result.status).toBe('needs-review');
  if (result.status !== 'needs-review') throw new Error('Expected explicit marking review');
  expect(copyExportReview(result.job).notices).toContain('Review the custom banner: its classification could not be determined automatically.');
  expect(copyExportReview(result.job).markingReview).toBe(true);
  expect(preparedExportMarking(acknowledgePreparedExport(result.job))).toEqual({ level: 'custom', marking: customClassification });
});

it('excludes retained correspondence lists from SL-4 output and privacy inspection', () => {
  const captured = captureDocumentRevision(source, snapshot({
    docType: 'sl4',
    references: [{ letter: 'a', title: 'SSN 123-45-6789' }],
    enclosures: [{ title: 'SSN 123-45-6789', fileRef: { id: 'retained-file', name: 'retained.pdf', type: 'application/pdf', size: 1 } }],
    copyTos: [{ text: 'SSN 123-45-6789' }], distributions: [{ text: 'SSN 123-45-6789' }],
  }));
  const output = copyCapturedDocument(projectCapturedOutput(captured)).document;
  expect(output.references).toEqual([]); expect(output.enclosures).toEqual([]);
  expect(output.copyTos).toEqual([]); expect(output.distributions).toEqual([]);
  expect(copyCapturedDocument(captured).document.enclosures).toHaveLength(1);
});

it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'])('rejects unsupported flat publication export before issuing a job: %s', docType => {
  const data = docType === 'tm_ietm_front_matter' ? snapshot(manualPacket()) : snapshot({ docType });
  expect(prepareExport({ ...request(data), target: 'tex', texMode: 'flat', filename: 'publication.tex' })).toMatchObject({ status: 'error', issues: [expect.stringContaining('flat LaTeX')] });
});
it('retains configuration export for manuals and flat export for ordinary correspondence', () => {
  const configuration = prepareExport({ ...request(snapshot(manualPacket())), target: 'tex', texMode: 'configuration', filename: 'manual.tex' });
  expect(configuration.status).toBe('ready');
  const flat = prepareExport({ ...request(), target: 'tex', texMode: 'flat', filename: 'letter.tex' });
  expect(flat.status).toBe('ready');
  if (flat.status !== 'ready') throw new Error('Expected flat export');
  expect(copyExportReview(flat.job.job).notices).toEqual([]);
});

it('reviews actual manual items while retaining replaced item data only in the draft', () => {
  const data = snapshot({ ...manualPacket(), endItems: [{ nsn: '', tamcn: '', id: 'SSN 123-45-6789', model: '' }] });
  const input = request(data);
  const result = prepareExport(input);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Inactive manual items must not require review');
  const output = copyPreparedDocument(result.job).document;
  expect(output.endItems).toEqual([]);
  expect(output.formData.manualFrontMatter?.endItems[0].id).toBe('TEST-001');
  expect(copyCapturedDocument(input.captured).document.endItems).toHaveLength(1);
  expect(capturedTextFields(input.captured, 'search').some(field => field.path[0] === 'endItems')).toBe(false);
  expect(capturedTextFields(input.captured, 'share').some(field => field.path[0] === 'endItems')).toBe(true);
  data.formData.manualFrontMatter!.endItems[0].model = 'SSN 123-45-6789';
  const actual = prepareExport(request(data));
  expect(actual.status).toBe('needs-review');
  if (actual.status !== 'needs-review') throw new Error('Actual manual item privacy must be reviewed');
  expect(copyExportReview(actual.job).privacy.findings).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'SSN', value: '123-45-6789' })]));
});
