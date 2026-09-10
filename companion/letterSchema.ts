/**
 * The request shape, defined once.
 *
 * The tool schema, the `accepts` array `GET /health` advertises and the fields
 * `toStore` reads were three hand-maintained copies of one list, and they
 * drifted: `classification` was honoured over HTTP and absent from the tool
 * schema, so a request asking for SECRET rendered unmarked. The other two now
 * derive from this.
 *
 * No import side effects, so a test can reach it — `mcp.ts` starts a server.
 */
import * as z from 'zod';

const paragraph = z.object({
  text: z.string().describe('The paragraph text. Plain prose — numbering is applied for you.'),
  level: z.number().int().min(0).max(7).optional()
    .describe('0 = "1.", 1 = "a.", 2 = "(1)" … through Figure 7-8\'s eight levels. Defaults to 0.'),
  header: z.string().optional().describe('Bold run-in heading before the text.'),
});

const unit = z.object({
  name: z.string().optional(),
  line1: z.string().optional().describe('First letterhead line; defaults to the department wording.'),
  line2: z.string().optional().describe('Second letterhead line, e.g. the parent command.'),
  address: z.string().optional()
    .describe('The whole mailing address as ONE string, e.g. "PSC BOX 20004, QUANTICO VA 22134". Do not split it.'),
  department: z.enum(['usmc', 'navy']).optional(),
  seal: z.enum(['dow', 'dod']).optional(),
  letterheadColor: z.enum(['blue', 'black']).optional(),
});

const signature = z.object({
  first: z.string().optional(), middle: z.string().optional(), last: z.string().optional(),
  rank: z.string().optional(), title: z.string().optional(),
  byDirection: z.boolean().optional(),
  byDirectionAuthority: z.string().optional().describe('The authority cited beneath a by-direction signature.'),
});

/** The generator renders a marking only for a level it recognises; anything else
 *  comes out unmarked. Publishing the list stops a caller inventing one. */
const classification = z.object({
  level: z.enum(['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'])
    .optional().describe('Document-level classification. Defaults to unclassified.'),
  pocEmail: z.string().optional().describe('CUI point of contact.'),
});

export const letterSchema = z.object({
  docType: z.enum(['naval_letter', 'standard_letter', 'memorandum']),
  format: z.enum(['pdf', 'docx']).optional().describe('Defaults to pdf.'),
  out: z.string().optional().describe('Filename inside the output root. Defaults to a slug of the subject.'),

  subject: z.string().optional().describe('The Subj: line. Conventionally all caps.'),
  from: z.string().optional().describe('The From: line, e.g. "Commanding Officer, 1st Battalion, 6th Marines".'),
  to: z.string().optional(),
  via: z.array(z.string()).optional().describe('Each via is its own numbered line.'),

  ssic: z.string().optional(), serial: z.string().optional(),
  date: z.string().optional().describe('Naval format, e.g. "8 Aug 26". Defaults to today.'),
  originatorCode: z.string().optional(),

  paragraphs: z.array(paragraph).optional(),
  references: z.array(z.object({
    letter: z.string().optional().describe('Assigned (a), (b) … in order when omitted.'),
    title: z.string(),
    url: z.string().optional(),
  })).optional().describe('Lettered (a), (b) … in the order given.'),
  enclosures: z.array(z.object({ title: z.string() })).optional(),
  copyTo: z.array(z.string()).optional(),
  distribution: z.array(z.string()).optional(),

  unit: unit.optional().describe('Omit to use the machine defaults from ~/.dondocs/companion.config.json.'),
  signature: signature.optional().describe('Omit to use the machine defaults.'),

  classification: classification.optional()
    .describe('Omit for an unclassified document. The banner is the higher of this and any portion mark.'),
  pocEmail: z.string().optional().describe('CUI point of contact, shown in the CUI designation block.'),
  formData: z.record(z.string(), z.unknown()).optional()
    .describe('Escape hatch for a generator field this schema does not name yet. Merged last.'),
// Stripping an unnamed field silently is how a classification marking went
// missing from a document that asked for one. `formData` is the way through for
// anything this schema does not name.
}).strict();

/** Top-level field names, for the capability probe. Derived, never re-typed. */
export function acceptedFields(): string[] {
  const props = (z.toJSONSchema(letterSchema) as { properties?: Record<string, unknown> }).properties ?? {};
  return Object.keys(props);
}
