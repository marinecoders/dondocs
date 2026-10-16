import type { Paragraph, PublicationTableRow } from '@/types/document';
import { paragraphMark } from '@/services/latex/paragraphLabel';
import { safeUrl } from './url-safety';

export interface PublicationReference {
  index: number;
  kind: 'P' | 'F' | 'T' | 'N';
  note?: string;
  name: string;
  label: string;
  destination: string;
}
export const FOOTNOTE_REFERENCE_TOKEN = /\{\{PUBREF_N_[A-Z0-9_]+\}\}/g;
export const REFERENCE_TOKEN = /\{\{PUBREF_[A-Z0-9_]+\}\}/g;
export const EXTERNAL_PUBLICATION_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
export const referenceFreeText = (text: string) => text.replace(REFERENCE_TOKEN, '').replace(EXTERNAL_PUBLICATION_LINK, (match, _label, url) => safeUrl(url) ? '' : match);
export const referenceName = (kind: string, id: string, note?: string) => `PUBREF_${kind}_${id}${note ? `_${note.toUpperCase()}` : ''}`;

export function publicationReferences(paragraphs: Paragraph[], tables: Record<string, PublicationTableRow[]> = {}): PublicationReference[] {
  const entries: PublicationReference[] = [];
  let appendix = '', appendixCount = 0, figure = 0, table = 0;
  const counts = new Array(8).fill(0);
  const path: string[] = [];
  paragraphs.forEach((p, index) => {
    const add = (kind: PublicationReference['kind'], label: string, destination: string, note?: string) => {
      entries.push({ index, kind, label, destination, note, name: referenceName(kind, p.referenceId ?? `INDEX${index}`, note) });
    };
    if (p.appendix) {
      appendix = String.fromCharCode(65 + appendixCount++); figure = 0; table = 0; counts.fill(0); path.length = 0;
      add('P', `appendix ${appendix}`, `itype.p.${index}`);
    } else if (p.figure) {
      add('F', `figure ${appendix ? appendix + '-' : ''}${++figure}`, `itype.figure.${index}`);
    } else if (!p.callout) {
      counts[p.level]++;
      for (let j = p.level + 1; j < counts.length; j++) counts[j] = 0;
      path.length = p.level + 1;
      const mark = paragraphMark(p.level, counts[p.level]);
      path[p.level] = p.level % 4 >= 2 ? `(${mark})` : mark;
      add('P', `paragraph ${appendix ? appendix + '-' : ''}${path.join('')}`, `itype.p.${index}`);
    }
    if (!p.callout && !p.figure && !p.appendix && p.tableKey && tables[p.tableKey]?.length) {
      const number = `${appendix ? appendix + '-' : ''}${++table}`;
      add('T', `table ${number}`, `itype.table.${index}`);
      for (const note of p.tableFootnotes ?? []) {
        if (/^[a-z0-9]+$/i.test(note.id)) add('N', `table ${number}, footnote ${note.id}`, `itype.note.${index}.${note.id.toUpperCase()}`, note.id);
      }
    }
  });
  return entries;
}

export function validatePublicationReferences(paragraphs: Paragraph[], tables: Record<string, PublicationTableRow[]> = {}): string[] {
  const errors: string[] = [];
  const ids = paragraphs.map((p) => p.referenceId).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('Duplicate reference targets. Remove the duplicated paragraph and insert it again before adding references.');
  if (ids.some((id) => !/^[A-F0-9]{32}$/.test(id!))) errors.push('Invalid reference target identifier. Reinsert its references.');
  const targets = new Set(publicationReferences(paragraphs, tables).filter((r) => paragraphs[r.index].referenceId).map((r) => r.name));
  for (const p of paragraphs) {
    const notes = p.tableFootnotes ?? [];
    if (notes.length && (!p.tableKey || !tables[p.tableKey]?.length || p.figure || p.callout || p.appendix || p.procedure)) errors.push('Table footnotes need a populated table on an ordinary paragraph.');
    if (new Set(notes.map((n) => n.id.toUpperCase())).size !== notes.length || notes.some((n) => !/^[a-z0-9]+$/i.test(n.id) || !n.text.trim())) errors.push('Table footnotes need unique letter or number labels and text.');
    const numeric = notes.every((n) => /^\d+$/.test(n.id));
    if (numeric && notes.some((n, i) => n.id !== String(i + 1))) errors.push('Number table footnotes consecutively from 1 within each table.');
    const proseFields = [p.text, ...notes.map((n) => n.text)];
    if (proseFields.some((text) => (text.match(FOOTNOTE_REFERENCE_TOKEN) ?? []).length)) errors.push('Reference table footnotes only within their own table cells.');
    const cellFields = p.tableKey ? (tables[p.tableKey] ?? []).flatMap((row) => Object.values(row.values)) : [];
    const ownNotes = new Set(notes.map((n) => referenceName('N', p.referenceId ?? '', n.id)));
    for (const text of cellFields) {
      for (const token of text.match(FOOTNOTE_REFERENCE_TOKEN) ?? []) {
        if (!ownNotes.has(token.slice(2, -2))) errors.push('Reference table footnotes only within their own table cells.');
      }
    }
    for (const text of [...proseFields, ...cellFields]) {
      const prose = referenceFreeText(text);
      if (/\b(?:paragraph|figure|table)\s+(?:[A-Z]-)?\d+[a-z]?(?:\([a-z0-9]+\))*/i.test(prose)) {
        errors.push('Use Insert for internal paragraph, figure or table references. Link an external citation as [publication and location](https://source) and verify the location.');
      }
      for (const token of text.match(REFERENCE_TOKEN) ?? []) {
        if (!targets.has(token.slice(2, -2))) errors.push('A publication reference has no target. Reinsert it or restore the deleted target.');
      }
    }
  }
  return [...new Set(errors)];
}
