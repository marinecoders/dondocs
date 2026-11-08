import { copyCapturedSession, type CapturedDocument } from '@/lib/capturedDocument';
declare const captured: CapturedDocument;
copyCapturedSession(captured);
// @ts-expect-error A raw editor object is not an issued captured document.
copyCapturedSession({ kind: 'correspondence', source: { documentId: 'a', epoch: 1, editSequence: 1, capturedAt: 1 } });
// @ts-expect-error Capture identity is immutable.
captured.source.documentId = 'other';
