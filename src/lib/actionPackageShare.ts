import { reviewPackageSigning } from './packageSigning';
import { reviewPackageAttachment } from './packageAttachmentCapabilities';
import { z } from "zod";
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from "@/config/classification";
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from "./actionPackageTransfer";
import { getPackageRevision, listActionPackages, type ActionPackage } from "./actionPackages";
import { reviewPackageNative, reviewPackageText, reviewPackageInformation, reviewPackageBindings, reviewPackageRequirements, reviewPackageConsistency, reviewPackageWork, reviewPackageScans } from "./actionPackageDisclosure";
import { sameReviewStoredValue } from "./documentsDb";
import { validateShareExpiration } from "./sharedSession";
import { encryptSharePayload, buildShareUrl, MAX_SHARE_URL_LENGTH } from "./shareCrypto";
import { serializeEncryptedShareFile } from "./encryptedShareFile";
import { assertExportDeploymentPolicy, type PolicyResolution } from "./exportDeploymentPolicy";
import { parseDraftFile } from "./draftFile";
import { portableResourceDigest } from "./portableResources";
import { reviewBoundedPackagePdf } from "./packagePdfEvidence";
import type { ExportReview } from "./preparedExport";

const envelopeSchema = z.object({
  kind: z.literal("dondocs-action-package-share"),
  version: z.literal(1),
  expiresAt: z.number().int().positive().max(8_640_000_000_000_000).optional(),
  package: z.record(z.string(), z.unknown()),
}).strict();

export interface PreparedPackageShare {
  readonly name: string;
  readonly revisionId: string;
  readonly members: ReadonlyArray<{ label: string; kind: string; role: string }>;
  readonly reviews: ReadonlyArray<{ member: string; review: ExportReview }>;
  readonly expiresAt?: number;
}
export interface EncryptedPackageShare {
  readonly url: string | null;
  readonly expiresAt?: number;
}
interface CapturedShare {
  json: string;
  policyIdentity: string;
  expiresAt?: number;
  source?: ActionPackage;
}
const captures = new WeakMap<PreparedPackageShare, CapturedShare>();
const encryptedCopies = new WeakMap<EncryptedPackageShare, { prepared: PreparedPackageShare; payload: string; expiresAt?: number }>();

function policyIdentity(policy: PolicyResolution): string {
  if (policy.status !== "ready") throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  return policy.policy.identity;
}
function assertDeadline(expiresAt?: number) {
  if (expiresAt !== undefined) validateShareExpiration(expiresAt);
}
function capture(prepared: PreparedPackageShare): CapturedShare {
  const value = captures.get(prepared);
  if (!value) throw new Error("Review this package again before sharing or importing it.");
  assertDeadline(value.expiresAt);
  return value;
}
function assertPolicy(expected: string, policy: PolicyResolution) {
  if (policyIdentity(policy) !== expected)
    throw new Error("Deployment settings changed. Review the package again before continuing.");
}
async function assertExportCurrent(prepared: PreparedPackageShare, expiresAt?: number) {
  const value = capture(prepared);
  assertDeadline(expiresAt);
  assertPolicy(value.policyIdentity, await getExportDeploymentPolicy());
  if (!value.source) throw new Error("This received package cannot be sent without opening it first.");
  const current = (await listActionPackages()).find(record => record.id === value.source!.id);
  if (!sameReviewStoredValue(current, value.source))
    throw new Error("The saved package changed. Reopen Share and review its selected revision again.");
  assertDeadline(expiresAt);
  assertPolicy(value.policyIdentity, getExportDeploymentPolicySync());
  return value;
}

async function prepare(json: string, policy: PolicyResolution, expiresAt?: number, signal: AbortSignal = new AbortController().signal): Promise<PreparedPackageShare> {
  signal.throwIfAborted();
  const identity = policyIdentity(policy);
  assertDeadline(expiresAt);
  const { record, resources } = await parsePortableActionPackage(json);
  if (record.historyScope !== "selected-revision" || record.revisions.length !== 1)
    throw new Error("Encrypted packages must contain exactly one selected revision. Ask the sender to share the package again.");
  const revision = getPackageRevision(record);
  const reviews: Array<{ member: string; review: ExportReview }> = [
    { member: "Package name", review: reviewPackageText(record.name, "Package name", policy) },
  ];
  if (revision.bindings) reviews.push({ member: "Package field links", review: reviewPackageBindings(revision.bindings, policy) });
  if (revision.signing) for (const review of await reviewPackageSigning(revision.signing, policy)) reviews.push({ member: 'Package signing history', review });
  if (revision.scans) reviews.push({ member: 'Recognized supporting evidence', review: reviewPackageScans(revision.scans, policy) });
  if (revision.work) reviews.push({ member: "Package work", review: reviewPackageWork(revision.work, policy) });
  if (revision.requirements) reviews.push({ member: "Package requirements", review: reviewPackageRequirements(revision.requirements, policy) });
  if (revision.consistency) reviews.push({ member: 'Package relationships', review: reviewPackageConsistency(revision.consistency, policy) });
  if (revision.information) reviews.push({ member: "Package information", review: reviewPackageInformation(revision.information, policy) });
  if (revision.templateState) {
    const { reviewConditionalPackage } = await import('./packageConditionalSources');
    for (const review of await reviewConditionalPackage(revision, policy, async asset => resources.get(`assets/${asset.id}`)!.data))
      reviews.push({ member: 'Captured action intake and template', review });
  }
  const pdfReviews = new Map<string, ExportReview>();
  const reviewPdf = async (bytes: ArrayBuffer, name: string) => {
    signal.throwIfAborted();
    assertDeadline(expiresAt);
    reviews.push({ member: name, review: reviewPackageText(name, "Included PDF filename", policy) });
    const digest = await portableResourceDigest(bytes);
    let review = pdfReviews.get(digest);
    if (!review) {
      review = await reviewBoundedPackagePdf(bytes, "Included PDF content", policy, signal);
      pdfReviews.set(digest, review);
    }
    signal.throwIfAborted();
    assertDeadline(expiresAt);
    reviews.push({ member: name, review });
  };
  for (const member of revision.members) {
    reviews.push({ member: member.label, review: reviewPackageText(member.label, "Package member label", policy) });
    if (member.kind === "native") {
      // Portable validation already authenticated this draft and matched its model.
      // Decode its embedded originals without installing assets or using local handles.
      const draft = resources.get(`assets/${member.draft.id}`)!;
      const retained = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(draft.data));
      const reviewed = parseDraftFile(retained, false, true);
      reviews.push({ member: member.label, review: reviewPackageNative(member.session, member.label, policy, retained) });
      for (const file of [
        ...reviewed.files,
        reviewed.basicLetter,
        ...reviewed.figures.filter((_, index) => reviewed.session.paragraphs[index]?.figure?.type === "application/pdf"),
      ]) if (file) await reviewPdf(file.data, `${member.label}: ${file.name}`);
    }
    if (member.kind === "attachment") {
      const resource = resources.get(`assets/${member.original.id}`);
      if (!resource) throw new Error("A supporting attachment is missing from this captured share.");
      reviews.push({ member: member.label, review: (await reviewPackageAttachment(member.original, resource.data, policy, signal)).review });
    }
    const asset = member.kind !== "native" ? member.original : member.draft;
    reviews.push({ member: member.label, review: reviewPackageText(asset.name, "Captured filename", policy) });
  }
  for (const asset of resources.values()) {
    signal.throwIfAborted();
    assertDeadline(expiresAt);
    if (asset.mediaType === "application/pdf") await reviewPdf(asset.data, asset.name);
    else reviews.push({ member: asset.name, review: reviewPackageText(asset.name, "Included filename", policy) });
  }
  for (const output of revision.outputs) {
    reviews.push({ member: output.asset.name, review: reviewPackageText(output.renderer, "Retained renderer description", policy) });
    for (const boundary of output.boundaries) reviews.push({ member: output.asset.name,
      review: reviewPackageText(boundary.firstPageLabel, "Retained page label", policy) });
  }
  signal.throwIfAborted();
  assertDeadline(expiresAt);
  const result = Object.freeze({ name: record.name, revisionId: revision.id,
    members: revision.members.map(member => ({ label: member.label, kind: member.kind, role: member.role })),
    reviews, ...(expiresAt === undefined ? {} : { expiresAt }) });
  captures.set(result, { json, policyIdentity: identity, ...(expiresAt === undefined ? {} : { expiresAt }) });
  return result;
}

/** The existing portable serializer selects one revision and removes local source authority. */
export async function preparePackageShare(record: ActionPackage, revisionId: string, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageShare> {
  const source = structuredClone(record);
  const result = await prepare(await buildPortableActionPackage(source, revisionId), policy, undefined, signal);
  captures.get(result)!.source = source;
  return result;
}

/** Decryption is deliberately separate; no resources are installed before this review. */
export async function prepareReceivedPackageShare(value: unknown, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageShare> {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error("This encrypted package is invalid or unsupported.");
  assertDeadline(parsed.data.expiresAt);
  return prepare(JSON.stringify(parsed.data.package), policy, parsed.data.expiresAt, signal);
}

export async function encryptPreparedPackageShare(prepared: PreparedPackageShare, password: string, expiresAt?: number): Promise<EncryptedPackageShare> {
  const value = await assertExportCurrent(prepared, expiresAt);
  const payload = await encryptSharePayload({ kind: "dondocs-action-package-share", version: 1,
    ...(expiresAt === undefined ? {} : { expiresAt }), package: JSON.parse(value.json) }, password);
  await assertExportCurrent(prepared, expiresAt);
  const url = buildShareUrl(payload);
  const result = Object.freeze({ url: url.length <= MAX_SHARE_URL_LENGTH ? url : null,
    ...(expiresAt === undefined ? {} : { expiresAt }) });
  encryptedCopies.set(result, { prepared, payload, ...(expiresAt === undefined ? {} : { expiresAt }) });
  return result;
}

/** Check source, current policy and authenticated deadline at the actual copy/download action. */
export async function packageShareDelivery(encrypted: EncryptedPackageShare): Promise<{ url: string | null; file: Uint8Array }> {
  const copy = encryptedCopies.get(encrypted);
  if (!copy) throw new Error("Generate this encrypted package again before sending it.");
  await assertExportCurrent(copy.prepared, copy.expiresAt);
  return { url: encrypted.url, file: serializeEncryptedShareFile(copy.payload) };
}

export async function importPreparedPackageShare(prepared: PreparedPackageShare, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const value = capture(prepared);
  assertPolicy(value.policyIdentity, await getExportDeploymentPolicy());
  let boundaryError: unknown;
  const current = () => {
    try {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new DOMException("The package review was closed.", "AbortError");
      assertDeadline(value.expiresAt);
      assertPolicy(value.policyIdentity, getExportDeploymentPolicySync());
      return true;
    } catch (cause) { boundaryError = cause; return false; }
  };
  try {
    if (!current()) throw boundaryError;
    return await importPortableActionPackage(value.json, signal, current);
  } catch (cause) { throw boundaryError ?? cause; }
}
