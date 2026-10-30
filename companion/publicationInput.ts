import { isTechnicalPublication } from '../src/lib/publicationPreflight';
import { tableSpec } from '../src/data/techpub/tables';
import type { DocumentData, Enclosure, Paragraph } from '../src/types/document';
import type { LetterInput } from './letterInput';

export function publicationFields(input: LetterInput): Partial<DocumentData> {
  if (!isTechnicalPublication(input.docType) || !input.publication) return {};
  const p = input.publication;
  return {
    publicationType: p.type === 'SL3' ? undefined : p.type, sl3: p.sl3, shortTitle: p.shortTitle, pcn: p.pcn,
    nomenclature: p.nomenclature, controllingOffice: p.controllingOffice,
    publicationSigningDate: p.signingDate, publicationClosedDates: p.closedDates ?? '',
    miUrgency: p.urgency ?? 'normal', miCompletionDate: p.completionDate ?? '',
    supersedure: p.supersedure ?? '', exportRestricted: p.exportRestricted ?? false,
    cuiDistStatement: p.distribution.statement, distReason: p.distribution.reason ?? '',
    distDate: p.distribution.date ?? '', signatureType: 'digital', date: input.date ?? '',
  };
}

export function attachment(input: LetterInput, id: string) {
  const file = input.attachments?.find((file) => file.id === id);
  if (!file) throw new Error(`Attachment "${id}" is missing.`);
  return file;
}

export function publicationParagraphs(input: LetterInput): Paragraph[] {
  return (input.paragraphs ?? []).map(({ figure, ...p }) => {
    if (!figure) return { ...p, level: p.level ?? 0 } as Paragraph;
    const file = attachment(input, figure.fileId);
    return { ...p, level: p.level ?? 0, figure: {
      width: figure.width, height: figure.height, portionMarking: figure.portionMarking,
      name: file.name, type: file.mimeType,
      fileRef: { id: file.id, name: file.name, type: file.mimeType, size: Buffer.byteLength(file.dataBase64, 'base64') },
    } } as Paragraph;
  });
}

export function publicationEnclosures(input: LetterInput): Enclosure[] {
  return (input.enclosures ?? []).map(({ fileId, ...enclosure }) => {
    if (!fileId) return enclosure;
    const file = attachment(input, fileId);
    if (file.mimeType !== 'application/pdf') throw new Error(`Enclosure "${enclosure.title}" requires a PDF attachment.`);
    const bytes = Uint8Array.from(Buffer.from(file.dataBase64, 'base64'));
    return { ...enclosure, file: { name: file.name, size: bytes.byteLength, data: bytes.buffer } };
  });
}

export function publicationInputErrors(input: LetterInput): string[] {
  const errors: string[] = [];
  if (input.docType === 'sl3' && (input.publication?.type !== 'SL3' || !input.publication.sl3)) errors.push('SL-3 requires publication.type SL3 and publication.sl3 inventory data.');
  if (input.docType === 'i_type' && input.publication?.sl3) errors.push('SL-3 inventory data requires docType sl3.');
  if (input.docType === 'sl3' && (input.publication?.urgency || input.publication?.completionDate)) errors.push('SL-3 does not use MI urgency or completion dates.');
  if (input.docType === 'i_type' && input.publication?.type === 'SL3') errors.push('I-Type requires publication.type MI, SI, TI or LI.');
  if (input.docType === 'sl3' && (input.publication?.tables || input.enclosures?.length || input.paragraphs?.some((p) => !p.figure))) errors.push('SL-3 uses structured inventory data and figure paragraphs, not I-Type tables, body paragraphs or enclosures.');
  for (const [index, paragraph] of (input.paragraphs ?? []).entries()) {
    const blocks = [paragraph.figure, paragraph.callout, paragraph.procedure, paragraph.appendix, paragraph.tableKey];
    if (blocks.filter(Boolean).length > 1) {
      errors.push(`Paragraph ${index + 1}: choose only one of figure, callout, procedure, appendix or table.`);
    }
  }
  for (const [key, rows] of Object.entries(input.publication?.tables ?? {})) {
    const mode = input.paragraphs?.find((p) => p.tableKey === key)?.tableIdentifierMode;
    const spec = tableSpec(key, mode);
    if (!spec) { errors.push(`Unknown publication table: ${key}.`); continue; }
    const columns = new Set(spec.columns.map((column) => column.key));
    for (const [index, row] of rows.entries()) {
      for (const column of Object.keys(row.values)) {
        if (!columns.has(column)) errors.push(`${spec.name}, row ${index + 1}: column "${column}" is not supported in this table.`);
      }
      if (row.level && !spec.nestable) errors.push(`${spec.name} does not support nested rows.`);
    }
  }
  const ids = new Set<string>();
  for (const file of input.attachments ?? []) {
    if (ids.has(file.id)) errors.push(`Duplicate attachment ID: ${file.id}.`);
    ids.add(file.id);
  }
  const size = (input.attachments ?? []).reduce((sum, file) => sum + file.dataBase64.length, 0);
  if (size > 12_000_000) errors.push('Combined attachments exceed the 12 MB base64 limit.');
  return errors;
}
