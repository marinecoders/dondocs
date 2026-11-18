import { z } from 'zod';
import { actionPackageSchema, commitActionPackage, getPackageRevision, listActionPackages, newPackageId,
  packageMemberLabel, type ActionPackage, type PackageAsset, type PackageRevision } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { withAttachmentStaging } from './attachments';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { packageSigningHandoffSchema, packageSigningSchema, packageSigningTargetSchema,
  type PackageSigning, type PackageSigningHandoff, type PackageSigningTarget, packageSigningReturnSchema } from './packageSigningModel';
import { createSigningRecord, importSigningRecord, mergeSigningRecordSnapshot, listSigningRecords, validateSigningRecord, type SigningRecord } from './signingWorkspace';
import { inspectSigningPdf } from './manualSignatureFields';
import { packageInputFingerprint } from './packageRenderProvenance';
import { portableResourceDigest } from './portableResources';
import { packageAssemblyInputs, packageReviewContext } from './packageChangeImpactModel';
import type { ExportReview } from './preparedExport';
export * from './packageSigningModel';

const metadataEnvelope = z.object({ kind: z.literal('dondocs-package-signing-record'), version: z.literal(1), record: z.unknown() }).strict();
type ReadAsset = typeof readPackageAsset;
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value;
}
function metadataText(input: SigningRecord): string {
  const strings: string[] = [];
  function collect(value: unknown, key?: string): void {
    if (key === 'data') return;
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(item => collect(item));
    else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) collect(child, name);
  }
  collect(input); return strings.join('\n');
}
function editable(input: ActionPackage, revisionId: string): ActionPackage {
  const record = actionPackageSchema.parse(structuredClone(input));
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined) || revisionId !== record.currentRevisionId)
    throw new Error('Open the current, unarchived owning package before preparing a signing handoff.');
  return record;
}
function policyKey(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy); return JSON.stringify(policy.policy);
}
async function guard(before: ActionPackage, policy: PolicyResolution, signal: AbortSignal | undefined, isCurrent: () => boolean) {
  const key = policyKey(policy), fresh = await getExportDeploymentPolicy();
  if (policyKey(fresh) !== key) throw new Error('Deployment settings changed. Review the package signing operation again.');
  signal?.throwIfAborted();
  if (!isCurrent() || !(await listActionPackages()).some(record => sameReviewStoredValue(record, before)))
    throw new Error('The package changed. Reopen and review the exact signing source again.');
  return () => {
    signal?.throwIfAborted();
    const current = getExportDeploymentPolicySync(); return isCurrent() && current.status === 'ready' && JSON.stringify(current.policy) === key;
  };
}
export async function packageSigningContextFingerprint(revision: PackageRevision): Promise<string> {
  // Keep pre-profile captures stable when the assembly helper starts returning a profile wrapper.
  const captured: unknown = packageAssemblyInputs(revision);
  const wrapped = captured && typeof captured === 'object' && !Array.isArray(captured) && 'members' in captured ? captured : undefined;
  const inputs = wrapped ? wrapped.members : captured;
  const assembly = wrapped && 'assembly' in wrapped ? wrapped.assembly : undefined;
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify({ inputs, context: packageReviewContext(revision),
    ...(assembly === undefined ? {} : { assembly }) })).buffer);
}
export function packageSigningTargets(revision: PackageRevision): Array<{ target: PackageSigningTarget; label: string }> {
  return [
    ...revision.outputs.map((output, index) => ({ target: { kind: 'output' as const, id: output.id }, label: `Saved PDF ${index + 1}: ${output.asset.name}` })),
    ...revision.members.flatMap(member => member.kind === 'original' && !member.signedOriginal
      ? [{ target: { kind: 'member' as const, id: member.id, revisionId: member.revisionId }, label: `Original PDF: ${member.label}` }] : []),
  ];
}
function targetAsset(revision: PackageRevision, input: PackageSigningTarget): PackageAsset {
  const target = packageSigningTargetSchema.parse(input);
  if (target.kind === 'output') {
    const output = revision.outputs.find(item => item.id === target.id);
    if (output) return output.asset;
  } else {
    const member = revision.members.find(item => item.id === target.id && item.revisionId === target.revisionId);
    if (member?.kind === 'original' && !member.signedOriginal) return member.original;
  }
  throw new Error('That exact unsigned PDF is not available in this saved revision. Native documents need a retained PDF first.');
}
async function assertTargetProvenance(revision: PackageRevision, target: PackageSigningTarget): Promise<void> {
  if (target.kind !== 'output') return;
  const output = revision.outputs.find(item => item.id === target.id);
  if (!output?.provenance || output.provenance.inputSha256 !== await packageInputFingerprint(revision))
    throw new Error('Retain a new PDF from this exact revision before preparing package signing. Its saved input association is unavailable or inconsistent.');
}
export interface PreparedPackageSigningSource { readonly filename: string; readonly sourceSha256: string; readonly reviews: readonly ExportReview[] }
const sourcePlans = new WeakMap<PreparedPackageSigningSource, { before: ActionPackage; revisionId: string; target: PackageSigningTarget; asset: PackageAsset; bytes: ArrayBuffer; policy: string }>();
export async function preparePackageSigningSource(input: ActionPackage, revisionId: string, targetInput: PackageSigningTarget,
  policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageSigningSource> {
  signal?.throwIfAborted();
  const before = editable(input, revisionId), target = packageSigningTargetSchema.parse(structuredClone(targetInput)), asset = targetAsset(getPackageRevision(before), target);
  const key = policyKey(policy); await assertTargetProvenance(getPackageRevision(before), target);
  const bytes = await readPackageAsset(asset);
  await inspectSigningPdf(new Uint8Array(bytes)); signal?.throwIfAborted();
  const reviews = [reviewPackageText(`${before.name}\n${asset.name}`, 'Package signing source', policy), await reviewPackageOriginal(bytes, asset.name, policy)];
  signal?.throwIfAborted();
  const result = frozen({ filename: asset.name, sourceSha256: asset.sha256, reviews });
  sourcePlans.set(result, { before, revisionId, target, asset, bytes, policy: key }); return result;
}
export async function openPackageSigningSource(prepared: PreparedPackageSigningSource, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true, existingRecordId?: string): Promise<SigningRecord> {
  const captured = sourcePlans.get(prepared);
  if (!captured || reviewed !== true || policyKey(policy) !== captured.policy) throw new Error('Review the captured package PDF before opening the signing workspace.');
  const current = await guard(captured.before, policy, signal, isCurrent);
  if (existingRecordId) {
    const existing = (await listSigningRecords()).find(record => record.id === existingRecordId);
    if (!existing || existing.source.sha256 !== captured.asset.sha256) throw new Error('The selected signing record no longer matches this exact PDF. Refresh the saved handoffs.');
    if (!current()) throw new Error('This signing operation is no longer current.');
    return existing;
  }
  return createSigningRecord(new Uint8Array(captured.bytes), captured.asset.name, current);
}
export interface PreparedPackageSigningHandoff { readonly filename: string; readonly handoffId: string; readonly signers: readonly string[]; readonly reviews: readonly ExportReview[] }
const handoffPlans = new WeakMap<PreparedPackageSigningHandoff, { before: ActionPackage; revisionId: string; target: PackageSigningTarget;
  source: PackageAsset; record: SigningRecord; contextSha256: string; policy: string }>();
export async function preparePackageSigningHandoff(input: ActionPackage, revisionId: string, targetInput: PackageSigningTarget,
  recordInput: SigningRecord, handoffId: string, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageSigningHandoff> {
  signal?.throwIfAborted();
  const before = editable(input, revisionId), target = packageSigningTargetSchema.parse(structuredClone(targetInput));
  const source = targetAsset(getPackageRevision(before), target), key = policyKey(policy);
  await assertTargetProvenance(getPackageRevision(before), target);
  const full = await validateSigningRecord(structuredClone(recordInput));
  if (!(await listSigningRecords()).some(item => sameReviewStoredValue(item, full))) throw new Error('Open a saved signing record before capturing its handoff.');
  if (full.source.sha256 !== source.sha256) throw new Error('This signing handoff belongs to a different exact package PDF.');
  const handoff = full.handoffs?.find(item => item.id === handoffId);
  if (!handoff) throw new Error('Choose an exact saved signing handoff.');
  if (getPackageRevision(before).signing?.handoffs.some(item => item.handoffId === handoffId && item.signingRecordId === full.id))
    throw new Error('This signing handoff is already captured in the package.');
  await readPackageAsset(source);
  const record = await validateSigningRecord({ ...full, fields: handoff.fields, handoffs: [handoff], returns: undefined });
  const reviews = [reviewPackageText(metadataText(record), 'Exact package signing assignments and retained metadata', policy),
    await reviewPackageOriginal(base64ToUint8Array(record.source.data).buffer as ArrayBuffer, record.source.filename, policy),
    await reviewPackageOriginal(base64ToUint8Array(handoff.pdf.data).buffer as ArrayBuffer, handoff.pdf.filename, policy)];
  signal?.throwIfAborted();
  const result = frozen({ filename: handoff.pdf.filename, handoffId, signers: [...record.source.existingSignatureNames ?? [], ...handoff.fields.map(item => item.signer)], reviews });
  handoffPlans.set(result, { before, revisionId, target, source, record, contextSha256: await packageSigningContextFingerprint(getPackageRevision(before)), policy: key }); return result;
}
async function stageSigningAsset(name: string, type: string, data: ArrayBuffer): Promise<{ asset: PackageAsset; attachment: StoredAttachment }> {
  const asset = { id: newPackageId('asset'), name, type, size: data.byteLength, sha256: await portableResourceDigest(data) };
  return { asset, attachment: { ...asset, data } };
}
async function retainMetadata(record: SigningRecord, source: PackageAsset, handoff: PackageAsset, returned?: PackageAsset) {
  const copy = structuredClone(record); copy.source.data = `package-asset:${source.id}`; copy.handoffs![0].pdf.data = `package-asset:${handoff.id}`;
  if (returned && copy.returns?.length === 1) copy.returns[0].pdf.data = `package-asset:${returned.id}`;
  const data = new TextEncoder().encode(JSON.stringify({ kind: 'dondocs-package-signing-record', version: 1, record: copy })).buffer;
  if (data.byteLength > 128 * 1024) throw new Error('Package signing metadata exceeds the 128 KB record limit.');
  return stageSigningAsset('Package signing record.json', 'application/json', data);
}
export async function capturePackageSigningHandoff(prepared: PreparedPackageSigningHandoff, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const captured = handoffPlans.get(prepared);
  if (!captured || reviewed !== true || policyKey(policy) !== captured.policy) throw new Error('Review the exact signing handoff and assignments before saving them to the package.');
  const current = await guard(captured.before, policy, signal, isCurrent);
  return withAttachmentStaging(async () => {
    const snapshot = captured.record, handoff = snapshot.handoffs![0];
    const stagedHandoff = await stageSigningAsset(handoff.pdf.filename, 'application/pdf', base64ToUint8Array(handoff.pdf.data).buffer as ArrayBuffer);
    const stagedMetadata = await retainMetadata(snapshot, captured.source, stagedHandoff.asset), before = captured.before, original = getPackageRevision(before);
    const handoffAsset = stagedHandoff.asset, recordAsset = stagedMetadata.asset;
    const entry = packageSigningHandoffSchema.parse({ id: newPackageId('signing'), packageId: before.id, sourceRevisionId: captured.revisionId,
      target: captured.target, sourceSha256: captured.source.sha256, contextSha256: captured.contextSha256,
      signingRecordId: snapshot.id, handoffId: handoff.id, createdAt: Date.now(), recordAsset,
      pdfs: { source: captured.source, handoff: handoffAsset }, metadataText: metadataText(snapshot), signers: prepared.signers });
    const signing = packageSigningSchema.parse({ version: 1, handoffs: [...original.signing?.handoffs ?? [], entry] });
    const revision: PackageRevision = { ...structuredClone(original), id: newPackageId('revision'), parentId: original.id, createdAt: Date.now(), outputs: [], signing };
    const result = await commitActionPackage(before, { ...before, sequence: before.sequence + 1, currentRevisionId: revision.id, revisions: [...before.revisions, revision] }, signal, current, [stagedHandoff.attachment, stagedMetadata.attachment]);
    handoffPlans.delete(prepared); return result;
  });
}
export async function readPackageSigningRecord(entryInput: PackageSigningHandoff, read: ReadAsset = readPackageAsset, returnId?: string): Promise<SigningRecord> {
  const entry = packageSigningHandoffSchema.parse(structuredClone(entryInput));
  const returned = returnId ? entry.returns?.find(item => item.id === returnId) : undefined;
  if (returnId && !returned) throw new Error('That exact captured signing return is unavailable.');
  const bytes = await read(returned?.recordAsset ?? entry.recordAsset);
  if (bytes.byteLength > 128 * 1024) throw new Error('Package signing metadata exceeds the 128 KB record limit.');
  const envelope = metadataEnvelope.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const record = envelope.record as SigningRecord;
  if (!record || typeof record !== 'object' || record.source?.data !== `package-asset:${entry.pdfs.source.id}`
    || record.handoffs?.length !== 1 || record.handoffs[0].pdf?.data !== `package-asset:${entry.pdfs.handoff.id}`
    || (returned ? record.returns?.length !== 1 || record.returns[0].pdf.data !== `package-asset:${returned.returnedAsset.id}` : !!record.returns?.length))
    throw new Error('The package signing record has unbound PDF data.');
  const [source, handoff] = await Promise.all([read(entry.pdfs.source), read(entry.pdfs.handoff)]);
  record.source.data = uint8ArrayToBase64(new Uint8Array(source)); record.handoffs[0].pdf.data = uint8ArrayToBase64(new Uint8Array(handoff));
  if (returned) record.returns![0].pdf.data = uint8ArrayToBase64(new Uint8Array(await read(returned.returnedAsset)));
  const valid = await validateSigningRecord(record);
  if (valid.id !== entry.signingRecordId || valid.handoffs![0].id !== entry.handoffId || valid.source.sha256 !== entry.sourceSha256
    || valid.handoffs![0].pdf.sha256 !== entry.pdfs.handoff.sha256 || metadataText(valid) !== (returned?.metadataText ?? entry.metadataText)
    || returned && (valid.returns![0].id !== returned.signingReturnId || valid.returns![0].pdf.sha256 !== returned.returnedAsset.sha256 || valid.returns![0].evidence.assessment !== returned.assessment)
    || !sameReviewStoredValue(entry.signers, [...valid.source.existingSignatureNames ?? [], ...valid.handoffs![0].fields.map(field => field.signer)]))
    throw new Error('The package signing metadata does not match its retained exact record.');
  return valid;
}
export async function validatePackageSigningResources(signing: PackageSigning, read: ReadAsset = readPackageAsset, revisions: readonly PackageRevision[] = []): Promise<void> {
  for (const entry of signing.handoffs) {
    await readPackageSigningRecord(entry, read);
    for (const returned of entry.returns ?? []) await readPackageSigningRecord(entry, read, returned.id);
    const source = revisions.find(revision => revision.id === entry.sourceRevisionId);
    if (source) {
      if (await packageSigningContextFingerprint(source) !== entry.contextSha256)
        throw new Error('The signing handoff context does not match its captured package revision.');
      if (!sameReviewStoredValue(targetAsset(source, entry.target), entry.pdfs.source))
        throw new Error('The exact signing source does not match its captured revision.');
      await assertTargetProvenance(source, entry.target);
    }
  }
}
export async function reviewPackageSigning(signing: PackageSigning, policy: PolicyResolution, read: ReadAsset = readPackageAsset): Promise<ExportReview[]> {
  const reviews: ExportReview[] = [];
  for (const entry of signing.handoffs) {
    const record = await readPackageSigningRecord(entry, read), handoff = record.handoffs![0];
    reviews.push(reviewPackageText(metadataText(record), 'Retained package signing assignments', policy),
      await reviewPackageOriginal(base64ToUint8Array(record.source.data).buffer as ArrayBuffer, record.source.filename, policy),
      await reviewPackageOriginal(base64ToUint8Array(handoff.pdf.data).buffer as ArrayBuffer, handoff.pdf.filename, policy));
    for (const returned of entry.returns ?? []) {
      const snapshot = await readPackageSigningRecord(entry, read, returned.id), pdf = snapshot.returns![0].pdf;
      reviews.push(reviewPackageText(metadataText(snapshot), 'Retained package signing return', policy),
        await reviewPackageOriginal(base64ToUint8Array(pdf.data).buffer as ArrayBuffer, pdf.filename, policy));
    }
  }
  return reviews;
}
export async function getPackageSigningPdf(entry: PackageSigningHandoff, read: ReadAsset = readPackageAsset, returnId?: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const record = await readPackageSigningRecord(entry, read, returnId), pdf = returnId ? record.returns![0].pdf : record.handoffs![0].pdf;
  return { bytes: base64ToUint8Array(pdf.data), filename: pdf.filename };
}

/** Reopen a captured portable record without replacing a newer local signing history. */
export async function openCapturedPackageSigningRecord(entry: PackageSigningHandoff, policy: PolicyResolution,
  reviewed: boolean, signal?: AbortSignal, isCurrent: () => boolean = () => true, returnId?: string): Promise<SigningRecord> {
  if (reviewed !== true) throw new Error('Review the exact retained signing record before opening it.');
  const key = policyKey(policy), captured = await readPackageSigningRecord(entry, readPackageAsset, returnId);
  await reviewPackageSigning({ version: 1, handoffs: [entry] }, policy);
  const fresh = await getExportDeploymentPolicy();
  if (policyKey(fresh) !== key) throw new Error('Deployment settings changed. Review this signing record again.');
  const current = () => { signal?.throwIfAborted(); const active = getExportDeploymentPolicySync(); return isCurrent() && active.status === 'ready' && JSON.stringify(active.policy) === key; };
  if (!current()) throw new Error('This signing operation is no longer current.');
  const local = (await listSigningRecords()).find(record => record.id === captured.id);
  if (local) return mergeSigningRecordSnapshot(local, captured, current);
  return importSigningRecord(captured, current);
}

export function copyPreparedPackageSigningSource(prepared: PreparedPackageSigningSource): Uint8Array {
  const captured = sourcePlans.get(prepared);
  if (!captured) throw new Error('Reopen the captured signing source.');
  return new Uint8Array(captured.bytes.slice(0));
}
export function copyPreparedPackageSigningHandoff(prepared: PreparedPackageSigningHandoff): Uint8Array {
  const captured = handoffPlans.get(prepared);
  if (!captured) throw new Error('Review the exact signing handoff again.');
  return base64ToUint8Array(captured.record.handoffs![0].pdf.data);
}

export interface PreparedPackageSigningReturn {
  readonly filename: string; readonly assessment: 'unchanged' | 'checks-agree' | 'different' | 'inconclusive';
  readonly handoffId: string; readonly preservesCurrentMembers: true; readonly reviews: readonly ExportReview[];
}
const returnPlans = new WeakMap<PreparedPackageSigningReturn, { before: ActionPackage; entryId: string; snapshot: SigningRecord; policy: string }>();
/** The signing workspace has already compared and associated the return. Package adoption is a separate reviewed decision. */
export async function preparePackageSigningReturn(input: ActionPackage, entryId: string, signingInput: SigningRecord, signingReturnId: string,
  policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageSigningReturn> {
  signal?.throwIfAborted();
  const before = editable(input, input.currentRevisionId), entry = getPackageRevision(before).signing?.handoffs.find(item => item.id === entryId), key = policyKey(policy);
  if (!entry) throw new Error('Choose an exact handoff captured by this package before reviewing a return.');
  const full = await validateSigningRecord(structuredClone(signingInput)), captured = await readPackageSigningRecord(entry);
  if (!(await listSigningRecords()).some(item => sameReviewStoredValue(item, full))) throw new Error('Open the saved associated return in the signing workspace before adopting it.');
  if (full.id !== captured.id || full.source.sha256 !== captured.source.sha256 || !full.handoffs?.some(handoff => sameReviewStoredValue(handoff, captured.handoffs![0])))
    throw new Error('The return does not belong to this exact package signing handoff.');
  const returned = full.returns?.find(item => item.id === signingReturnId && item.handoffId === entry.handoffId);
  if (!returned) throw new Error('Choose a returned file already associated with this exact handoff.');
  if (entry.returns?.some(item => item.signingReturnId === returned.id || item.returnedAsset.sha256 === returned.pdf.sha256))
    throw new Error('This exact returned PDF is already captured by the package.');
  const snapshot = await validateSigningRecord({ ...full, fields: captured.handoffs![0].fields, handoffs: captured.handoffs, returns: [returned] });
  const reviews = [reviewPackageText(metadataText(snapshot), 'Returned package signing metadata and association decision', policy),
    await reviewPackageOriginal(base64ToUint8Array(snapshot.handoffs![0].pdf.data).buffer as ArrayBuffer, snapshot.handoffs![0].pdf.filename, policy),
    await reviewPackageOriginal(base64ToUint8Array(returned.pdf.data).buffer as ArrayBuffer, returned.pdf.filename, policy)];
  signal?.throwIfAborted();
  const prepared = frozen({ filename: returned.pdf.filename, assessment: returned.evidence.assessment, handoffId: returned.handoffId, preservesCurrentMembers: true as const, reviews });
  returnPlans.set(prepared, { before, entryId, snapshot, policy: key }); return prepared;
}
export function copyPreparedPackageSigningReturn(prepared: PreparedPackageSigningReturn): Uint8Array {
  const captured = returnPlans.get(prepared);
  if (!captured) throw new Error('Review the exact package signing return again.');
  return base64ToUint8Array(captured.snapshot.returns![0].pdf.data);
}
export async function applyPackageSigningReturn(prepared: PreparedPackageSigningReturn, policy: PolicyResolution,
  decision: { reviewed: boolean; acceptedMismatch: boolean }, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  decision = { reviewed: decision.reviewed === true, acceptedMismatch: decision.acceptedMismatch === true };
  const captured = returnPlans.get(prepared);
  if (!captured || !decision.reviewed || policyKey(policy) !== captured.policy) throw new Error('Review the captured signing return before adding it to the package.');
  if (prepared.assessment !== 'checks-agree' && !decision.acceptedMismatch) throw new Error('Explicitly acknowledge the unchanged, differing or inconclusive return before adding it.');
  const current = await guard(captured.before, policy, signal, isCurrent);
  return withAttachmentStaging(async () => {
    const before = captured.before, original = getPackageRevision(before), entry = original.signing!.handoffs.find(item => item.id === captured.entryId)!;
    const returned = captured.snapshot.returns![0], stagedPdf = await stageSigningAsset(returned.pdf.filename, 'application/pdf', base64ToUint8Array(returned.pdf.data).buffer as ArrayBuffer);
    const stagedMetadata = await retainMetadata(captured.snapshot, entry.pdfs.source, entry.pdfs.handoff, stagedPdf.asset);
    const revisionId = newPackageId('revision'), memberId = newPackageId('member');
    const receipt = packageSigningReturnSchema.parse({ id: newPackageId('signing-return'), signingReturnId: returned.id, memberId, appliedRevisionId: revisionId,
      createdAt: Date.now(), returnedAsset: stagedPdf.asset, recordAsset: stagedMetadata.asset, assessment: prepared.assessment,
      acceptedMismatch: decision.acceptedMismatch, metadataText: metadataText(captured.snapshot) });
    const signing = packageSigningSchema.parse({ version: 1, handoffs: original.signing!.handoffs.map(item => item.id === entry.id
      ? { ...item, returns: [...item.returns ?? [], receipt] } : item) });
    const revision: PackageRevision = { ...structuredClone(original), id: revisionId, parentId: original.id, createdAt: Date.now(), outputs: [], signing,
      members: [...original.members, { kind: 'original', id: memberId, revisionId: newPackageId('member-revision'),
        label: packageMemberLabel(`Returned PDF (signatures unverified): ${returned.pdf.filename}`), role: 'supporting-document', required: true,
        original: stagedPdf.asset, signedOriginal: true }] };
    const saved = await commitActionPackage(before, { ...before, sequence: before.sequence + 1, currentRevisionId: revision.id, revisions: [...before.revisions, revision] },
      signal, current, [stagedPdf.attachment, stagedMetadata.attachment]);
    returnPlans.delete(prepared); return saved;
  });
}
