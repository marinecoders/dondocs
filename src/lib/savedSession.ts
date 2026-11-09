import { z } from 'zod';
import { sessionSchema } from './sharedSession';
import { additionalEndorsementsSchema } from './endorsementValidation';
import { sl3Schema } from '@/data/techpub/sl3';
import { sl4Schema } from '@/data/techpub/sl4';
import { manualFrontMatterSchema } from '@/data/techpub/manualFrontMatter';
import { parseFormInstance } from '@/services/forms/model';
import type { SerializedSession } from '@/stores/documentStore';

const fileRef = z.object({ id: z.string(), name: z.string(), size: z.number(), type: z.string() });
const signature = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).optional(), image: z.string().optional(), imageRef: fileRef.optional(), digital: z.boolean().optional() });
const form = z.record(z.string(), z.union([z.string(), z.array(signature)]))
  .refine(fields => Object.entries(fields).every(([key, value]) => key === 'signatureBlocks' ? Array.isArray(value) : typeof value === 'string'), 'Invalid built-in form field');
const schema = sessionSchema.extend({
  documentMode: sessionSchema.shape.documentMode.default('compliant'),
  timestamp: z.number().default(0),
  formData: sessionSchema.shape.formData.default({}),
  references: sessionSchema.shape.references.default([]),
  copyTos: sessionSchema.shape.copyTos.default([]),
  enclosures: z.array(sessionSchema.shape.enclosures.element.extend({ fileRef: fileRef.optional() })).default([]),
  paragraphs: z.array(sessionSchema.shape.paragraphs.element.extend({
    figure: sessionSchema.shape.paragraphs.element.shape.figure.unwrap().extend({ fileRef: fileRef.optional() }).optional(),
  })).default([]),
  forms: z.object({ navmc10274: form.optional(), navmc11811: form.optional(), includeCoverPage: z.boolean().default(false) }).optional(),
});

/** Saved drafts retain local handles and images. Shared links use a separate reader. */
export function parseSavedSession(value: unknown): SerializedSession {
  const session = schema.parse(structuredClone(value));
  if (session.formData.additionalEndorsements !== undefined) session.formData.additionalEndorsements = additionalEndorsementsSchema.parse(session.formData.additionalEndorsements);
  if (session.formData.sl3 !== undefined) session.formData.sl3 = sl3Schema.parse(session.formData.sl3);
  if (session.formData.sl4 !== undefined) session.formData.sl4 = sl4Schema.parse(session.formData.sl4);
  if (session.formData.manualFrontMatter !== undefined) session.formData.manualFrontMatter = manualFrontMatterSchema.parse(session.formData.manualFrontMatter);
  if (session.formData.signatureImage !== undefined) session.formData.signatureImage = z.object({ name: z.string(), size: z.number(), data: z.string(), fileRef: fileRef.optional() }).parse(session.formData.signatureImage);
  if (session.formData.basicLetterFile !== undefined) session.formData.basicLetterFile = z.object({ name: z.string(), size: z.number(), data: z.instanceof(ArrayBuffer) }).parse(session.formData.basicLetterFile);
  if (session.formData.basicLetterFileRef !== undefined) session.formData.basicLetterFileRef = fileRef.parse(session.formData.basicLetterFileRef);
  if (session.genericForm) {
    const instance = parseFormInstance(session.genericForm);
    if (session.documentCategory !== 'forms' || session.formType !== instance.definition.formId) throw new Error('Form does not match the saved document');
    session.genericForm = instance;
  }
  if (session.documentCategory === 'forms' && !session.genericForm && !['navmc_10274', 'navmc_118_11'].includes(session.formType)) throw new Error('Missing form definition');
  // Historical built-in drafts may omit fields; loadFormSession fills their defaults.
  return session as SerializedSession;
}
