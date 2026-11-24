import { expect, it, vi } from 'vitest';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { renderDocumentForPrint } from '@/services/pdf/printDocument';
import { createBlankSession } from '@/stores/documentStore';

it('checks window-envelope restrictions before rendering a print job', async () => {
  const draft = { ...createBlankSession(undefined, 'naval_letter'), endItems: [], publicationTables: {} };
  draft.formData = {
    ...draft.formData, windowEnvelope: 'standard', classLevel: 'cui',
    unitLine1: 'Training Office', to: 'Training Unit', subject: 'TRAINING',
  };
  const revision = captureDocumentRevision({ documentId: 'print-window', epoch: 1, editSequence: 2, capturedAt: 3 }, draft);
  const compile = vi.fn(async () => { throw new Error('Unexpected print compile'); });
  const waitForReady = vi.fn(async () => true);

  await expect(renderDocumentForPrint(revision, { compile, waitForReady }, new AbortController().signal))
    .rejects.toThrow('Window envelopes require an unclassified letter');
  expect(compile).not.toHaveBeenCalled();
  expect(waitForReady).not.toHaveBeenCalled();
});
