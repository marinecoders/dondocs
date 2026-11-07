import { expect, it } from 'vitest';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { prepareExport, acknowledgePreparedExport, copyPreparedDocument, copyExportReview, preparedExportMarking, assertReadyExport } from '@/lib/preparedExport';
import { projectCapturedOutput } from '@/lib/documentFields';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';

const source = { documentId: 'original', epoch: 1, editSequence: 2, capturedAt: 3 };
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
