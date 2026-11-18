import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { renderForm } from '@/services/forms/render';
import { actionPackageSchema, commitActionPackage, newPackageId, packageMemberLabel, type ActionPackage, type NativePackageMember } from './actionPackages';
import { listPackageBindingFields } from './packageBindingTargets';
import { formatPackageFactForField, type PackageFieldBinding } from './packageFieldBindings';
import { packageInformationSchema, type PackageFact } from './packageInformation';
import { validatePackageDraft } from './actionPackageDraft';
import { administrativeRequestWorksheet } from './administrativeRequestWorksheet';
import { portableResourceDigest } from './portableResources';
import { reviewPackageBindings, reviewPackageInformation, reviewPackageNative, reviewPackageText } from './actionPackageDisclosure';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import type { StoredAttachment } from './documentsDb';
import type { ExportReview } from './preparedExport';
import { withAttachmentStaging } from './attachments';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';

const line = z.string().trim().min(1).max(120).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Use a single line.');
export const administrativeRequestSchema = z.object({
  requester: line, organization: line, recipient: line, subject: line.max(100),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => value >= '2000-01-01' && value <= '2099-12-31'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Enter a real date from 2000 through 2099.'),
  ssic: z.string().regex(/^\d{4}$/, 'Enter a four-digit SSIC.'),
  details: z.string().trim().min(1).max(900), signatureName: line,
}).strict();
export type AdministrativeRequestInput = z.infer<typeof administrativeRequestSchema>;
export interface PreparedAdministrativeRequest {
  readonly packageName: string;
  readonly values: Readonly<AdministrativeRequestInput>;
  readonly reviews: readonly ExportReview[];
}
interface Capture { record: ActionPackage; attachments: StoredAttachment[]; policy: string }
const captures = new WeakMap<PreparedAdministrativeRequest, Capture>();

function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  return JSON.stringify(policy.policy);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function freshSession(timestamp: number): SerializedSession {
  return { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter', formType: 'navmc_10274',
    timestamp, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} };
}

/** Own all starter bytes, linked values and declarations without writing package, template or editor storage. */
export async function prepareAdministrativeRequest(
  input: AdministrativeRequestInput, policy: PolicyResolution, signal?: AbortSignal,
): Promise<PreparedAdministrativeRequest> {
  signal?.throwIfAborted();
  const identity = policyIdentity(policy), values = administrativeRequestSchema.parse(input), timestamp = Date.now();
  const requesterId = newPackageId('participant'), recipientId = newPackageId('participant');
  const labels = { requester: 'Requester', organization: 'Organization', recipient: 'Recipient', subject: 'Request subject',
    requestDate: 'Request date', ssic: 'SSIC', details: 'Requested action and justification' };
  const information = packageInformationSchema.parse({ version: 1, participants: [
    { id: requesterId, label: 'Requester', role: 'requester' }, { id: recipientId, label: 'Recipient', role: 'other' },
  ], facts: Object.entries(labels).map(([key, label]) => ({ id: newPackageId('fact'), label,
    kind: key === 'requestDate' ? 'date' : key === 'ssic' ? 'identifier' : 'text', value: values[key as keyof typeof labels],
    ...(['requester', 'organization'].includes(key) ? { participantId: requesterId } : key === 'recipient' ? { participantId: recipientId } : {}), source: { kind: 'entered' } })) });
  const facts = new Map(Object.keys(labels).map((key, index) => [key, information.facts[index]]));
  const attachments: StoredAttachment[] = [];
  async function stage(name: string, type: string, bytes: Uint8Array) {
    const data = new Uint8Array(bytes).buffer;
    const asset = { id: newPackageId('asset'), name, type, size: data.byteLength, sha256: await portableResourceDigest(data) };
    attachments.push({ ...asset, data }); return asset;
  }
  const { definition, bytes } = await administrativeRequestWorksheet();
  signal?.throwIfAborted();
  const form = { ...freshSession(timestamp), documentCategory: 'forms' as const, formType: definition.formId,
    genericForm: { definition, answers: Object.fromEntries(Object.keys(labels).map(key => [key, values[key as keyof typeof labels]])), rows: {}, answerRevision: 0 } };
  // Qualify worksheet glyphs and fit with its actual renderer before creating the action.
  await renderForm(form.genericForm, 'export', async () => new Uint8Array(bytes));
  const letter = freshSession(timestamp);
  const date = values.requestDate.split('-');
  letter.formData = { docType: 'standard_letter', fontFamily: 'times', fontSize: '12pt', pageNumbering: 'simple', classLevel: 'unclassified',
    subject: values.subject.toUpperCase(), from: values.requester, to: values.recipient, via: '', ssic: values.ssic, serial: '',
    date: `${Number(date[2])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(date[1]) - 1]} ${date[0].slice(2)}`,
    sigFirst: '', sigMiddle: '', sigLast: values.signatureName, signatureType: 'none' };
  letter.paragraphs = [{ id: newPackageId('paragraph'), level: 0,
    text: 'Please consider the request described in the accompanying DonDocs request details worksheet.' }];
  const members: NativePackageMember[] = [];
  for (const [session, label, role] of [[letter, 'Request letter', 'basic-letter'], [form, 'DonDocs request details worksheet', 'supporting-document']] as const) {
    signal?.throwIfAborted();
    const draft = { ...session, kind: 'dondocs-draft', version: 2, documentKind: session.documentCategory === 'forms' ? 'configured-form' : 'correspondence' };
    const { session: reviewed } = await validatePackageDraft(draft);
    members.push({ id: newPackageId('member'), revisionId: newPackageId('member-revision'), kind: 'native', label, role, required: true,
      session: reviewed, draft: await stage(`${label}.dondocs.json`, 'application/json', new TextEncoder().encode(JSON.stringify(draft))),
      ...(session.documentCategory === 'forms' ? { templates: { 'page1.pdf': await stage('page1.pdf', 'application/pdf', bytes) } } : {}) });
  }
  const bindings: PackageFieldBinding[] = [];
  const letterFacts: Record<string, string> = { from: 'requester', to: 'recipient', subject: 'subject', date: 'requestDate', ssic: 'ssic' };
  for (const member of members) for (const field of await listPackageBindingFields(member)) {
    const key = field.target.kind === 'configured-form' ? field.target.fieldId : field.target.kind === 'correspondence' ? letterFacts[field.target.field] : undefined;
    const fact: PackageFact | undefined = key ? facts.get(key) : undefined;
    if (!fact) continue;
    const format = field.target.kind === 'correspondence' && field.target.field === 'subject' ? 'uppercase' : 'field';
    const expectedValue = formatPackageFactForField(fact, field, format);
    if (expectedValue !== field.value) throw new Error('A starter field does not match its declared package value.');
    bindings.push({ id: newPackageId('link'), factId: fact.id, memberId: member.id, target: field.target, format, mode: 'linked', expectedValue });
  }
  const revision = { id: newPackageId('revision'), createdAt: timestamp, members, outputs: [], information, bindings: { version: 1 as const, items: bindings } };
  const record = actionPackageSchema.parse({ kind: 'dondocs-action-package-record', version: 1, id: newPackageId('package'),
    name: packageMemberLabel(`Request: ${values.subject}`), archived: false, sequence: 0, currentRevisionId: revision.id, revisions: [revision] });
  const reviews = [reviewPackageText(record.name, 'Package name', policy), reviewPackageInformation(information, policy), reviewPackageBindings(revision.bindings, policy),
    ...members.map(member => reviewPackageNative(member.session, member.label, policy))];
  signal?.throwIfAborted();
  const prepared = freeze({ packageName: record.name, values: structuredClone(values), reviews: structuredClone(reviews) });
  captures.set(prepared, { record, attachments, policy: identity }); return prepared;
}

/** One compare-and-save transaction publishes members, files, facts and links together. */
export async function createPreparedAdministrativeRequest(
  prepared: PreparedAdministrativeRequest, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true,
): Promise<ActionPackage> {
  const captured = captures.get(prepared);
  if (!captured || captured.policy !== policyIdentity(policy)) throw new Error('Prepare and review this request again.');
  if (!reviewed) throw new Error('Review the request details before creating the package.');
  signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('The request details changed. Prepare and review the current values.');
  const identity = captured.policy;
  if (policyIdentity(await getExportDeploymentPolicy()) !== identity) throw new Error('Deployment settings changed. Review this request again.');
  let failure: unknown;
  const current = () => {
    try {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new Error('The request details changed. Prepare and review the current values.');
      if (policyIdentity(getExportDeploymentPolicySync()) !== identity) throw new Error('Deployment settings changed. Review this request again.');
      return true;
    } catch (error) { failure = error; return false; }
  };
  if (!current()) throw failure;
  let record: ActionPackage;
  try { record = await withAttachmentStaging(() => commitActionPackage(null, captured.record, signal, current, captured.attachments)); }
  catch (error) { throw failure ?? error; }
  captures.delete(prepared); return record;
}
