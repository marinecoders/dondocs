import { expect, it } from 'vitest';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { prepareExport, copyPreparedDocument } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { detectCapturedPII } from '@/services/pii/detector';

it('inspects shared hidden MFR values while excluding them from the rendered export', () => {
  const draft = prepareSessionState(createBlankSession(undefined, 'mfr'));
  draft.formData = { subject: 'Record', from: 'SSN 123-45-6789', to: 'Hidden recipient', via: 'Hidden route' };
  draft.paragraphs = [{ text: 'Visible body', level: 0 }];draft.enclosures = [];draft.references = [];
  const captured = captureDocumentRevision({ documentId: 'A', epoch: 1, editSequence: 1, capturedAt: 1 }, draft);
  expect(detectCapturedPII(captured, 'share').found).toBe(true);
  const result = prepareExport({ id: 'mfr', captured, target: 'pdf', filename: 'record.pdf', policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) });
  expect(result.status).toBe('ready');if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(copyPreparedDocument(result.job).document.formData.from).toBeUndefined();
  expect(copyCapturedDocument(captured).document.formData.from).toBe('SSN 123-45-6789');
});
