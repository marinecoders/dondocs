import type { SerializedSession } from '@/stores/documentStore';
import type { Enclosure } from '@/types/document';
import { loadAttachment } from './attachments';
import { replacePlaceholders } from './placeholders';

/** Resolve the frozen job's files without reading or mutating the active editor. */
export async function prepareBatchCorrespondence(session: SerializedSession, values: Record<string, string>) {
  const formData = { ...session.formData };
  for (const [key, value] of Object.entries(formData)) {
    if (typeof value === 'string') Object.assign(formData, { [key]: replacePlaceholders(value, values) });
  }
  if (formData.sl3) {
    const replace = (value: string) => replacePlaceholders(value, values);
    const sl3 = formData.sl3;
    formData.sl3 = { ...sl3, technicalData: replace(sl3.technicalData), sequencingNote: replace(sl3.sequencingNote),
      notes: sl3.notes.map((note) => ({ ...note, text: replace(note.text) })),
      components: sl3.components.map((item) => ({ ...item, nomenclature: replace(item.nomenclature), description: replace(item.description),
        nsn: replace(item.nsn), tamcn: replace(item.tamcn), idNumber: replace(item.idNumber), partNumber: replace(item.partNumber), cage: replace(item.cage), unit: replace(item.unit), quantity: replace(item.quantity), model: replace(item.model), figureReference: replace(item.figureReference) })) };
  }
  const file = async (ref: NonNullable<Enclosure['fileRef']>) => {
    const data = await loadAttachment(ref.id);
    if (!data) throw new Error(`Attached file “${ref.name}” is missing. Reattach it and start a new batch.`);
    return { name: ref.name, size: data.byteLength, data };
  };
  if (formData.basicLetterFileRef) formData.basicLetterFile = await file(formData.basicLetterFileRef);
  const enclosures = await Promise.all(session.enclosures.map(async (enclosure) => ({
    ...enclosure, title: replacePlaceholders(enclosure.title, values),
    coverPageDescription: enclosure.coverPageDescription ? replacePlaceholders(enclosure.coverPageDescription, values) : undefined,
    file: enclosure.fileRef ? await file(enclosure.fileRef) : undefined,
  })));
  return {
    docType: session.docType, formData, enclosures,
    endItems: session.endItems ?? [], publicationTables: session.publicationTables ?? {},
    paragraphs: session.paragraphs.map((p) => ({ ...p, text: replacePlaceholders(p.text, values), header: p.header ? replacePlaceholders(p.header, values) : undefined })),
    references: session.references.map((r) => ({ ...r, title: replacePlaceholders(r.title, values), url: r.url ? replacePlaceholders(r.url, values) : undefined })),
    copyTos: session.copyTos.map((c) => ({ ...c, text: replacePlaceholders(c.text, values) })),
    distributions: session.distributions.map((d) => ({ ...d, text: replacePlaceholders(d.text, values) })),
  };
}
