import { captureDocumentScope, captureDocumentTarget, openPreparedDocument, prepareDocument, replaceCurrentDocument, type DocumentScope } from '@/stores/documentsStore';
import { rehydrateEnclosureFiles } from '@/stores/documentStore';

// @ts-expect-error scope construction is private to the owner
const forgedScope: DocumentScope = { documentId: 'draft', epoch: 1 };
void forgedScope;
const scope = captureDocumentScope();
if (scope) {
  // @ts-expect-error activation identity is immutable
  scope.epoch++;
}
// @ts-expect-error replacing content requires a reviewed edit sequence
replaceCurrentDocument(prepareDocument({}), scope);
// @ts-expect-error raw input is not a prepared document
openPreparedDocument({ session: {} }, captureDocumentTarget());
// @ts-expect-error live asset mutation requires an explicit ownership guard
void rehydrateEnclosureFiles();
