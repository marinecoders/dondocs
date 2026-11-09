import { storedSignature, storedFormSignatures } from './signatureProjection';
import type { DocumentSnapshot } from '@/stores/historyStore';
import type { SerializedSession } from '@/stores/documentStore';

/** Persisted projection of an already captured snapshot; no store reads. */
export function serializeDocumentSnapshot(snapshot: DocumentSnapshot, timestamp: number): SerializedSession {
  if (snapshot.documentCategory === 'forms') {
    return {
      documentMode: snapshot.documentMode, documentCategory: 'forms',
      docType: snapshot.docType, formType: snapshot.formType ?? 'navmc_10274',
      ...(snapshot.genericForm ? { genericForm: snapshot.genericForm } : { forms: snapshot.forms ? { ...snapshot.forms, ...(snapshot.forms.navmc10274 ? { navmc10274: storedFormSignatures(snapshot.forms.navmc10274) } : {}), ...(snapshot.forms.navmc11811 ? { navmc11811: storedFormSignatures(snapshot.forms.navmc11811) } : {}) } : undefined }), formData: {}, references: [],
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
      signatureImage: storedSignature(snapshot.formData.signatureImage),
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

/** A portable share owns its payload and excludes device-local binary resources. */
export function projectSharedSession(session: SerializedSession): SerializedSession {
  const owned = structuredClone(session);
  owned.formData = { ...owned.formData, signatureImage: undefined, basicLetterFile: undefined, basicLetterFileRef: undefined };
  owned.paragraphs = owned.paragraphs.map(paragraph => ({
    ...paragraph,
    ...(paragraph.figure ? { figure: { ...paragraph.figure, fileRef: undefined } } : {}),
  }));
  owned.enclosures = owned.enclosures.map(({ fileRef: _ref, ...enclosure }) => enclosure);
  for (const form of [owned.forms?.navmc10274, owned.forms?.navmc11811]) {
    if (form && Array.isArray(form.signatureBlocks)) form.signatureBlocks = form.signatureBlocks.map(({ image: _image, imageRef: _ref, ...block }) => block);
  }
  return owned;
}
