import { z } from 'zod';
import { actionPackageSchema, commitActionPackage, listActionPackages, newPackageId, packageAssets, packageReviewRevision, type ActionPackage, type PackageAsset } from './actionPackages';
import { openPackageReview, assertActivePackageReview } from './packageReviewRounds';
import { createPackageMemberReview } from './packageMemberReviews';
import { canonicalReviewPayload, reviewPayloadDigest } from './reviewRounds';
import { buildPortableResources, parsePortableResources } from './portableResources';
import { MAX_PACKAGE_FILE_BYTES, validateActionPackageResources } from './actionPackageTransfer';
import { readPackageAsset } from './actionPackageAssets';
import { sameReviewStoredValue } from './documentsDb';
import { withAttachmentStaging } from './attachments';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageReviewMetadata, reviewPackageText } from './actionPackageDisclosure';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { validatePackageDraft } from './actionPackageDraft';
import type { ExportReview } from './preparedExport';

const envelopeSchema = z.object({ kind: z.enum(['dondocs-package-review-copy', 'dondocs-package-review-return']),
  version: z.literal(1), id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  createdAt: z.number().int().nonnegative(), package: actionPackageSchema, portableResources: z.unknown() }).strict();
export type PackageReviewReturn = z.infer<typeof envelopeSchema>;
export type ParsedPackageReviewTransfer = Awaited<ReturnType<typeof parsePackageReviewTransfer>>;
function bounded(json: string): void {
  if (json.length > MAX_PACKAGE_FILE_BYTES || new TextEncoder().encode(json).byteLength > MAX_PACKAGE_FILE_BYTES)
    throw new Error('This package review exceeds the 100 MB transfer limit.');
}
/** Validate full retained model/resources before installation or return preview. No local writes. */
export async function parsePackageReviewTransfer(json: string) {
  bounded(json);
  const payload = envelopeSchema.parse(JSON.parse(json));
  const record = payload.package, round = record.reviewRounds?.[0];
  if (!round || record.reviewRounds?.length !== 1 || record.revisions.length !== 1
    || record.historyScope !== 'selected-revision' || record.currentRevisionId !== round.revisionId
    || record.reviewApplications !== undefined || round.ownerPackageId !== undefined || record.workingCopies !== undefined
    || !sameReviewStoredValue(record.revisions[0], round.baseline)
    || record.revisions.some(revision => revision.members.some(member => member.kind === 'native' && member.source?.local)))
    throw new Error('A reviewer copy must contain one exact baseline without local owner or source authority.');
  assertActivePackageReview(round);
  const resources = await parsePortableResources(payload.portableResources);
  const assets = new Map<string, PackageAsset>();
  for (const asset of packageAssets(record)) {
    if (assets.has(asset.id) && !sameReviewStoredValue(assets.get(asset.id), asset)) throw new Error('Conflicting review resource identity.');
    assets.set(asset.id, asset);
    const resource = resources.get(`assets/${asset.id}`);
    if (!resource || resource.name !== asset.name || resource.mediaType !== asset.type || resource.data.byteLength !== asset.size)
      throw new Error('The review is missing required retained resources.');
  }
  if (resources.size !== assets.size) throw new Error('The review contains unbound resources.');
  await validateActionPackageResources(record, async asset => resources.get(`assets/${asset.id}`)!.data);
  return { payload, record, round, memberReviews: round.memberReviews ?? [], resources,
    digest: await reviewPayloadDigest(payload) };
}
/** PR112 consumes this detached validated envelope and stages any application itself. */
export async function parsePackageReviewReturn(json: string, owner: ActionPackage, roundId: string) {
  const parsed = await parsePackageReviewTransfer(json);
  const round = actionPackageSchema.parse(owner).reviewRounds?.find(round => round.id === roundId);
  if (parsed.payload.kind !== 'dondocs-package-review-return' || !round || round.ownerPackageId !== owner.id)
    throw new Error('Open the owning package review before importing returned feedback.');
  assertActivePackageReview(round);
  const immutable = (value: typeof round) => ({ ...value, ownerPackageId: undefined, memberReviews: undefined, lifecycle: undefined });
  if (owner.id !== parsed.record.id || !sameReviewStoredValue(immutable(round), immutable(parsed.round)))
    throw new Error('This feedback belongs to a different exact package round or revision.');
  for (const child of parsed.memberReviews) {
    const retained = round.memberReviews?.find(item => item.binding.memberId === child.binding.memberId);
    for (const proposal of child.suggestions?.proposals ?? []) {
      const existing = retained?.suggestions?.proposals.find(item => item.id === proposal.id);
      if (existing && !sameReviewStoredValue(existing, proposal))
        throw new Error('A returned suggestion changed under an existing identity. Ask the reviewer to create a new suggestion.');
    }
  }
  return parsed;
}
export async function inspectPackageReviewTransfer(parsed: Pick<ParsedPackageReviewTransfer, 'record' | 'round' | 'resources'>, policy: PolicyResolution): Promise<ExportReview[]> {
  const { record, round, resources } = parsed;
  const reviews = [reviewPackageReviewMetadata(round, policy), reviewPackageText(`${record.id}\n${record.name}`, 'Package review identity', policy)];
  for (const member of round.baseline.members) {
    if (member.kind === 'native') {
      const retained = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resources.get(`assets/${member.draft.id}`)!.data));
      const draft = await validatePackageDraft(retained);
      // The original JSON bytes can retain text that session normalization omits.
      // Inspect that inventory without copying inline binary data into the comparison report.
      reviews.push(reviewPackageNative(member.session, member.label, policy, retained));
      for (const file of [...draft.files, draft.basicLetter, ...draft.figures.filter((_, index) => draft.session.paragraphs[index]?.figure?.type === 'application/pdf')])
        if (file) reviews.push(await reviewPackageOriginal(file.data, file.name, policy));
    }
    else reviews.push(await reviewPackageOriginal(resources.get(`assets/${member.original.id}`)!.data, member.label, policy));
  }
  for (const output of round.baseline.outputs)
    reviews.push(await reviewPackageOriginal(resources.get(`assets/${output.asset.id}`)!.data, output.asset.name, policy));
  const pdfs = new Set([...round.baseline.members.flatMap(member => member.kind === 'original' ? [member.original.id] : []), ...round.baseline.outputs.map(output => output.asset.id)]);
  for (const asset of packageAssets(record)) if (asset.type === 'application/pdf' && !pdfs.has(asset.id)) {
    pdfs.add(asset.id); reviews.push(await reviewPackageOriginal(resources.get(`assets/${asset.id}`)!.data, asset.name, policy));
  }
  return reviews;
}
export interface PreparedPackageReviewTransfer {
  readonly mode: 'copy' | 'return' | 'import'; readonly reviews: readonly ExportReview[]; readonly packageName: string;
}
const preparations = new WeakMap<PreparedPackageReviewTransfer, { parsed: ParsedPackageReviewTransfer; json: string; policy: string; before?: ActionPackage }>();
function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  return canonicalReviewPayload(policy.policy);
}
async function prepareBuild(input: ActionPackage, roundId: string, mode: 'copy' | 'return', policy: PolicyResolution) {
  const before = actionPackageSchema.parse(structuredClone(input));
  const round = await openPackageReview(before, roundId); assertActivePackageReview(round);
  if (mode === 'copy' && round.ownerPackageId !== before.id) throw new Error('Only the owning package can prepare a reviewer copy.');
  const children = await Promise.all(round.baseline.members.map(member => round.memberReviews?.find(child => child.binding.memberId === member.id) ?? createPackageMemberReview(round, member.id)));
  const portableRound = { ...round, ownerPackageId: undefined, memberReviews: children };
  const record = actionPackageSchema.parse({ ...before, archived: false, historyScope: 'selected-revision',
    revisions: [packageReviewRevision(round.baseline)], currentRevisionId: round.revisionId, workingCopies: undefined, reviewApplications: undefined, reviewRounds: [portableRound] });
  const assets = [...new Map(packageAssets(record).map(asset => [asset.id, asset])).values()];
  const portableResources = await buildPortableResources(await Promise.all(assets.map(async asset => ({
    path: `assets/${asset.id}`, name: asset.name, mediaType: asset.type, data: await readPackageAsset(asset),
  }))));
  const json = JSON.stringify({ kind: mode === 'copy' ? 'dondocs-package-review-copy' : 'dondocs-package-review-return',
    version: 1, id: newPackageId('package-feedback'), createdAt: Date.now(), package: record, portableResources });
  const parsed = await parsePackageReviewTransfer(json);
  const prepared = Object.freeze({ mode, reviews: await inspectPackageReviewTransfer(parsed, policy), packageName: record.name });
  preparations.set(prepared, { parsed, json, policy: policyIdentity(policy), before });
  return prepared;
}
export const buildPackageReviewerCopy = (record: ActionPackage, roundId: string, policy: PolicyResolution) => prepareBuild(record, roundId, 'copy', policy);
export const buildPackageReviewReturn = (record: ActionPackage, roundId: string, policy: PolicyResolution) => prepareBuild(record, roundId, 'return', policy);
export async function preparePackageReviewerImport(json: string, policy: PolicyResolution): Promise<PreparedPackageReviewTransfer> {
  const parsed = await parsePackageReviewTransfer(json);
  if (parsed.payload.kind !== 'dondocs-package-review-copy') throw new Error('Choose a package reviewer copy. Returned feedback is reviewed by its owning package.');
  if ((await listActionPackages()).some(record => record.id === parsed.record.id)) throw new Error('This package identity already exists locally. Open the reviewer copy in an independent browser; it cannot overwrite or acquire owner authority.');
  const prepared = Object.freeze({ mode: 'import' as const, reviews: await inspectPackageReviewTransfer(parsed, policy), packageName: parsed.record.name });
  preparations.set(prepared, { parsed, json, policy: policyIdentity(policy) }); return prepared;
}
function checked(prepared: PreparedPackageReviewTransfer, policy: PolicyResolution) {
  const retained = preparations.get(prepared);
  if (!retained || retained.policy !== policyIdentity(policy)) throw new Error('The transfer policy changed. Prepare and review this package again.');
  return retained;
}
export async function packageReviewTransferFile(prepared: PreparedPackageReviewTransfer, policy: PolicyResolution): Promise<string> {
  const retained = checked(prepared, policy);
  if (prepared.mode === 'import' || !retained.before) throw new Error('Prepare a package review download first.');
  const current = (await listActionPackages()).find(record => record.id === retained.before!.id);
  if (!sameReviewStoredValue(current, retained.before)) throw new Error('The package changed. Prepare this download again.');
  checked(prepared, policy); return retained.json;
}
/** Reviewed resources are staged and committed with the parent CAS, or rolled back together. */
export async function importPackageReviewerCopy(prepared: PreparedPackageReviewTransfer, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const retained = checked(prepared, policy);
  if (prepared.mode !== 'import') throw new Error('Prepare the reviewer file import first.');
  const current = () => { signal?.throwIfAborted(); if (!isCurrent()) throw new Error('This reviewer import is no longer current.'); };
  current();
  return withAttachmentStaging(async () => {
    if ((await listActionPackages()).some(record => record.id === retained.parsed.record.id)) throw new Error('This package identity already exists locally; reviewer imports cannot overwrite it.');
    const staged = [...new Map(packageAssets(retained.parsed.record).map(asset => [asset.id, asset])).values()]
      .map(asset => ({ id: asset.id, name: asset.name, type: asset.type, size: asset.size,
        data: retained.parsed.resources.get(`assets/${asset.id}`)!.data }));
    current(); checked(prepared, policy);
    const result = await commitActionPackage(null, retained.parsed.record, signal, isCurrent, staged);
    preparations.delete(prepared); return result;
  });
}
