import { readFile } from 'node:fs/promises';
import type { DocumentData, EndItem } from '@/types/document';
import type { LetterInput } from '../../companion/letterInput';

/** The complete fictional draft authored through the UI, with portable artwork. */
export async function populatedSl3Input(orientation: 'portrait' | 'landscape'): Promise<LetterInput> {
  const draft = JSON.parse(await readFile(new URL('../fixtures/sl3/populated-draft.json', import.meta.url), 'utf8')) as {
    formData: DocumentData; endItems: EndItem[];
    paragraphs: { referenceId: string; text: string; figure: { data: string; name: string } }[];
  };
  const d = draft.formData;
  const ids = new Map(draft.paragraphs.map((p, i) => [p.referenceId, String(i + 1).padStart(32, '0')]));
  const data = structuredClone(d.sl3!);
  data.orientation = orientation;
  data.endItemFigureId = ids.get(data.endItemFigureId) ?? data.endItemFigureId;
  for (const c of data.components) c.figureId = ids.get(c.figureId) ?? c.figureId;
  for (const a of data.artwork) a.figureId = ids.get(a.figureId) ?? a.figureId;
  const input: LetterInput = {
    docType: 'sl3', subject: d.subject, date: d.date, pocEmail: d.pocEmail,
    unit: { name: d.unitLine1, line2: d.unitLine2, address: d.unitAddress },
    signature: { first: d.sigFirst, middle: d.sigMiddle, last: d.sigLast, title: d.sigTitle },
    publication: { type: 'SL3', shortTitle: d.shortTitle!, pcn: d.pcn!, nomenclature: d.nomenclature!,
      controllingOffice: d.controllingOffice!, signingDate: d.publicationSigningDate!, closedDates: d.publicationClosedDates,
      supersedure: d.supersedure, distribution: { statement: 'B', reason: d.distReason, date: d.distDate },
      endItems: draft.endItems, sl3: data },
    paragraphs: draft.paragraphs.map((p, i) => ({ referenceId: ids.get(p.referenceId), text: p.text, figure: { fileId: `drawing-${i}` } })),
    attachments: draft.paragraphs.map((p, i) => ({ id: `drawing-${i}`, name: p.figure.name, mimeType: 'image/png', dataBase64: p.figure.data })),
    out: `padded-sl3-${orientation}.pdf`,
  };
  return input;
}
