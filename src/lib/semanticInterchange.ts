import { z } from 'zod';
import { parsePortableActionPackage } from './actionPackageTransfer';
import { getPackageRevision } from './actionPackages';
import { parsePortableDraft } from './draftFile';
import { calculateLabels } from '@/services/latex/paragraphLabels';
import { canonicalReviewPayload } from './reviewRounds';
import { portableResourceDigest } from './portableResources';

export const SEMANTIC_INTERCHANGE_VERSION = 1;
export const MAX_INTERCHANGE_BYTES = 101 * 1024 * 1024;
const identifier = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

const provenance = z.object({
  generator: z.literal('DonDocs companion'),
  generatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
}).strict();
const assertions = z.object({
  lifecycle: z.enum(['draft', 'issued', 'superseded', 'withdrawn']),
  issuanceReferences: z.array(z.string().min(1).max(500).refine(value => !!value.trim(), 'Enter a nonblank issuance reference.')).max(30),
}).strict();
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft'), docType: identifier, documentId: z.null(), revisionId: z.null() }).strict(),
  z.object({
    kind: z.literal('package'),
    documentId: identifier,
    revisionId: identifier,
    members: z.array(z.object({
      id: identifier, label: z.string().min(1).max(200), kind: z.enum(['native', 'original', 'attachment']), role: identifier,
    }).strict()).max(100),
  }).strict(),
]);
const block = z.object({ id: identifier, level: z.number().int().min(0).max(10), designator: z.string().nullable() }).strict();
const compatibility = z.object({
  nativeRoundTrip: z.literal('portable-source'),
  semanticIndex: z.enum(['naval-letter-body', 'package-members', 'source-only']),
  omissions: z.array(z.string().min(1).max(240)).max(10),
}).strict();
const portablePayload = z.record(z.string(), z.unknown());

// Keep the admitted JSON tree and the value hashed after schema validation
// equivalent. In particular, Zod omits own prototype keys during parsing.
function assertInterchangeJson(input: unknown) {
  let count = 0;
  function visit(value: unknown, depth: number): void {
    if (++count > 100_000 || depth > 50) throw new Error('The interchange file is too complex.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error('The interchange file must contain ordinary JSON values.');
    }
    if (Object.hasOwn(value, '__proto__')) throw new Error('The interchange file contains an unsupported JSON property.');
    for (const item of Object.values(value)) visit(item, depth + 1);
  }
  visit(input, 0);
}

const content = z.object({
  kind: z.literal('dondocs-semantic-interchange'),
  version: z.literal(SEMANTIC_INTERCHANGE_VERSION),
  provenance,
  authorAssertions: assertions.nullable(),
  source,
  paragraphIndex: z.array(block).max(10_000),
  compatibility,
  payload: portablePayload,
}).strict();
const envelope = content.extend({
  integrity: z.object({ algorithm: z.literal('sha256'), digest }).strict(),
}).strict();

export function semanticInterchangeSchema() {
  return {
    capabilities: { export: ['portable-draft', 'selected-package-revision'], import: [1],
      lifecycleEvidence: 'author-asserted', verification: 'integrity-only' },
    schema: z.toJSONSchema(envelope),
  };
}

async function interchangeDigest(value: z.infer<typeof content>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalReviewPayload(value));
  if (bytes.byteLength > MAX_INTERCHANGE_BYTES) throw new Error('The interchange file exceeds the 101 MB transfer limit.');
  return portableResourceDigest(bytes.buffer);
}

export function parseSemanticJson(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > MAX_INTERCHANGE_BYTES) throw new Error('The interchange file exceeds the 101 MB transfer limit.');
  try { return JSON.parse(text); }
  catch { throw new Error('Choose a valid DonDocs JSON file.'); }
}

async function describePayload(payload: z.infer<typeof content>['payload']): Promise<Pick<z.infer<typeof content>, 'source' | 'paragraphIndex' | 'compatibility'>> {
  if (payload.kind === 'dondocs-action-package') {
    const { record } = await parsePortableActionPackage(JSON.stringify(payload));
    if (record.historyScope !== 'selected-revision' || record.revisions.length !== 1) {
      throw new Error('Export one saved package revision before creating an interchange file.');
    }
    const revision = getPackageRevision(record);
    return {
      source: { kind: 'package', documentId: record.id, revisionId: revision.id,
        members: revision.members.map(({ id, label, kind, role }) => ({ id, label, kind, role })) },
      paragraphIndex: [],
      compatibility: { nativeRoundTrip: 'portable-source', semanticIndex: 'package-members',
        omissions: ['Member contents stay in the portable source. Earlier revisions and working copies are outside the selected export.'] },
    };
  }
  if (payload.kind !== 'dondocs-draft' && (Object.hasOwn(payload, 'kind') || payload.version !== '1.1')) {
    throw new Error('Export a portable DonDocs draft or a selected package revision first.');
  }
  const { session } = await parsePortableDraft(payload, false, true);
  const letter = session.documentCategory === 'correspondence' && session.docType === 'naval_letter'
    && session.paragraphs.every(paragraph => paragraph.level < 8);
  const labels = letter ? calculateLabels(session.paragraphs, false, false) : [];
  return {
    source: { kind: 'draft', docType: session.docType, documentId: null, revisionId: null },
    paragraphIndex: letter ? session.paragraphs.map(({ id, level }, index) => ({
      id: paragraphId(id), level, designator: labels[index] || null,
    })) : [],
    compatibility: { nativeRoundTrip: 'portable-source', semanticIndex: letter ? 'naval-letter-body' : 'source-only',
      omissions: ['Portable drafts omit workspace document and revision IDs.',
        ...(letter ? [] : ['This draft is preserved in the portable source without a semantic body index.'])] },
  };
}

function paragraphId(id: string | undefined): string {
  if (!id) throw new Error('A naval letter paragraph has no stable identity.');
  return id;
}

export async function createSemanticInterchange(
  input: unknown, generatorVersion: string, authorAssertions?: unknown,
): Promise<z.infer<typeof envelope>> {
  assertInterchangeJson(input);
  const payload = structuredClone(portablePayload.parse(input));
  if (authorAssertions !== undefined) assertInterchangeJson(authorAssertions);
  const authored = assertions.nullable().parse(authorAssertions ?? null);
  const description = await describePayload(payload);
  const owned = content.parse({
    kind: 'dondocs-semantic-interchange', version: SEMANTIC_INTERCHANGE_VERSION,
    provenance: { generator: 'DonDocs companion', generatorVersion },
    authorAssertions: authored,
    ...description, payload,
  });
  return { ...owned, integrity: { algorithm: 'sha256', digest: await interchangeDigest(owned) } };
}

export async function openSemanticInterchange(input: unknown): Promise<z.infer<typeof envelope>> {
  if (input && typeof input === 'object' && 'version' in input && input.version !== SEMANTIC_INTERCHANGE_VERSION) {
    throw new Error('This semantic interchange version is unsupported.');
  }
  assertInterchangeJson(input);
  const parsed = envelope.parse(input);
  const { integrity, ...owned } = { ...parsed, payload: structuredClone(parsed.payload) };
  if (await interchangeDigest(owned) !== integrity.digest) throw new Error('The semantic interchange digest does not match its contents.');
  const description = await describePayload(owned.payload);
  const { source, paragraphIndex, compatibility } = owned;
  if (canonicalReviewPayload({ source, paragraphIndex, compatibility }) !== canonicalReviewPayload(description)) {
    throw new Error('The semantic index does not match the portable DonDocs source.');
  }
  return { ...owned, integrity };
}
