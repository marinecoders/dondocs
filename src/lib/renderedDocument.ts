import { captureDocumentRevision, copyCapturedDocument, type CapturedDocument } from './capturedDocument';
import { projectCapturedOutput } from './documentFields';
import { deriveOverallClassLevel } from './overallClassification';
import { sl3Portions } from '@/data/techpub/sl3';
import { sl4Portions } from '@/data/techpub/sl4';
import type { DocumentSnapshot } from '@/stores/historyStore';

export function correspondencePortions(document: DocumentSnapshot) {
  return [...document.paragraphs,
    ...(document.docType === 'sl3' && document.formData.sl3 ? sl3Portions(document.formData.sl3) : []),
    ...(document.docType === 'sl4' && document.formData.sl4 ? sl4Portions(document.formData.sl4, document.paragraphs) : []),
  ];
}

/** Shared render projection; preview does not issue export or privacy approval. */
export function projectRenderedDocument(captured: CapturedDocument): CapturedDocument {
  const projected = projectCapturedOutput(captured);
  const content = copyCapturedDocument(projected);
  if (content.kind !== 'correspondence') return projected;
  content.document.formData.classLevel = deriveOverallClassLevel(content.document.formData.classLevel, correspondencePortions(content.document));
  return captureDocumentRevision(projected.source, content.document);
}
