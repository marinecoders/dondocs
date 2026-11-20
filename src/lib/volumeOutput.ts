import type { DocumentData, Paragraph } from '@/types/document';
import { containsUnsupportedLatexText } from '@/services/latex/escaper';
import { publicationVolumeSchema } from './publicationVolume';

/** Inspect exactly the text the supported volume renderer prints. */
export function volumeOutputTextErrors(source: { formData: Partial<DocumentData>; paragraphs: readonly Paragraph[] }): string[] {
  const { formData: data, paragraphs } = source;
  const parsed = publicationVolumeSchema.safeParse(data.volume);
  if (!parsed.success) return [];
  const volume = parsed.data;
  const values = [data.subject, data.shortTitle, data.date, data.controllingOffice, data.cuiControlledBy, data.cuiCategory, data.cuiDissemination, data.pocEmail,
    ...[...volume.chapters, ...volume.appendices].flatMap(node => [node.title, ...node.sections.map(section => section.title)]),
    ...volume.glossary.flatMap(entry => [entry.term, entry.definition]),
    ...volume.changes.flatMap(entry => [entry.number, entry.date, entry.description]),
    ...paragraphs.flatMap(paragraph => [paragraph.text, paragraph.header, ...(paragraph.bodyTable?.rows.flat() ?? [])]),
  ];
  return values.some(value => value && containsUnsupportedLatexText(value))
    ? ['Volume PDF text contains characters outside the bundled font support. Keep the editable draft and replace those characters before exporting.'] : [];
}
