import type { SerializedSession } from '@/stores/documentStore';
import type { Enclosure } from '@/types/document';
import { loadAttachment } from './attachments';
import { applyPlaceholdersToSession } from './placeholders';

/** Resolve the frozen job's files without reading or mutating the active editor. */
export async function prepareBatchCorrespondence(session: SerializedSession, values: Record<string, string>) {
  const owned = applyPlaceholdersToSession(session, values);
  const formData = owned.formData;
  if (owned.docType === 'tm_ietm_front_matter') return {
    docType: owned.docType, documentMode: owned.documentMode, formData, enclosures: [], endItems: [], publicationTables: {},
    paragraphs: [], references: [], copyTos: [], distributions: [],
  };
  const file = async (ref: NonNullable<Enclosure['fileRef']>) => {
    const data = await loadAttachment(ref.id);
    if (!data) throw new Error(`Attached file “${ref.name}” is missing. Reattach it and start a new batch.`);
    return { name: ref.name, size: data.byteLength, data };
  };
  if (formData.basicLetterFileRef) formData.basicLetterFile = await file(formData.basicLetterFileRef);
  const enclosures = await Promise.all(owned.enclosures.map(async enclosure => ({
    ...enclosure,
    file: enclosure.fileRef ? await file(enclosure.fileRef) : undefined,
  })));
  return {
    docType: owned.docType, documentMode: owned.documentMode, formData, enclosures,
    endItems: owned.endItems ?? [], publicationTables: owned.publicationTables ?? {},
    paragraphs: owned.paragraphs, references: owned.references, copyTos: owned.copyTos, distributions: owned.distributions,
  };
}
