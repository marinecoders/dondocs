import type { ExampleDocument } from '@/data/exampleDocuments';
import type { SerializedSession } from '@/stores/documentStore';

/** Examples are independent drafts: never inherit hidden fields or attachments. */
export function exampleSession(example: ExampleDocument): SerializedSession {
  return {
    documentMode: 'compliant', documentCategory: 'correspondence',
    docType: example.docType, formType: 'navmc_10274',
    formData: { fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none',
      ...structuredClone(example.formData), docType: example.docType },
    paragraphs: structuredClone(example.paragraphs),
    references: structuredClone(example.references ?? []),
    copyTos: structuredClone(example.copyTos ?? []),
    enclosures: [], distributions: [], endItems: [], publicationTables: {}, timestamp: Date.now(),
  };
}
