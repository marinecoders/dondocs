import type { Paragraph, PublicationTableRow } from '@/types/document';
import { FOOTNOTE_REFERENCE_TOKEN, referenceName } from './publicationReferences';

/** Remove the note and its citations, renumbering remaining numeric notes together. */
export function withoutTableFootnote(paragraphs: Paragraph[], tables: Record<string, PublicationTableRow[]>, index: number, noteIndex: number) {
  const paragraph = paragraphs[index];
  const notes = paragraph.tableFootnotes ?? [];
  const remaining = notes.filter((_, i) => i !== noteIndex);
  const numeric = notes.every((note) => /^\d+$/.test(note.id));
  const replacements = new Map<string, string>();
  const updated = remaining.map((note, i) => {
    const id = numeric ? String(i + 1) : note.id;
    replacements.set(referenceName('N', paragraph.referenceId ?? '', note.id), `{{${referenceName('N', paragraph.referenceId ?? '', id)}}}`);
    return { ...note, id };
  });
  if (notes[noteIndex]) replacements.set(referenceName('N', paragraph.referenceId ?? '', notes[noteIndex].id), '');
  const rewrite = (text: string) => text.replace(FOOTNOTE_REFERENCE_TOKEN, (token) => replacements.get(token.slice(2, -2)) ?? token);
  return {
    paragraphs: paragraphs.map((p, i) => ({ ...p, text: rewrite(p.text), tableFootnotes: (i === index ? updated : p.tableFootnotes)?.map((note) => ({ ...note, text: rewrite(note.text) })) })),
    publicationTables: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(row.values).map(([column, text]) => [column, rewrite(text)])) }))])),
  };
}
