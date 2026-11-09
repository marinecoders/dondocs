import { sl4Schema } from '@/data/techpub/sl4';
import { additionalEndorsementsSchema } from './endorsementValidation';
import { sl3Schema } from '@/data/techpub/sl3';
import { z } from 'zod';
import { parseFormInstance } from '@/services/forms/model';
import type { SerializedSession } from '@/stores/documentStore';
import { projectSharedSession } from './documentSerialization';
import { DOC_TYPE_LABELS } from '@/types/document';

const signature = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).optional() });
const form = z.record(z.string(), z.union([z.string(), z.array(signature)]))
  .refine(fields => Object.entries(fields).every(([key, value]) => key === 'signatureBlocks' ? Array.isArray(value) : typeof value === 'string'), 'Invalid built-in form fields');
export const sessionSchema = z.object({
  documentMode: z.enum(['compliant', 'custom']),
  documentCategory: z.enum(['correspondence', 'forms']).default('correspondence'),
  docType: z.string().refine((v) => Object.hasOwn(DOC_TYPE_LABELS, v)),
  formType: z.string().default('navmc_10274'),
  genericForm: z.unknown().optional(),
  formData: z.record(z.string(), z.unknown()),
  paragraphs: z.array(z.object({ text: z.string(), level: z.number().int().min(0).max(10), header: z.string().optional(), portionMarking: z.string().optional(),
    tableKey: z.string().optional(), tableIdentifierMode: z.enum(['stock', 'software']).optional(), callout: z.enum(['warning', 'caution', 'note']).optional(), procedure: z.boolean().optional(), appendix: z.boolean().optional(),
    referenceId: z.string().optional(), publicationSection: z.string().optional(), tableFootnotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    figure: z.object({ name: z.string().optional(), type: z.string().optional(), width: z.number().optional(), height: z.number().optional(), portionMarking: z.string().optional() }).optional(),
  })),
  references: z.array(z.object({ letter: z.string(), title: z.string(), url: z.string().optional() })),
  enclosures: z.array(z.object({ title: z.string(), pageStyle: z.string().optional(), hasCoverPage: z.boolean().optional(), coverPageDescription: z.string().optional() })),
  copyTos: z.array(z.object({ text: z.string() })),
  endItems: z.array(z.object({ nsn: z.string(), tamcn: z.string(), id: z.string(), model: z.string() })).default([]),
  publicationTables: z.record(z.string(), z.array(z.object({ values: z.record(z.string(), z.string()), level: z.number().optional(), identificationException: z.string().optional(), openPurchase: z.object({ manufacturer: z.string(), address: z.string() }).optional() }))).default({}),
  distributions: z.array(z.object({ text: z.string() })).default([]),
  forms: z.object({ navmc10274: form.optional(), navmc11811: form.optional(), includeCoverPage: z.boolean().default(true) }).optional(),
  timestamp: z.number().default(0),
});

export type SharedDocumentKind = 'correspondence' | 'builtin-form' | 'configured-form';
const envelope = z.object({ kind: z.literal('dondocs-share'), version: z.literal(1), documentKind: z.enum(['correspondence', 'builtin-form', 'configured-form']) });
function documentKind(session: SerializedSession): SharedDocumentKind {
  return session.documentCategory === 'forms' ? (session.genericForm ? 'configured-form' : 'builtin-form') : 'correspondence';
}

/** Additive envelope keeps the established document fields readable by earlier clients. */
export function createSharedPayload(session: SerializedSession): SerializedSession & { kind: 'dondocs-share'; version: 1; documentKind: SharedDocumentKind } {
  const owned = projectSharedSession(parseSharedSession(session));
  return { ...owned, kind: 'dondocs-share', version: 1, documentKind: documentKind(owned) };
}

/** Validate before touching the recipient's current document. */
export function parseSharedSession(value: unknown): SerializedSession {
  const metadata = value && typeof value === 'object' && ('kind' in value || 'documentKind' in value) ? envelope.safeParse(value) : undefined;
  if (metadata && !metadata.success) throw new Error('This share format is unsupported. Update DonDocs and ask the sender to create a compatible link.');
  const result = sessionSchema.safeParse(structuredClone(value));
  if (!result.success) throw new Error('This link does not contain a supported DonDocs document.');
  const s = result.data;
  if (s.formData.additionalEndorsements !== undefined) s.formData.additionalEndorsements = additionalEndorsementsSchema.parse(s.formData.additionalEndorsements);
  if (s.formData.sl3 !== undefined) s.formData.sl3 = sl3Schema.parse(s.formData.sl3);
  if (s.formData.sl4 !== undefined) s.formData.sl4 = sl4Schema.parse(s.formData.sl4);
  if (s.genericForm) {
    const instance = parseFormInstance(s.genericForm);
    if (s.documentCategory !== 'forms' || s.formType !== instance.definition.formId) throw new Error('The form definition does not match this document.');
    s.genericForm = instance;
  }
  if (s.documentCategory === 'forms' && !s.genericForm && !(s.formType === 'navmc_10274' ? s.forms?.navmc10274 : s.forms?.navmc11811)) {
    throw new Error('This older link is missing the filled form. Ask the sender to create a new link.');
  }
  // External links never resolve local binary handles, including older links.
  delete s.formData.basicLetterFile;
  delete s.formData.basicLetterFileRef;
  delete s.formData.signatureImage;
  if (s.forms) {
    if (s.formType === 'navmc_10274') delete s.forms.navmc11811;
    else delete s.forms.navmc10274;
  }
  if (metadata?.success && metadata.data.documentKind !== documentKind(s as SerializedSession)) throw new Error('The shared document kind does not match its contents.');
  if (s.documentCategory === 'forms' && !s.genericForm && !['navmc_10274', 'navmc_118_11'].includes(s.formType)) throw new Error('Unsupported shared form type.');
  return projectSharedSession(s as SerializedSession);
}
