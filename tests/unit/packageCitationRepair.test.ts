import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, listActionPackages, renameActionPackage, reviseActionPackage, type PackageMember } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationCandidates, packageCitationOccurrences, resolvePackageCitations } from "@/lib/packageCitations";
import { applyPackageCitationRepair, packageCitationReadiness, preparePackageCitationRepair } from "@/lib/packageCitationRepair";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import { sameReviewStoredValue } from "@/lib/documentsDb";
import { buildPortableActionPackage, parsePortableActionPackage } from "@/lib/actionPackageTransfer";

const { livePolicy } = vi.hoisted(() => ({ livePolicy: { current: undefined as unknown } }));
vi.mock("@/config/classification", async original => ({
  ...await original<typeof import("@/config/classification")>(),
  getExportDeploymentPolicy: async () => livePolicy.current,
  getExportDeploymentPolicySync: () => livePolicy.current,
}));
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: async () => "Synthetic original PDF" }));
const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });

async function fixture(count = 2) {
  livePolicy.current = policy;
  const session = createBlankSession();
  session.documentMode = "custom";
  session.formData = { ...session.formData, subject: "SYNTHETIC REPAIR TRAINING", classLevel: "unclassified" };
  session.references = [{ letter: "a", title: "Training reference" }];
  session.paragraphs = [{ id: "repair-body", text: "Use enclosure (1), then enclosure (1) and reference (a).", level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "repair-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} }), "Repair letter", "basic-letter");
  const pdf = await PDFDocument.create(); pdf.addPage();
  const first = await captureOriginalPackageMember({ name: "signed-training.pdf", data: new Uint8Array(await pdf.save()).buffer }, "enclosure", true);
  if (first.kind !== "original") throw new Error("Expected original");
  const originals: PackageMember[] = Array.from({ length: count }, (_, index) => ({ ...structuredClone(first), id: `repair-original-${index}`, revisionId: `repair-original-revision-${index}`, label: `Training enclosure ${index + 1}` }));
  let record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Repair training"), [native, ...originals]));
  const revision = getPackageRevision(record), occurrences = await packageCitationOccurrences(revision);
  for (const occurrence of occurrences) {
    const target = revision.citations!.targets.find(value => occurrence.source.kind === "reference" ? value.kind === "reference" : value.kind === "package-enclosure" && value.memberId === originals[0].id)!;
    record = await linkPackageCitation(record, occurrence.source, target.id);
  }
  const broken = await reviseActionPackage(record, getPackageRevision(record).members.filter(value => value.id !== originals[0].id));
  return { record, broken, native, first, originals };
}

it("reports tracked missing targets with actionable member/paragraph context and distinct literal advice", async () => {
  const { broken } = await fixture();
  const findings = await packageCitationReadiness(getPackageRevision(broken));
  expect(findings.filter(value => value.severity === "error")).toHaveLength(2);
  expect(findings[0].message).toContain("Repair letter · paragraph 1");
  expect(findings[0].message).toContain("target changed or is missing");
  expect(findings.find(value => value.severity === "warning")?.message).toContain("Unlinked literal");
  expect(await packageCitationReadiness({ ...getPackageRevision(broken), citations: undefined })).toEqual([]);
});

it("cannot assemble a package whose tracked linked target is missing", async () => {
  const { broken } = await fixture();
  const { preparePackageAssembly, assemblePackage } = await import("@/lib/actionPackageAssembly");
  const prepared = await preparePackageAssembly(broken, broken.currentRevisionId, policy);
  expect(prepared.readiness.state).toBe("incomplete");
  expect(prepared.readiness.findings.some(value => value.severity === "error" && value.message.includes("repair linked citation"))).toBe(true);
  prepared.readiness.state = "ready";
  prepared.readiness.findings = [];
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  await expect(assemblePackage(prepared, ports)).rejects.toThrow();
  expect(ports.compile).not.toHaveBeenCalled();
});

it("repairs one shared-target link without retargeting the other or changing historical bytes", async () => {
  const { broken, first, originals } = await fixture();
  const previous = structuredClone(broken), bytes = await readPackageAsset(first.original);
  const revision = getPackageRevision(broken), resolved = await resolvePackageCitations(revision);
  const oldLinks = resolved.links.filter(value => value.state !== "current");
  const occurrence = (await packageCitationOccurrences(revision)).find(value => sameReviewStoredValue(value.source, oldLinks[0].link.source))!;
  const target = (await packageCitationCandidates(revision)).find(value => value.target.kind === "package-enclosure" && value.target.memberId === originals[1].id)!;
  const prepared = await preparePackageCitationRepair(broken, { kind: "relink", linkId: oldLinks[0].link.id, source: occurrence.source, target: target.target }, policy);
  expect(prepared.changesText).toBe(false);
  const repaired = await applyPackageCitationRepair(prepared);
  expect(broken).toEqual(previous);
  expect(repaired.revisions.slice(0, -1)).toEqual(previous.revisions);
  const result = await resolvePackageCitations(getPackageRevision(repaired));
  expect(result.links.find(value => value.link.id === oldLinks[0].link.id)?.state).toBe("current");
  const other = result.links.find(value => value.link.id === oldLinks[1].link.id)!;
  expect(other.state).toBe("missing");
  expect(other.link).toEqual(oldLinks[1].link);
  expect(other.link.targetId).toBe(oldLinks[0].link.targetId);
  expect(await readPackageAsset(first.original)).toEqual(bytes);
});

it("rewrites only a reviewed label and rebases other current links after a variable-width change", async () => {
  const { broken, originals } = await fixture(12);
  const revision = getPackageRevision(broken), links = await resolvePackageCitations(revision);
  const link = links.links.find(value => value.link.source.kind === "enclosure")!;
  const occurrence = (await packageCitationOccurrences(revision)).find(value => sameReviewStoredValue(value.source, link.link.source))!;
  const target = (await packageCitationCandidates(revision)).find(value => value.target.kind === "package-enclosure" && value.target.memberId === originals[11].id)!;
  const prepared = await preparePackageCitationRepair(broken, { kind: "relink", linkId: link.link.id, source: occurrence.source, target: target.target }, policy);
  expect(prepared.changesText).toBe(true);
  expect(prepared.after).toContain("label 1 → 11");
  const repaired = await applyPackageCitationRepair(prepared), next = getPackageRevision(repaired);
  const native = next.members.find(value => value.kind === "native")!;
  expect(native.kind === "native" && native.session.paragraphs[0].text).toBe("Use enclosure (11), then enclosure (1) and reference (a).");
  const resolved = await resolvePackageCitations(next);
  expect(resolved.links.find(value => value.link.id === link.link.id)?.state).toBe("current");
  expect(resolved.links.find(value => value.link.source.kind === "reference")?.state).toBe("current");
  expect(resolved.links.find(value => value.link.source.kind === "reference")!.link.source.start).toBe(links.links.find(value => value.link.source.kind === "reference")!.link.source.start + 1);
  expect(resolved.links.filter(value => value.state !== "current")).toHaveLength(1);
  const transferred = (await parsePortableActionPackage(await buildPortableActionPackage(repaired))).record;
  expect(getPackageRevision(transferred).citations).toEqual(next.citations);
  expect((await resolvePackageCitations(getPackageRevision(transferred))).links.map(value => value.state)).toEqual(resolved.links.map(value => value.state));
});

it("discards only a link with an explicit literal warning and removes only unused targets", async () => {
  const { broken } = await fixture();
  const revision = getPackageRevision(broken), link = revision.citations!.links[0];
  await expect(preparePackageCitationRepair(broken, { kind: "remove-target", targetId: link.targetId }, policy)).rejects.toThrow(/every linked citation/);
  const prepared = await preparePackageCitationRepair(broken, { kind: "discard-link", linkId: link.id }, policy);
  expect(prepared.discardsLink).toBe(true);
  expect(prepared.explanation).toContain("text stays literal");
  const next = await applyPackageCitationRepair(prepared);
  expect(getPackageRevision(next).members).toEqual(revision.members);
  expect(getPackageRevision(next).citations!.links).not.toContainEqual(link);
  const unused = getPackageRevision(next).citations!.targets.find(target => !getPackageRevision(next).citations!.links.some(link => link.targetId === target.id))!;
  const removed = await applyPackageCitationRepair(await preparePackageCitationRepair(next, { kind: "remove-target", targetId: unused.id }, policy));
  expect(getPackageRevision(removed).citations!.targets.some(target => target.id === unused.id)).toBe(false);
});

it("rejects forged source choices, mismatched citation kinds and foreign target bindings", async () => {
  const { broken } = await fixture(), revision = getPackageRevision(broken);
  const link = revision.citations!.links[0], occurrence = (await packageCitationOccurrences(revision))[0], target = (await packageCitationCandidates(revision))[0];
  await expect(preparePackageCitationRepair(broken, { kind: "relink", linkId: link.id, source: { ...occurrence.source, start: occurrence.source.start + 1 }, target: target.target }, policy)).rejects.toThrow(/exact supported occurrence/);
  await expect(preparePackageCitationRepair(broken, { kind: "relink", linkId: link.id, source: occurrence.source, target: { ...target.target, memberId: "unrelated" } }, policy)).rejects.toThrow(/current target/);
  const otherKind = (await packageCitationOccurrences(revision)).find(value => value.source.kind !== link.source.kind)!;
  await expect(preparePackageCitationRepair(broken, { kind: "relink", linkId: link.id, source: otherKind.source, target: target.target }, policy)).rejects.toThrow(/same citation kind/);
  await expect(applyPackageCitationRepair({} as never)).rejects.toThrow(/Review this citation repair again/);
});

it("preserves the prior package after cancellation, detached ownership, changed policy, stale CAS and repeated apply", async () => {
  const { broken } = await fixture(), linkId = getPackageRevision(broken).citations!.links[0].id;
  const prepare = () => preparePackageCitationRepair(broken, { kind: "discard-link", linkId }, policy);
  const aborted = new AbortController(); aborted.abort();
  await expect(applyPackageCitationRepair(await prepare(), aborted.signal)).rejects.toThrow();
  await expect(applyPackageCitationRepair(await prepare(), undefined, () => false)).rejects.toThrow();
  livePolicy.current = resolveExportDeploymentPolicy({ hostname: "changed.localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
  await expect(applyPackageCitationRepair(await prepare())).rejects.toThrow(/settings changed|policy/i);
  livePolicy.current = policy;
  expect((await listActionPackages()).find(value => value.id === broken.id)).toEqual(broken);
  const prepared = await prepare();
  const changed = await renameActionPackage(broken, "Changed in another tab");
  await expect(applyPackageCitationRepair(prepared)).rejects.toThrow(/changed/);
  expect((await listActionPackages()).find(value => value.id === broken.id)).toEqual(changed);
  const nextPrepared = await preparePackageCitationRepair(changed, { kind: "discard-link", linkId }, policy);
  const saved = await applyPackageCitationRepair(nextPrepared);
  await expect(applyPackageCitationRepair(nextPrepared)).rejects.toThrow(/changed/);
  expect((await listActionPackages()).find(value => value.id === broken.id)).toEqual(saved);
});
