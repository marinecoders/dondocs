import { expect, it } from 'vitest';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { projectRenderedDocument } from '@/lib/renderedDocument';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { prepareExport, copyPreparedDocument } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

it('uses the same active output and canonical marking for preview and export without aliasing the editor', () => {
  const raw = prepareSessionState(createBlankSession());
  raw.formData = { subject: 'Original', classLevel: 'unclassified', seniorCommandName: 'Inactive' };
  raw.paragraphs = [{ text: 'Owned body', level: 0, portionMarking: 'CUI' }];
  const captured = captureDocumentRevision({ documentId: 'A', epoch: 1, editSequence: 1, capturedAt: 1 }, raw);
  const preview = projectRenderedDocument(captured);
  const prepared = prepareExport({ id: 'same', captured, target: 'pdf', filename: 'same.pdf', policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] }, runtime: { status: 'absent' } }) });
  expect(prepared.status).toBe('ready');if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
  expect(copyCapturedDocument(preview).document).toEqual(copyPreparedDocument(prepared.job).document);
  raw.formData.subject = 'Changed';
  expect(copyCapturedDocument(preview).document.formData.subject).toBe('Original');
  expect(copyCapturedDocument(preview).document.formData.classLevel).toBe('cui');
  expect(copyCapturedDocument(preview).document.formData.seniorCommandName).toBeUndefined();
});
