import { directiveFields } from './directiveFields';
import { publicationVolumeSchema, validatePublicationVolume, VOLUME_DOC_TYPE } from './publicationVolume';
import { sl4Schema } from '@/data/techpub/sl4';
import { enclosureMarkingSchema } from './enclosureMarkings';
import { requiresCurrentDocumentReader, requiresExtendedCorrespondenceReader, correspondenceReaderRequirement } from './documentReaderRequirements';
import { jointAdditionalCommandsSchema } from './jointLetterCommands';
import { additionalEndorsementsSchema } from './endorsementValidation';
import { sl3Schema } from '@/data/techpub/sl3';
import { z } from 'zod';
import { bodyTableSchema, hasRichBody, assertRichBlockShape } from './bodyTable';
import { reviewCommentsSchema, hasReviewComments } from './reviewComments';
import { parseFormInstance } from '@/services/forms/model';
import type { SerializedSession } from '@/stores/documentStore';
import { projectSharedSession } from './documentSerialization';
import { DOC_TYPE_LABELS } from '@/types/document';
import { ensureParagraphIds, paragraphCommentIds, paragraphIdSchema } from './paragraphIdentity';

const signature = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).optional() });
const form = z.record(z.string(), z.union([z.string(), z.array(signature)]))
  .refine(fields => Object.entries(fields).every(([key, value]) => key === 'signatureBlocks' ? Array.isArray(value) : typeof value === 'string'), 'Invalid built-in form fields');
export const sessionSchema = z.object({
  reviewComments: reviewCommentsSchema.optional(),
  documentMode: z.enum(['compliant', 'custom']),
  documentCategory: z.enum(['correspondence', 'forms']).default('correspondence'),
  docType: z.string().refine((v) => Object.hasOwn(DOC_TYPE_LABELS, v)),
  formType: z.string().default('navmc_10274'),
  genericForm: z.unknown().optional(),
  formData: z.record(z.string(), z.unknown()).superRefine((data, context) => {
    const administrative = directiveFields.safeParse(data);
    if (!administrative.success) {
      for (const issue of administrative.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
    if (data.cuiTransmittalNote !== undefined && typeof data.cuiTransmittalNote !== 'boolean') context.addIssue({
      code: 'custom', path: ['cuiTransmittalNote'], message: 'Invalid CUI transmittal confirmation',
    });
  }),
  paragraphs: z.array(z.object({ id: paragraphIdSchema.optional(), volumeSectionId: paragraphIdSchema.optional(), text: z.string(), bodyTable: bodyTableSchema.optional(), level: z.number().int().min(0).max(10), header: z.string().optional(), portionMarking: z.string().optional(),
    tableKey: z.string().optional(), tableIdentifierMode: z.enum(['stock', 'software']).optional(), callout: z.enum(['warning', 'caution', 'note']).optional(), procedure: z.boolean().optional(), appendix: z.boolean().optional(),
    referenceId: z.string().optional(), publicationSection: z.string().optional(), tableFootnotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    figure: z.object({ name: z.string().optional(), type: z.string().optional(), width: z.number().optional(), height: z.number().optional(), portionMarking: z.string().optional(), placement: z.literal('body').optional(), altText: z.string().max(2_000).optional() }).optional(),
  }).superRefine((paragraph, context) => {
    try { assertRichBlockShape(paragraph); }
    catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid rich body block.' }); }
  })),
  references: z.array(z.object({ letter: z.string(), title: z.string(), url: z.string().optional() })),
  enclosures: z.array(z.object({ title: z.string(), marking: enclosureMarkingSchema.optional(), pageStyle: z.string().optional(), hasCoverPage: z.boolean().optional(), coverPageDescription: z.string().optional() })),
  copyTos: z.array(z.object({ text: z.string() })),
  endItems: z.array(z.object({ nsn: z.string(), tamcn: z.string(), id: z.string(), model: z.string() })).default([]),
  publicationTables: z.record(z.string(), z.array(z.object({ values: z.record(z.string(), z.string()), level: z.number().optional(), identificationException: z.string().optional(), openPurchase: z.object({ manufacturer: z.string(), address: z.string() }).optional() }))).default({}),
  distributions: z.array(z.object({ text: z.string() })).default([]),
  forms: z.object({ navmc10274: form.optional(), navmc11811: form.optional(), includeCoverPage: z.boolean().default(true) }).optional(),
  timestamp: z.number().default(0),
});

export type SharedDocumentKind = 'correspondence' | 'builtin-form' | 'configured-form';
const sharedKind = z.enum(['correspondence', 'builtin-form', 'configured-form']);
const envelope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dondocs-share'), version: z.union([z.literal(1), z.literal(2)]), documentKind: sharedKind }),
  z.object({ kind: z.literal('dondocs-draft'), version: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]), documentKind: sharedKind })
    .refine(value => value.version !== 3 || value.documentKind === 'configured-form'),
]);
const expiringEnvelope = z.object({
  kind: z.literal('dondocs-share'), version: z.literal(3), documentKind: sharedKind,
  expiresAt: z.number().int().positive().max(8_640_000_000_000_000), session: z.unknown(),
}).strict();
type OrdinaryShare = SerializedSession & { kind: 'dondocs-share'; version: 1 | 2; documentKind: SharedDocumentKind };
type ExpiringShare = { kind: 'dondocs-share'; version: 3; documentKind: SharedDocumentKind; expiresAt: number; session: SerializedSession };
// Version 6 belongs to asset shares; current structured text shares use 7.
type RichShare = { kind: 'dondocs-share'; version: 5 | 7 | 9 | 11 | 13; documentKind: SharedDocumentKind; expiresAt?: number; session: SerializedSession };
const richShareEnvelope = z.object({ kind: z.literal('dondocs-share'), version: z.union([z.literal(5), z.literal(7), z.literal(9), z.literal(11), z.literal(13)]), documentKind: sharedKind, expiresAt: z.number().optional(), session: z.unknown() }).strict();

/** UTC epoch milliseconds; the receiving device rejects at the exact deadline. */
export function validateShareExpiration(expiresAt: number, now = Date.now()): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 8_640_000_000_000_000) throw new Error('This share link has an invalid expiration.');
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('Check this device’s date and time before opening the link.');
  if (now >= expiresAt) throw new Error('This share link has expired. Ask the sender for a new link.');
}
function documentKind(session: SerializedSession): SharedDocumentKind {
  return session.documentCategory === 'forms' ? (session.genericForm ? 'configured-form' : 'builtin-form') : 'correspondence';
}

/** Keep legacy envelopes for unchanged documents; new layouts require a reader that preserves them. */
export function createSharedPayload(session: SerializedSession): OrdinaryShare | RichShare;
export function createSharedPayload(session: SerializedSession, expiresAt: number): ExpiringShare | (RichShare & { expiresAt: number });
export function createSharedPayload(session: SerializedSession, expiresAt?: number): OrdinaryShare | ExpiringShare | RichShare {
  const owned = projectSharedSession(parseSharedSession(session));
  if (hasRichBody(owned) || requiresCurrentDocumentReader(owned) || requiresExtendedCorrespondenceReader(owned)) {
    if (expiresAt !== undefined) validateShareExpiration(expiresAt);
    return { kind: 'dondocs-share', version: correspondenceReaderRequirement(owned)?.share ?? (requiresCurrentDocumentReader(owned) ? 7 : 5), documentKind: documentKind(owned), session: owned, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }
  if (expiresAt !== undefined) {
    validateShareExpiration(expiresAt);
    // Nest required document fields so readers predating versioned envelopes
    // cannot accept the document while silently discarding the deadline.
    return { kind: 'dondocs-share', version: 3, documentKind: documentKind(owned), expiresAt, session: owned };
  }
  return { ...owned, kind: 'dondocs-share', version: hasReviewComments(owned) ? 2 : 1, documentKind: documentKind(owned) };
}

/** Validate before touching the recipient's current document. */
export function parseSharedSession(value: unknown): SerializedSession {
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'dondocs-share' && 'version' in value && (value.version === 5 || value.version === 7 || value.version === 9 || value.version === 11 || value.version === 13)) {
    const envelope = richShareEnvelope.parse(value);
    if (envelope.expiresAt !== undefined) validateShareExpiration(envelope.expiresAt);
    const raw = envelope.session;
    if (!raw || typeof raw !== 'object' || ['kind', 'documentKind', 'expiresAt', 'version'].some(key => key in raw)) throw new Error('This rich share format is unsupported.');
    const session = parseSharedSession(raw);
    const required = correspondenceReaderRequirement(session);
    if (required && envelope.version < required.share) throw new Error(`These document features require a version ${required.share} share.`);
    if (documentKind(session) !== envelope.documentKind) throw new Error('The shared document kind does not match its contents.');
    return session;
  }
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'dondocs-share' && 'version' in value && value.version === 3) {
    const parsed = expiringEnvelope.safeParse(value);
    if (!parsed.success) throw new Error('This share link has an invalid expiration or unsupported format.');
    validateShareExpiration(parsed.data.expiresAt);
    const source = parsed.data.session;
    // Only one envelope is allowed. Avoid recursive or hidden restrictions.
    if (!source || typeof source !== 'object' || ['kind', 'documentKind', 'expiresAt', 'version'].some(key => key in source)) throw new Error('This share format is unsupported.');
    const session = parseSharedSession(source);
    const required = correspondenceReaderRequirement(session);
    if (required) throw new Error(`These document features require a version ${required.share} share.`);
    if (parsed.data.documentKind !== documentKind(session)) throw new Error('The shared document kind does not match its contents.');
    validateShareExpiration(parsed.data.expiresAt);
    return session;
  }
  if (value && typeof value === 'object' && 'expiresAt' in value) throw new Error('Expiration requires a version 3 share link. Ask the sender for a new link.');
  const metadata = value && typeof value === 'object' && ('kind' in value || 'documentKind' in value) ? envelope.safeParse(value) : undefined;
  if (metadata && !metadata.success) throw new Error('This share format is unsupported. Update DonDocs and ask the sender to create a compatible link.');
  const result = sessionSchema.safeParse(structuredClone(value));
  if (!result.success) throw new Error('This link does not contain a supported DonDocs document.');
  const s = result.data;
  const required = correspondenceReaderRequirement(s);
  const draftVersion = metadata?.success && metadata.data.kind === 'dondocs-draft' ? metadata.data.version : 0;
  if (required && value && typeof value === 'object' && 'version' in value && draftVersion < required.draft) {
    throw new Error(`These document features require a version ${required.draft} draft or version ${required.share} share.`);
  }
  if (!s.reviewComments?.threads.length) delete s.reviewComments;
  if (hasReviewComments(s) && metadata?.success && metadata.data.version === 1) {
    throw new Error('Comments require a version 2 review-aware share. Ask the sender to create a current copy.');
  }
  s.paragraphs = ensureParagraphIds(s.paragraphs, paragraphCommentIds(s.reviewComments));
  if (s.formData.stationerySize !== undefined) s.formData.stationerySize = z.enum(['letter', '7x9', '5x7']).parse(s.formData.stationerySize);
  if (s.formData.letterheadMode !== undefined) s.formData.letterheadMode = z.enum(['full', 'title-only', 'preprinted']).parse(s.formData.letterheadMode);
  if (s.formData.signatureImageSigner !== undefined) s.formData.signatureImageSigner = z.enum(['junior', 'senior']).parse(s.formData.signatureImageSigner);
  if (s.formData.jointAdditionalCommands !== undefined) s.formData.jointAdditionalCommands = jointAdditionalCommandsSchema.parse(s.formData.jointAdditionalCommands);
  if (s.formData.additionalEndorsements !== undefined) s.formData.additionalEndorsements = additionalEndorsementsSchema.parse(s.formData.additionalEndorsements);
  if (s.docType === VOLUME_DOC_TYPE) s.formData.volume = validatePublicationVolume(s.formData.volume, s.paragraphs);
  else if (s.formData.volume !== undefined) s.formData.volume = publicationVolumeSchema.parse(s.formData.volume);
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

/** Older readers reject comment-bearing drafts instead of silently removing review data. */
export function draftEnvelope(session: SerializedSession) {
  const required = correspondenceReaderRequirement(session);
  if (required) return { kind: 'dondocs-draft' as const, version: required.draft, documentKind: documentKind(session) };
  if (requiresCurrentDocumentReader(session)) return { kind: 'dondocs-draft' as const, version: 5 as const, documentKind: documentKind(session) };
  if (hasRichBody(session)) return { kind: 'dondocs-draft' as const, version: 4 as const, documentKind: documentKind(session) };
  return hasReviewComments(session) ? { kind: 'dondocs-draft' as const, version: 2 as const, documentKind: documentKind(session) } : { version: '1.1' };
}
