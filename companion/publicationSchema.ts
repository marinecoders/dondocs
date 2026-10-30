import { sl3Schema } from '../src/data/techpub/sl3';
import * as z from 'zod';
import { PUBLICATION_SECTIONS } from '../src/data/techpub/sections';
import { I_TYPE_TABLES } from '../src/data/techpub/tables';

const tableKey = z.enum(I_TYPE_TABLES.map((table) => table.key) as [string, ...string[]]);
const portion = z.enum(['U', 'CUI', 'FOUO', 'C', 'S', 'TS']);

export const publicationParagraph = {
  publicationSection: z.enum(Object.keys(PUBLICATION_SECTIONS) as [keyof typeof PUBLICATION_SECTIONS, ...Array<keyof typeof PUBLICATION_SECTIONS>]).optional(),
  referenceId: z.string().regex(/^[A-F0-9]{32}$/).optional().describe('Stable 32-character uppercase hex ID for PUBREF links; preserve it when revising.'),
  tableKey: tableKey.optional(),
  tableIdentifierMode: z.enum(['stock', 'software']).optional(),
  tableFootnotes: z.array(z.object({ id: z.string(), text: z.string() }).strict()).optional(),
  callout: z.enum(['warning', 'caution', 'note']).optional(),
  procedure: z.boolean().optional(),
  appendix: z.boolean().optional(),
  figure: z.object({
    fileId: z.string().min(1).describe('ID of a PNG, JPEG or single-page PDF in attachments.'),
    width: z.number().positive().optional(), height: z.number().positive().optional(),
    portionMarking: portion.optional(),
  }).strict().optional(),
};

export const attachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  dataBase64: z.string().min(4).max(8_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => value.length % 4 === 0, 'Base64 must contain complete four-character groups.')
    .describe('File bytes as standard base64, without a data URL prefix. No local paths or remote URLs.'),
}).strict();

const row = z.object({
  values: z.partialRecord(z.enum(['item', 'description', 'nsn', 'pn', 'qty', 'tamcn', 'id', 'softwareVersion']), z.string()),
  level: z.number().int().min(0).max(4).optional(),
  identificationException: z.string().optional(),
  openPurchase: z.object({ manufacturer: z.string(), address: z.string() }).strict().optional(),
}).strict();

export const publicationSchema = z.object({
  type: z.enum(['MI', 'TI', 'SI', 'LI', 'SL3']),
  sl3: sl3Schema.optional().describe('SL-3 inventory content, required when type is SL3.'),
  shortTitle: z.string(), pcn: z.string(), nomenclature: z.string(), controllingOffice: z.string(),
  signingDate: z.string().describe('Planned or actual signing date as YYYY-MM-DD.'),
  closedDates: z.string().optional().describe('Office closure dates as YYYY-MM-DD, separated by commas.'),
  urgency: z.enum(['normal', 'urgent']).optional(),
  completionDate: z.string().optional().describe('Urgent MI completion date as YYYY-MM-DD.'),
  supersedure: z.string().optional(), exportRestricted: z.boolean().optional(),
  distribution: z.object({
    statement: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
    reason: z.string().optional(), date: z.string().optional(),
  }).strict(),
  endItems: z.array(z.object({ nsn: z.string(), tamcn: z.string(), id: z.string(), model: z.string() }).strict()).optional(),
  tables: z.record(z.string(), z.array(row)).optional(),
  includeHyperlinks: z.boolean().optional(),
}).strict().describe('Required for i_type PDF export. Supply subject as the long title and date as the effective date (d MMM yy). Use unit and signature for authentication.');
