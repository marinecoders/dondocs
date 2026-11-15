import { z } from "zod";
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from "@/config/classification";
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from "./actionPackageTransfer";
import { getPackageRevision, listActionPackages, type ActionPackage } from "./actionPackages";
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from "./actionPackageDisclosure";
import { sameReviewStoredValue } from "./documentsDb";
import { validateShareExpiration } from "./sharedSession";
import { encryptSharePayload, buildShareUrl, MAX_SHARE_URL_LENGTH } from "./shareCrypto";
import { serializeEncryptedShareFile } from "./encryptedShareFile";
import { assertExportDeploymentPolicy, type PolicyResolution } from "./exportDeploymentPolicy";
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

async function prepare(json: string, policy: PolicyResolution, expiresAt?: number): Promise<PreparedPackageShare> {
  const identity = policyIdentity(policy);
  assertDeadline(expiresAt);
  const { record, resources } = await parsePortableActionPackage(json);
  const revision = getPackageRevision(record);
  const reviews: Array<{ member: string; review: ExportReview }> = [
    { member: "Package name", review: reviewPackageText(record.name, "Package name", policy) },
  ];
  for (const member of revision.members) {
    reviews.push({ member: member.label, review: reviewPackageText(member.label, "Package member label", policy) });
    if (member.kind === "native") reviews.push({ member: member.label, review: reviewPackageNative(member.session, member.label, policy) });
    const asset = member.kind === "original" ? member.original : member.draft;
    reviews.push({ member: member.label, review: reviewPackageText(asset.name, "Captured filename", policy) });
  }
  for (const asset of resources.values()) {
    reviews.push({ member: asset.name, review: reviewPackageText(asset.name, "Included filename", policy) });
    if (asset.mediaType === "application/pdf") reviews.push({ member: asset.name,
      review: await reviewPackageOriginal(asset.data, asset.name, policy) });
  }
  for (const output of revision.outputs) {
    reviews.push({ member: output.asset.name, review: reviewPackageText(output.renderer, "Retained renderer description", policy) });
    for (const boundary of output.boundaries) reviews.push({ member: output.asset.name,
      review: reviewPackageText(boundary.firstPageLabel, "Retained page label", policy) });
  }
  assertDeadline(expiresAt);
  const result = Object.freeze({ name: record.name, revisionId: revision.id,
    members: revision.members.map(member => ({ label: member.label, kind: member.kind, role: member.role })),
    reviews, ...(expiresAt === undefined ? {} : { expiresAt }) });
  captures.set(result, { json, policyIdentity: identity, ...(expiresAt === undefined ? {} : { expiresAt }) });
  return result;
}

/** The existing portable serializer selects one revision and removes local source authority. */
export async function preparePackageShare(record: ActionPackage, revisionId: string, policy: PolicyResolution): Promise<PreparedPackageShare> {
  const source = structuredClone(record);
  const result = await prepare(await buildPortableActionPackage(source, revisionId), policy);
  captures.get(result)!.source = source;
  return result;
}

/** Decryption is deliberately separate; no resources are installed before this review. */
export async function prepareReceivedPackageShare(value: unknown, policy: PolicyResolution): Promise<PreparedPackageShare> {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error("This encrypted package is invalid or unsupported.");
  assertDeadline(parsed.data.expiresAt);
  return prepare(JSON.stringify(parsed.data.package), policy, parsed.data.expiresAt);
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
