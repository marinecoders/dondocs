import { z } from 'zod';
import { MANUAL_DOC_TYPE, manualFrontMatterSchema } from '../src/data/techpub/manualFrontMatter';
import type { DocumentData } from '../src/types/document';

export const manualFrontMatterInputSchema = manualFrontMatterSchema.extend({
  shortTitle: z.string(), pcn: z.string(), nomenclature: z.string(),
  signingDate: z.string(), closedDates: z.string().optional(), controllingOffice: z.string(),
  supersedure: z.string().optional(), exportRestricted: z.boolean().optional(),
  distribution: z.object({ statement: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), reason: z.string().optional(), date: z.string().optional() }).strict(),
}).strict().describe('TM/IETM cover and authentication metadata. PDF only; supply subject as the long title, date as d MMM yy, and unit/signature as the issuer and authorized signer.');

export function manualFrontMatterFields(input: { docType: string; manualFrontMatter?: z.infer<typeof manualFrontMatterInputSchema> }): Partial<DocumentData> {
  if (input.docType !== MANUAL_DOC_TYPE || !input.manualFrontMatter) return {};
  const p = manualFrontMatterInputSchema.parse(input.manualFrontMatter);
  const { shortTitle, pcn, nomenclature, signingDate, closedDates, controllingOffice, supersedure, exportRestricted, distribution, ...content } = p;
  return {
    manualFrontMatter: manualFrontMatterSchema.parse(content), shortTitle, pcn, nomenclature,
    publicationSigningDate: signingDate, publicationClosedDates: closedDates ?? '', controllingOffice,
    supersedure: supersedure ?? '', exportRestricted: exportRestricted ?? false,
    cuiDistStatement: distribution.statement, distReason: distribution.reason ?? '', distDate: distribution.date ?? '',
    signatureType: 'digital', fontSize: '10pt', fontFamily: 'times',
  };
}
