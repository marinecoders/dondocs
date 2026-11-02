import { emptyManualFrontMatter, manualType, type ManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import type { DocumentData } from '@/types/document';
import { letterSchema } from '../../companion/letterSchema';
import type { LetterInput } from '../../companion/letterInput';

/** Fictional publication identifiers and equipment, for layout checks only. */
export function manualPacket(count = 1, subtype: ManualFrontMatter['subtype'] = 'tm') {
  const formData: Partial<DocumentData> = {
    docType: 'tm_ietm_front_matter', subject: 'PORTABLE TEST EQUIPMENT', nomenclature: 'CONTROLLER, Portable Test',
    shortTitle: `${manualType(subtype)[2]} 00000A-10/1`, pcn: '00000000000', date: '30 Oct 26', publicationSigningDate: '2026-10-30',
    fontSize: '10pt', fontFamily: 'times', signatureType: 'digital', classLevel: 'unclassified', cuiDistStatement: 'A',
    unitLine1: 'TEST PROGRAM OFFICE', unitLine2: '', unitAddress: '123 Example Road\nQuantico, VA 22134',
    sigFirst: 'A.', sigLast: 'SAMPLE', sigTitle: 'Program Manager', controllingOffice: 'Test Program Office', byDirection: false,
    manualFrontMatter: {
      ...emptyManualFrontMatter(), subtype, authorityBasis: 'pm_or_above', rightsAssessment: 'not_required',
      supplementNotice: subtype === 'supplement' ? 'THIS PUBLICATION SUPPLEMENTS TM 00000A-10/1.' : '',
      contentContact: 'Test Program Office, sample@example.usmc.mil.',
      endItems: Array.from({ length: count }, (_, i) => ({ rowId: `example-row-${i + 1}`, nsn: '', tamcn: '', id: `TEST-${String(i + 1).padStart(3, '0')}`, model: `MODEL-${i + 1}` })),
    },
  };
  return { docType: 'tm_ietm_front_matter', formData };
}

export function manualRequest(count = 1): LetterInput {
  return manualInput(manualPacket(count));
}

export function manualInput({ formData: d }: ReturnType<typeof manualPacket>): LetterInput {
  return letterSchema.parse({
    docType: 'tm_ietm_front_matter', format: 'pdf', subject: d.subject, date: d.date,
    unit: { name: d.unitLine1, line2: d.unitLine2 || undefined, address: d.unitAddress },
    signature: { first: d.sigFirst, middle: d.sigMiddle, last: d.sigLast, title: d.sigTitle },
    classification: d.classLevel === 'cui' ? { level: 'cui', pocEmail: d.pocEmail, cui: { category: d.cuiCategory, controlledBy: d.cuiControlledBy, dissemination: d.cuiDissemination } } : undefined,
    manualFrontMatter: {
      ...d.manualFrontMatter!, supersedure: d.supersedure, exportRestricted: d.exportRestricted, closedDates: d.publicationClosedDates, shortTitle: d.shortTitle!, pcn: d.pcn!, nomenclature: d.nomenclature!,
      signingDate: d.publicationSigningDate!, controllingOffice: d.controllingOffice!, distribution: { statement: d.cuiDistStatement, reason: d.distReason, date: d.distDate },
    },
  });
}
