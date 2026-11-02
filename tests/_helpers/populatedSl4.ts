import { readFile } from 'node:fs/promises';
import type { DocumentData, EndItem } from '@/types/document';
import type { LetterInput } from '../../companion/letterInput';

type Portion = NonNullable<DocumentData['sl4']>['contextPortion'];

/** Fictional 45-part publication with five vector drawings and linked indexes. */
export async function populatedSl4Input(): Promise<LetterInput> {
  const draft = JSON.parse(await readFile(new URL('../fixtures/sl4/populated-draft.json', import.meta.url), 'utf8')) as {
    formData: DocumentData;
    endItems: EndItem[];
    paragraphs: { referenceId: string; text: string; portionMarking: Portion; figure: { data: string; name: string; type: 'application/pdf' | 'image/png' | 'image/jpeg'; portionMarking: Portion } }[];
  };
  const d = draft.formData;
  return {
    docType: 'sl4', subject: d.subject, date: d.date, pocEmail: d.pocEmail,
    unit: { name: d.unitLine1, line2: d.unitLine2, address: d.unitAddress },
    signature: { first: d.sigFirst, middle: d.sigMiddle, last: d.sigLast, title: d.sigTitle },
    publication: {
      type: 'SL4', shortTitle: d.shortTitle!, pcn: d.pcn!, nomenclature: d.nomenclature!,
      controllingOffice: d.controllingOffice!, signingDate: d.publicationSigningDate!,
      supersedure: d.supersedure, distribution: { statement: 'A' },
      endItems: draft.endItems, sl4: d.sl4!,
    },
    paragraphs: draft.paragraphs.map((p, i) => ({
      referenceId: p.referenceId, text: p.text, portionMarking: p.portionMarking,
      figure: { fileId: `drawing-${i}`, portionMarking: p.figure.portionMarking },
    })),
    attachments: draft.paragraphs.map((p, i) => ({
      id: `drawing-${i}`, name: p.figure.name, mimeType: p.figure.type, dataBase64: p.figure.data,
    })),
    out: 'sl4-populated.pdf',
  };
}
