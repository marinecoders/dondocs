import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset, readPackageMemberDraft } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, reviseActionPackage } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations, savePackageCitations } from "@/lib/packageCitations";
import { preparePackageCitationReorder, applyPackageCitationReorder } from "@/lib/packageCitationReorder";
import { preparePackageAssembly } from "@/lib/actionPackageAssembly";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: async () => "Synthetic original" }));
vi.mock("@/config/classification", async importOriginal => ({
  ...await importOriginal<typeof import("@/config/classification")>(),
  getExportDeploymentPolicy: async () => policy,
  getExportDeploymentPolicySync: () => policy,
}));

async function fixture(label = "1", secondParagraph = false) {
  const pdfBytes = async (title: string) => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.setTitle(title);
    return new Uint8Array(await pdf.save()).buffer;
  };
  const bytes = await pdfBytes("Native embedded original");
  const firstBytes = await pdfBytes("First package original");
  const secondBytes = await pdfBytes("Second package original");
  const source = createBlankSession();
  source.documentMode = "custom";
  source.formData = { ...source.formData, subject: "SYNTHETIC LINKED ENCLOSURES", unitLine1: "FICTIONAL TRAINING UNIT", from: "Training Office", to: "Training Officer", date: "15 Nov 26", ssic: "1000", serial: "001", sigFirst: "Alex", sigLast: "Example", classLevel: "unclassified" };
  source.paragraphs = [{ id: "namespace:body.1", text: `Use enclosure (${label}).`, level: 0 },
    ...(secondParagraph ? [{ id: "namespace:body.2", text: `Also use enclosure (${label}).`, level: 0 }] : [])];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "namespace-source", epoch: 0, editSequence: 1, capturedAt: 1 }, {
    ...source, enclosures: [{ title: "Native enclosure", file: { name: "native.pdf", size: bytes.byteLength, data: bytes } }], endItems: [], publicationTables: {},
  }), "Synthetic native letter", "basic-letter");
  const first = await captureOriginalPackageMember({ name: "outer-one.pdf", data: firstBytes }, "enclosure", true);
  const second = await captureOriginalPackageMember({ name: "outer-two.pdf", data: secondBytes }, "enclosure", false);
  if (first.kind !== "original") throw new Error("Expected original member");
  let record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Synthetic enclosure namespaces"), [native, first, second]));
  const revision = getPackageRevision(record), occurrence = (await packageCitationOccurrences(revision))[0];
  const target = revision.citations!.targets.find(value => value.kind === "package-enclosure" && value.memberId === (label === "1" ? first.id : second.id))!;
  record = await linkPackageCitation(record, occurrence.source, target.id);
  return { record, native, first, second, bytes, firstBytes };
}

const unresolved = async (record: Parameters<typeof getPackageRevision>[0]) =>
  (await preparePackageAssembly(record, record.currentRevisionId, policy)).readiness.findings
    .filter(finding => finding.message.includes("Unresolved enclosure (2)"));

it("honors the exact current package link after reordering despite a separate native enclosure list", async () => {
  const { record, native, first, second, bytes, firstBytes } = await fixture();
  const previous = structuredClone(record);
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(record, {
    kind: "members", order: [native.id, second.id, first.id],
  }, policy));
  expect((await resolvePackageCitations(getPackageRevision(changed))).links[0].state).toBe("current");
  expect(await unresolved(changed)).toEqual([]);
  expect(record).toEqual(previous);
  expect(changed.revisions.slice(0, -1)).toEqual(previous.revisions);
  expect(await readPackageAsset(first.original)).toEqual(firstBytes);
  const member = getPackageRevision(changed).members.find(value => value.kind === "native")!;
  if (member.kind !== "native") throw new Error("Expected native member");
  expect((await readPackageMemberDraft(member)).reviewed.files[0]!.data).toEqual(bytes);
});

it.each(["unlinked", "stale", "wrong offset"] as const)("retains legacy rejection for an %s outer citation when a native list exists", async kind => {
  const { record } = await fixture("2");
  const citations = structuredClone(getPackageRevision(record).citations!);
  if (kind === "unlinked") citations.links = [];
  else if (kind === "stale") citations.links[0].source.textSha256 = "0".repeat(64);
  else { citations.links[0].source.start++; citations.links[0].source.end++; }
  const changed = await savePackageCitations(record, citations);
  expect(await unresolved(changed)).toHaveLength(1);
});

it("never uses another paragraph's matching enclosure label as authority", async () => {
  const { record } = await fixture("2", true);
  expect((await resolvePackageCitations(getPackageRevision(record))).links[0].state).toBe("current");
  expect(await unresolved(record)).toHaveLength(1);
});
