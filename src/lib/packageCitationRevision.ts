import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from "@/config/classification";
import type { SerializedSession } from "@/stores/documentStore";
import { actionPackageSchema, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage, type PackageRevision } from "./actionPackages";
import { capturePackageMember, preparePackageMember } from "./actionPackageAssets";
import { withAttachmentStaging } from "./attachments";
import { captureDocumentRevision } from "./capturedDocument";
import { sameReviewStoredValue } from "./documentsDb";
import { reviewPackageNative } from "./actionPackageDisclosure";
import { assertExportDeploymentPolicy, type PolicyResolution } from "./exportDeploymentPolicy";
import { packageCitationsSchema, type PackageCitations } from "./packageCitationSchema";

export function packageCitationPolicyIdentity(policy: PolicyResolution): string {
  if (policy.status !== "ready") throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  return policy.policy.identity;
}

/** Shared staged writer for deliberate citation edits; library drafts are never opened or changed. */
export async function commitPackageCitationRevision(
  record: ActionPackage,
  memberOrder: readonly string[],
  sessions: ReadonlyMap<string, SerializedSession>,
  metadata: (revision: PackageRevision) => Promise<PackageCitations>,
  policy: PolicyResolution,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
  enclosureOrders: ReadonlyMap<string, readonly number[]> = new Map(),
): Promise<ActionPackage> {
  const owned = actionPackageSchema.parse(structuredClone(record)), revision = getPackageRevision(owned);
  const identity = packageCitationPolicyIdentity(policy);
  if (owned.archived) throw new Error("Reopen this archived package before editing citations.");
  if (new Set(memberOrder).size !== revision.members.length || memberOrder.length !== revision.members.length
    || memberOrder.some(id => !revision.members.some(member => member.id === id))) throw new Error("Review the current package member order again.");
  for (const [id, session] of sessions) {
    const member = revision.members.find(member => member.id === id && member.kind === "native");
    if (!member || member.kind !== "native") throw new Error("A citation edit belongs to an unavailable native member.");
    const before = member.session;
    if (!sameReviewStoredValue({ ...session, references: before.references, enclosures: before.enclosures, paragraphs: before.paragraphs }, before)
      || session.paragraphs.length !== before.paragraphs.length
      || session.paragraphs.some((paragraph, index) => !sameReviewStoredValue({ ...paragraph, text: before.paragraphs[index].text, header: before.paragraphs[index].header }, before.paragraphs[index])))
      throw new Error("Citation edits may change paragraph text and supported list order only.");
    const remaining = [...before.references];
    for (const reference of session.references) {
      const index = remaining.findIndex(item => sameReviewStoredValue({ ...reference, letter: item.letter }, item));
      if (index < 0) throw new Error("Citation reordering cannot replace reference content.");
      remaining.splice(index, 1);
    }
    if (remaining.length) throw new Error("Citation reordering cannot remove reference content.");
    const enclosureOrder = enclosureOrders.get(id) ?? before.enclosures.map((_, index) => index);
    if (enclosureOrder.length !== before.enclosures.length || new Set(enclosureOrder).size !== before.enclosures.length
      || enclosureOrder.some((index, position) => !Number.isInteger(index) || index < 0 || index >= before.enclosures.length || !sameReviewStoredValue(session.enclosures[position], before.enclosures[index])))
      throw new Error("Citation reordering must preserve every native enclosure and its exact files.");
    reviewPackageNative(session, "Proposed citation text", policy);
  }
  let boundaryError: unknown;
  const current = () => {
    try {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new DOMException("The citation review was closed.", "AbortError");
      if (packageCitationPolicyIdentity(getExportDeploymentPolicySync()) !== identity) throw new Error("Deployment settings changed. Review the citation changes again.");
      return true;
    } catch (cause) { boundaryError = cause; return false; }
  };
  const assertCurrent = () => { if (!current()) throw boundaryError; };
  return withAttachmentStaging(async () => {
    try {
      await getExportDeploymentPolicy();
      assertCurrent();
      const members = [];
      for (const id of memberOrder) {
        assertCurrent();
        const member = revision.members.find(member => member.id === id)!;
        const session = sessions.get(id);
        if (member.kind !== "native" || !session || sameReviewStoredValue(member.session, session)) { members.push(member); continue; }
        const { snapshot } = await preparePackageMember(member);
        assertCurrent();
        const enclosureOrder = enclosureOrders.get(id) ?? member.session.enclosures.map((_, index) => index);
        // Apply text/list operations to hydrated inputs, retaining original binary files and image handles.
        const document = { ...snapshot,
          references: structuredClone(session.references),
          enclosures: enclosureOrder.map(index => snapshot.enclosures[index]),
          paragraphs: snapshot.paragraphs.map((paragraph, index) => ({ ...paragraph, text: session.paragraphs[index].text, header: session.paragraphs[index].header })),
        };
        const updated = await capturePackageMember(captureDocumentRevision({
          documentId: member.id, epoch: 0, editSequence: owned.sequence + 1, capturedAt: Date.now(),
        }, document), member.label, member.role, member);
        updated.source = member.source;
        assertCurrent();
        members.push(updated);
      }
      const next = { ...revision, members, outputs: [] };
      const citations = packageCitationsSchema.parse(await metadata(next));
      // Resolve asynchronous policy work before the final inventory read; the IDB callback checks it again synchronously.
      if (packageCitationPolicyIdentity(await getExportDeploymentPolicy()) !== identity) throw new Error("Deployment settings changed. Review the citation changes again.");
      const latest = (await listActionPackages()).find(value => value.id === owned.id);
      assertCurrent();
      if (!sameReviewStoredValue(latest, owned)) throw new Error("The package changed. Reopen it and review the citation changes again.");
      return await reviseActionPackage(owned, members, signal, citations, current);
    } catch (cause) { throw boundaryError ?? cause; }
  });
}
