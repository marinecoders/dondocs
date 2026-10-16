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
    paragraphs: session.paragraphs.map((p) => ({ ...p, text: replacePlaceholders(p.text, values), header: p.header ? replacePlaceholders(p.header, values) : undefined })),
    references: session.references.map((r) => ({ ...r, title: replacePlaceholders(r.title, values), url: r.url ? replacePlaceholders(r.url, values) : undefined })),
    copyTos: session.copyTos.map((c) => ({ ...c, text: replacePlaceholders(c.text, values) })),
    distributions: session.distributions.map((d) => ({ ...d, text: replacePlaceholders(d.text, values) })),
  };
}
