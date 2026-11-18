import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, packageMemberLabel, type ActionPackage, type PackageMember } from './actionPackages';
import { portableResourceDigest } from './portableResources';
import { newAttachmentId } from './attachments';
import { inspectPackageAttachment, type PackageAttachmentInspection } from './packageAttachmentCapabilities';
import { reviewPackageText } from './actionPackageDisclosure';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import { withAttachmentStaging } from './attachments';

export interface PreparedPackageAttachment {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly canRenderPdf: boolean;
  readonly notice: string;
  readonly previewText: string;
  readonly review: ExportReview;
}
interface Capture { record: ActionPackage; name: string; bytes: ArrayBuffer; inspection: PackageAttachmentInspection; policy: string }
const captures = new WeakMap<PreparedPackageAttachment, Capture>();
function owning(record: ActionPackage) {
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Add evidence from the current, unarchived owning package.');
}
function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  return JSON.stringify(policy.policy);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Preparation owns the exact incoming file before any asynchronous inspection. */
export async function preparePackageAttachment(input: ActionPackage, file: { name: string; type?: string; data: ArrayBuffer }, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageAttachment> {
  const record = actionPackageSchema.parse(structuredClone(input)), key = policyIdentity(policy);
  owning(record); signal?.throwIfAborted();
  if (getPackageRevision(record).members.length >= 100) throw new Error('A package supports up to 100 members.');
  if (!file.name.trim() || file.name.length > 255) throw new Error('Use a filename of 1–255 characters.');
  const bytes = file.data.slice(0), name = file.name;
  const inspection = await inspectPackageAttachment({ name, type: file.type, data: bytes }, signal);
  const review = reviewPackageText(`${name}\n${inspection.text}`, 'Supporting evidence and retained content', policy);
  signal?.throwIfAborted();
  const prepared = freeze({ name, size: bytes.byteLength, type: inspection.type, canRenderPdf: inspection.canRenderPdf,
    notice: inspection.notice, previewText: inspection.text.slice(0, 4000), review: { ...review, notices: [...review.notices, inspection.notice] } });
  captures.set(prepared, { record, name, bytes, inspection, policy: key }); return prepared;
}

export async function applyPreparedPackageAttachment(prepared: PreparedPackageAttachment, policy: PolicyResolution, acknowledged: boolean, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const capture = captures.get(prepared);
  if (!capture) throw new Error('Prepare this supporting file again.');
  if (!acknowledged) throw new Error('Review the exact supporting file and privacy findings before adding it.');
  if (policyIdentity(policy) !== capture.policy || policyIdentity(await getExportDeploymentPolicy()) !== capture.policy) throw new Error('Deployment settings changed. Review this file again.');
  const current = () => { const actual = getExportDeploymentPolicySync(); return isCurrent() && !signal?.aborted && actual.status === 'ready' && JSON.stringify(actual.policy) === capture.policy; };
  signal?.throwIfAborted(); if (!current()) throw new Error('This evidence addition is no longer current.');
  return withAttachmentStaging(async () => {
    const bytes = capture.bytes.slice(0);
    const original = { id: newAttachmentId(), name: capture.name, type: capture.inspection.type, size: bytes.byteLength, sha256: await portableResourceDigest(bytes) };
    signal?.throwIfAborted(); if (!current()) throw new Error('This evidence addition is no longer current.');
    const before = getPackageRevision(capture.record), member: PackageMember = { id: newPackageId('member'), revisionId: newPackageId('member-revision'), kind: 'attachment',
      label: packageMemberLabel(capture.name.slice(0, 120)), role: 'supporting-document', required: true, original, signedOriginal: false };
    const revision = { ...structuredClone(before), id: newPackageId('revision'), parentId: before.id, createdAt: Date.now(), outputs: [], members: [...before.members, member] };
    return commitActionPackage(capture.record, { ...capture.record, sequence: capture.record.sequence + 1, currentRevisionId: revision.id, revisions: [...capture.record.revisions, revision] }, signal, current, [{ id: original.id, name: original.name, type: original.type, size: original.size, data: bytes }]);
  });
}

/** A preview receives an owned copy of a validated raster file. Other attachment types remain inert text. */
export function copyPreparedPackageAttachmentImage(prepared: PreparedPackageAttachment): Blob | null {
  const capture = captures.get(prepared);
  if (!capture) throw new Error('Prepare this supporting file again.');
  return capture.inspection.type.startsWith('image/') ? new Blob([capture.bytes.slice(0)], { type: capture.inspection.type }) : null;
}
