import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import { actionPackageSchema, getPackageRevision, listActionPackages, newPackageId, packageAssets, type ActionPackage, type PackageAsset, type PackageMember } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { MAX_PORTABLE_RESOURCE_COUNT, MAX_PORTABLE_TOTAL_BYTES, portableResourceDigest } from './portableResources';
import { preparePackageAssembly } from './actionPackageAssembly';
import { buildPortableActionPackage } from './actionPackageTransfer';
import { reviewPackageText } from './actionPackageDisclosure';
import type { ExportReview } from './preparedExport';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { sameReviewStoredValue } from './documentsDb';
import { projectEditableDeliveryMember, type CapturedDeliveryAsset } from './packageDeliveryProjection';
import { renderPackageRecipientMember } from './packageNativeDelivery';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';

export const packageDeliverySelectionSchema = z.object({ label: z.string().trim().min(1).max(120).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Use a single-line delivery label.'),
  purpose: z.enum(['recipient', 'editable']), taggedNativePdfs: z.boolean().optional(), memberIds: z.array(z.string().min(1).max(100)).min(1).max(100) }).strict();
export type PackageDeliverySelection = z.infer<typeof packageDeliverySelectionSchema>;
export interface PackageDeliveryFile { id: string; name: string; type: string; size: number; sha256: string }
export interface PreparedPackageDelivery {
  readonly sourcePackageId: string; readonly sourceRevisionId: string; readonly revisionId: string;
  readonly packageName: string; readonly purpose: PackageDeliverySelection['purpose']; readonly taggedAssetIds: readonly string[];
  readonly members: ReadonlyArray<{ id: string; label: string; kind: PackageMember['kind']; role: PackageMember['role'] }>;
  readonly files: readonly PackageDeliveryFile[]; readonly excludedMembers: number;
  readonly reviews: ReadonlyArray<{ member: string; review: ExportReview }>; readonly notices: readonly string[];
}
interface Capture { source: ActionPackage; projection: ActionPackage; assets: Map<string, CapturedDeliveryAsset>; policy: string }
const captures = new WeakMap<PreparedPackageDelivery, Capture>();
function capture(value: PreparedPackageDelivery): Capture { const owned = captures.get(value); if (!owned) throw new Error('Prepare this delivery from its saved package before continuing.'); return owned; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function identity(policy: PolicyResolution) { if (policy.status !== 'ready') throw new Error(policy.message); assertExportDeploymentPolicy(policy.policy); return JSON.stringify(policy.policy); }
export function selectPackageDeliveryMembers(record: ActionPackage, revisionId: string, memberIds: readonly string[]): PackageMember[] {
  const selected = new Set(memberIds), revision = getPackageRevision(record, revisionId);
  if (!selected.size || selected.size !== memberIds.length || selected.size > 100 || [...selected].some(id => !revision.members.some(member => member.id === id)))
    throw new Error('Choose each included document once from this exact saved revision.');
  return structuredClone(revision.members.filter(member => selected.has(member.id)));
}
/** Call synchronously immediately before exposing the already generated delivery bytes. */
export function assertPackageDeliveryPolicy(prepared: PreparedPackageDelivery, policy: PolicyResolution): void {
  if (identity(policy) !== capture(prepared).policy) throw new Error('Deployment settings changed. Review this delivery again.');
}
export async function assertPackageDeliveryCurrent(prepared: PreparedPackageDelivery, policy: PolicyResolution, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<void> {
  const owned = capture(prepared); signal?.throwIfAborted();
  if (!isCurrent() || identity(policy) !== owned.policy || identity(await getExportDeploymentPolicy()) !== owned.policy) throw new Error('This delivery or deployment changed. Prepare and review it again.');
  const latest = (await listActionPackages()).find(record => record.id === owned.source.id);
  signal?.throwIfAborted();
  if (!isCurrent() || !sameReviewStoredValue(latest, owned.source)) throw new Error('The saved package changed. Prepare and review this delivery again.');
  assertPackageDeliveryPolicy(prepared, getExportDeploymentPolicySync());
}
export function copyPreparedPackageDeliveryProjection(prepared: PreparedPackageDelivery): ActionPackage { return structuredClone(capture(prepared).projection); }
export async function readPreparedPackageDeliveryAsset(prepared: PreparedPackageDelivery, asset: PackageAsset): Promise<ArrayBuffer> {
  const saved = capture(prepared).assets.get(asset.id);
  if (!saved || !sameReviewStoredValue(saved.asset, asset)) throw new Error('This file is outside the captured delivery scope.');
  return saved.bytes.slice(0);
}
export async function preparePackageDelivery(input: ActionPackage, revisionId: string, selectionInput: PackageDeliverySelection, policy: PolicyResolution,
  ports?: CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> }, signal = new AbortController().signal, isCurrent: () => boolean = () => true): Promise<PreparedPackageDelivery> {
  signal.throwIfAborted(); const source = actionPackageSchema.parse(structuredClone(input)), selection = packageDeliverySelectionSchema.parse(structuredClone(selectionInput)), policyKey = identity(policy);
  const selected = selectPackageDeliveryMembers(source, revisionId, selection.memberIds), assets = new Map<string, CapturedDeliveryAsset>(), members: PackageMember[] = [], reviews: Array<{ member: string; review: ExportReview }> = [];
  const taggedNativePdfs = selection.taggedNativePdfs === true;
  if (taggedNativePdfs && (selection.purpose !== 'recipient' || !selected.some(member => member.kind === 'native'))) {
    throw new Error('Select supported correspondence to prepare a recipient delivery with tagged PDFs.');
  }
  const taggedAssetIds: string[] = [];
  const layoutNotices = new Set<string>();
  reviews.push({ member: 'Delivery name', review: reviewPackageText(selection.label, 'Delivery name', policy) });
  let capturedBytes = 0;
  const addAsset = (item: CapturedDeliveryAsset) => { const existing = assets.get(item.asset.id); if (existing && !sameReviewStoredValue(existing.asset, item.asset)) throw new Error('Conflicting delivery file identity.');
    if (!existing) { capturedBytes += item.bytes.byteLength; if (capturedBytes > MAX_PORTABLE_TOTAL_BYTES || assets.size >= MAX_PORTABLE_RESOURCE_COUNT || item.bytes.byteLength > 25 * 1024 * 1024) throw new Error('The selected delivery exceeds its bounded file or byte limits.'); }
    assets.set(item.asset.id, { asset: structuredClone(item.asset), bytes: item.bytes.slice(0) }); };
  for (const selectedMember of selected) {
    signal.throwIfAborted(); if (!isCurrent()) throw new Error('This package selection changed. Prepare its delivery again.');
    if (selectedMember.kind === 'attachment') {
      const bytes = await readPackageAsset(selectedMember.original);
      const asset: PackageAsset = { ...structuredClone(selectedMember.original), id: newPackageId('delivery-file') };
      members.push({ ...structuredClone(selectedMember), revisionId: newPackageId('member-revision'), original: asset }); addAsset({ asset, bytes });
    } else if (selection.purpose === 'editable' && selectedMember.kind === 'native') {
      const projected = await projectEditableDeliveryMember(selectedMember); members.push(projected.member); addAsset(projected.captured);
      for (const asset of Object.values(selectedMember.templates ?? {})) addAsset({ asset, bytes: await readPackageAsset(asset) });
    } else {
      let bytes: ArrayBuffer, name: string, signedOriginal = false;
      if (selectedMember.kind === 'original') { bytes = await readPackageAsset(selectedMember.original); name = selectedMember.original.name; signedOriginal = selectedMember.signedOriginal; }
      else {
        if (!ports) throw new Error('The PDF renderer is required for native recipient documents.');
        const rendered = await renderPackageRecipientMember(selectedMember, policy, ports, readPackageAsset, signal, taggedNativePdfs ? 'tagged' : undefined);
        bytes = rendered.bytes;
        if (rendered.layoutReview) {
          reviews.push({ member: selectedMember.label, review: rendered.layoutReview });
          rendered.layoutReview.notices.forEach(notice => layoutNotices.add(notice));
        }
        name = `document-${members.length + 1}${taggedNativePdfs ? '-tagged' : ''}.pdf`;
      }
      await PDFDocument.load(bytes.slice(0)); signal.throwIfAborted();
      const asset: PackageAsset = { id: newPackageId('delivery-file'), name, type: 'application/pdf', size: bytes.byteLength, sha256: await portableResourceDigest(bytes) };
      if (taggedNativePdfs && selectedMember.kind === 'native') taggedAssetIds.push(asset.id);
      members.push({ id: selectedMember.id, revisionId: newPackageId('member-revision'), label: selectedMember.label, role: selectedMember.role, required: selectedMember.required, kind: 'original', signedOriginal, original: asset }); addAsset({ asset, bytes });
    }
  }
  const revision = { id: newPackageId('revision'), createdAt: Date.now(), members, outputs: [] };
  const projection = actionPackageSchema.parse({ kind: 'dondocs-action-package-record', version: 1, id: newPackageId('package'), historyScope: 'selected-revision', name: selection.label,
    archived: false, sequence: 0, currentRevisionId: revision.id, revisions: [revision] });
  const temporary: PreparedPackageDelivery = { sourcePackageId: source.id, sourceRevisionId: revisionId, revisionId: revision.id, packageName: selection.label, purpose: selection.purpose, taggedAssetIds, members: [], files: [], excludedMembers: 0, reviews: [], notices: [] };
  captures.set(temporary, { source, projection, assets, policy: policyKey });
  const read = (asset: PackageAsset) => readPreparedPackageDeliveryAsset(temporary, asset);
  const inspected = await preparePackageAssembly(projection, revision.id, policy, { includeRetainedDraftText: true, signal, readAsset: read });
  if (inspected.readiness.findings.some(finding => finding.severity === 'error')) throw new Error(inspected.readiness.findings.filter(finding => finding.severity === 'error').map(finding => finding.message).join(' '));
  reviews.push(...inspected.reviews);
  const prepared = freeze({ sourcePackageId: source.id, sourceRevisionId: revisionId, revisionId: revision.id, packageName: selection.label, purpose: selection.purpose, taggedAssetIds,
    members: members.map(member => ({ id: member.id, label: member.label, kind: member.kind, role: member.role })), files: [...new Map(packageAssets(projection).map(asset => [asset.id, asset])).values()].map(asset => ({ ...asset })),
    excludedMembers: getPackageRevision(source, revisionId).members.length - members.length, reviews,
    notices: ['This delivery is an independent selected-document copy. It carries no package review decisions, task list, signing records, source pointers or earlier revisions.',
      ...(selection.purpose === 'editable' ? ['Editable documents include their retained answers, inactive values, templates and embedded attachments. Review this exact scope before transfer.'] : ['Native members become PDF derivatives. Selected supporting files keep their original formats and bytes; original PDFs keep any signatures; verify those signatures in the original file.']),
      ...(taggedNativePdfs ? ['Supported correspondence is delivered as separate experimental tagged PDFs. Original attachments retain their existing accessibility and are kept unchanged.'] : []),
      ...layoutNotices,
      ...inspected.readiness.findings.map(finding => finding.message)] });
  captures.set(prepared, capture(temporary)); await assertPackageDeliveryCurrent(prepared, policy, signal, isCurrent); return prepared;
}
export async function buildPackageDeliveryFile(prepared: PreparedPackageDelivery, policy: PolicyResolution, acknowledged: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<string> {
  if (!acknowledged) throw new Error('Review every included document and privacy finding before exporting this delivery.');
  await assertPackageDeliveryCurrent(prepared, policy, signal, isCurrent);
  const projection = copyPreparedPackageDeliveryProjection(prepared);
  const json = await buildPortableActionPackage(projection, projection.currentRevisionId, asset => readPreparedPackageDeliveryAsset(prepared, asset));
  await assertPackageDeliveryCurrent(prepared, policy, signal, isCurrent); return json;
}
