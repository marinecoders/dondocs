import type { DocumentSnapshot } from '@/stores/historyStore';
import type { SerializedSession } from '@/stores/documentStore';

/** Persisted projection of an already captured snapshot; no store reads. */
export function serializeDocumentSnapshot(snapshot: DocumentSnapshot, timestamp = Date.now()): SerializedSession {
  if (snapshot.documentCategory === 'forms') {
    return {
      documentMode: snapshot.documentMode, documentCategory: 'forms',
      docType: snapshot.docType, formType: snapshot.formType ?? 'navmc_10274',
      ...(snapshot.genericForm ? { genericForm: snapshot.genericForm } : { forms: snapshot.forms }), formData: {}, references: [],
      enclosures: [], paragraphs: [], copyTos: [], distributions: [], timestamp,
    };
  }
  return {
    documentMode: snapshot.documentMode,
    documentCategory: snapshot.documentCategory ?? 'correspondence',
    docType: snapshot.docType,
    formType: snapshot.formType ?? 'navmc_10274',
    endItems: snapshot.endItems,
    publicationTables: snapshot.publicationTables,
    genericForm: snapshot.genericForm,
    formData: {
      ...snapshot.formData,
      // Bytes live in the attachments store; keep only basicLetterFileRef so the
      // serialized session stays light and JSON-safe (rehydrated on load).
      basicLetterFile: undefined,
    },
    references: snapshot.references,
    enclosures: snapshot.enclosures.map(enc => ({
      title: enc.title,
      pageStyle: enc.pageStyle,
      hasCoverPage: enc.hasCoverPage,
      coverPageDescription: enc.coverPageDescription,
      hasFile: !!enc.file,
      fileRef: enc.fileRef,
    })),
    paragraphs: snapshot.paragraphs,
    copyTos: snapshot.copyTos,
    distributions: snapshot.distributions,
    timestamp,
  };
}
