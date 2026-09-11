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
import { DOC_TYPES } from './validateLetter';

const paragraph = z.object({
  text: z.string().describe('The paragraph text. Plain prose — numbering is applied for you.'),
  level: z.number().int().min(0).max(7).optional()
    .describe('0 = "1.", 1 = "a.", 2 = "(1)" … through Figure 7-8\'s eight levels. Defaults to 0.'),
  header: z.string().optional().describe('Bold run-in heading before the text.'),
});

export const unit = z.object({
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
  custom: z.string().optional().describe('Banner text for a marking outside the list, e.g. a caveat.'),
  classifiedBy: z.string().optional(), derivedFrom: z.string().optional(),
  declassifyOn: z.string().optional(), reason: z.string().optional(),
  cui: z.object({
    category: z.string().optional(), controlledBy: z.string().optional(),
    dissemination: z.string().optional(), distStatement: z.string().optional(),
  }).optional().describe('The CUI designation block. Only read when level is cui.'),
});

/** One side of a two-party document. */
const party = z.object({
  name: z.string().describe('The command, in caps as it should print, e.g. "COMMANDANT OF THE MARINE CORPS".'),
  from: z.string().optional().describe('Joint letters: this party\'s From: line.'),
  code: z.string().optional().describe('Joint letters: originator code.'),
  zip: z.string().optional().describe('Joint letters: ZIP shown under the command.'),
  ssic: z.string().optional(), serial: z.string().optional(),
  date: z.string().optional().describe('Agreements: the date this party signed.'),
  signature: z.object({
    name: z.string().describe('Joint documents print this as given, e.g. "D. R. SMITH". Agreements (moa, mou) reduce a full name to initial and surname, so give "David R. Smith" there.'),
    rank: z.string().optional(), title: z.string().optional(),
  }).optional(),
});

/**
 * The two parties to a joint letter, joint memorandum, MOA or MOU. The app
 * stores these under two different flat families; publishing one shape means
 * a caller learns one concept, and toStore maps it to whichever the type reads.
 */
const parties = z.object({
  senior: party,
  junior: party,
  commonLocation: z.string().optional().describe('Joint letters: a shared location line, e.g. "Washington, D.C.".'),
});

const endorsement = z.object({
  ordinal: z.string().describe('FIRST, SECOND, THIRD ...'),
  basicLetterId: z.string().describe('The letter being endorsed, e.g. "CO 1st Bn ltr 5216 of 8 Sep 26".'),
  includeSubject: z.boolean().optional().describe('Repeat the Subj: line. Off by default per Ch 9.'),
});

export const letterSchema = z.object({
  // Derived, not restated: this list and validateLetter's are the same gate,
  // and a second copy is how one door came to accept what the other refused.
  docType: z.enum(DOC_TYPES as [string, ...string[]]),
  format: z.enum(['pdf', 'docx']).optional().describe('Defaults to pdf.'),
  out: z.string().optional().describe('Filename inside the output root. Defaults to a slug of the subject.'),

  subject: z.string().optional().describe('The Subj: line. Conventionally all caps.'),
  from: z.string().optional().describe('The From: line, e.g. "Commanding Officer, 1st Battalion, 6th Marines".'),
  to: z.string().optional(),
  via: z.array(z.string()).optional().describe('Each via is its own numbered line.'),

  ssic: z.string().optional(), serial: z.string().optional(),
  date: z.string().optional()
    .describe('Defaults to today in the format the type prescribes: "8 Aug 26" for letters and memoranda, "August 8, 2026" for business and executive correspondence. Match that form if you supply one.'),
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

  unit: unit.optional().describe('Omit to use the machine defaults; dondocs://defaults (MCP) or GET /health (HTTP) show them.'),
  signature: signature.optional().describe('Omit to use the machine defaults; dondocs://defaults (MCP) or GET /health (HTTP) show them.'),

  classification: classification.optional()
    .describe('Omit for an unclassified document. The banner is the higher of this and any portion mark.'),
  pocEmail: z.string().optional().describe('CUI point of contact, shown in the CUI designation block.'),

  parties: parties.optional().describe('Required for joint_letter, joint_memorandum, moa and mou; ignored elsewhere.'),
  endorsement: endorsement.optional().describe('For same_page_endorsement and new_page_endorsement.'),

  salutation: z.string().optional().describe('Business letters. Defaults to "Dear Sir or Madam:".'),
  complimentaryClose: z.string().optional().describe('Business letters. Defaults to "Sincerely,".'),
  attnLine: z.string().optional().describe('Executive correspondence, DOCX output only: an ATTN line.'),
  throughLine: z.string().optional().describe('Executive correspondence, DOCX output only: a THROUGH line.'),
  inReplyTo: z.boolean().optional().describe('Standard letters: print the "In Reply Refer To" line.'),
  coordination: z.string().optional().describe('Information memoranda: the coordination line.'),
  preparedBy: z.string().optional().describe('Information memoranda: who prepared it, e.g. "CAPT J. Smith, USN".'),
  pageNumbering: z.enum(['none', 'simple', 'xofy']).optional().describe('Defaults to none.'),

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
