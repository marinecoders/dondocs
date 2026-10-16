import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { DOC_TYPE_LABELS } from '@/types/document';

const signature = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).optional() });
const form = z.record(z.string(), z.union([z.string(), z.array(signature)]));
const schema = z.object({
  documentMode: z.enum(['compliant', 'custom']),
  documentCategory: z.enum(['correspondence', 'forms']).default('correspondence'),
  docType: z.string().refine((v) => Object.hasOwn(DOC_TYPE_LABELS, v)),
  formType: z.enum(['navmc_10274', 'navmc_118_11']).default('navmc_10274'),
  formData: z.record(z.string(), z.unknown()),
  paragraphs: z.array(z.object({ text: z.string(), level: z.number().int().min(0).max(10), header: z.string().optional(), portionMarking: z.string().optional() })),
  references: z.array(z.object({ letter: z.string(), title: z.string(), url: z.string().optional() })),
  enclosures: z.array(z.object({ title: z.string(), pageStyle: z.string().optional(), hasCoverPage: z.boolean().optional(), coverPageDescription: z.string().optional() })),
  copyTos: z.array(z.object({ text: z.string() })),
  distributions: z.array(z.object({ text: z.string() })).default([]),
  forms: z.object({ navmc10274: form.optional(), navmc11811: form.optional(), includeCoverPage: z.boolean() }).optional(),
  timestamp: z.number().default(0),
});

/** Validate before touching the recipient's current document. */
export function parseSharedSession(value: unknown): SerializedSession {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('This link does not contain a supported DonDocs document.');
  const s = result.data;
  if (s.documentCategory === 'forms' && !(s.formType === 'navmc_10274' ? s.forms?.navmc10274 : s.forms?.navmc11811)) {
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
  return s as SerializedSession;
}
