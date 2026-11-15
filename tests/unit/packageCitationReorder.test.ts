import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset, readPackageMemberDraft } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, listActionPackages, renameActionPackage, reviseActionPackage, type ActionPackage } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations } from "@/lib/packageCitations";
import { applyPackageCitationReorder, preparePackageCitationReorder, type PreparedPackageCitationReorder } from "@/lib/packageCitationReorder";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import { buildPortableActionPackage, parsePortableActionPackage } from "@/lib/actionPackageTransfer";
import { referenceLetterAt } from "@/lib/referenceLetters";
import * as db from "@/lib/documentsDb";

const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
let currentPolicy = policy;
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/config/classification", async importOriginal => ({
  ...await importOriginal<typeof import("@/config/classification")>(),
  getExportDeploymentPolicy: async () => currentPolicy,
  getExportDeploymentPolicySync: () => currentPolicy,
}));
beforeEach(() => { vi.restoreAllMocks(); currentPolicy = policy; });

async function pdfBytes() { const pdf = await PDFDocument.create(); pdf.addPage(); return new Uint8Array(await pdf.save()).buffer; }
async function fixture(text = "😀 Use reference (a), reference (b), and reference (a).", referenceCount = 2) {
  const source = createBlankSession();
  source.references = Array.from({ length: referenceCount }, (_, index) => ({ letter: referenceLetterAt(index), title: `Synthetic source ${index}` }));
  source.paragraphs = [{ id: "reorder-body", text, level: 0 }];
  const original = await pdfBytes();
  const document = { ...source, enclosures: [
    { title: "First native enclosure", file: { name: "first.pdf", size: original.byteLength, data: original } },
    { title: "Second native enclosure", file: { name: "second.pdf", size: original.byteLength, data: original.slice(0) } },
  ], endItems: [], publicationTables: {} };
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "reorder-source", epoch: 0, editSequence: 1, capturedAt: 1 }, document), "Synthetic letter", "basic-letter");
  const first = await captureOriginalPackageMember({ name: "first-original.pdf", data: original }, "enclosure", true);
  const second = await captureOriginalPackageMember({ name: "second-original.pdf", data: original }, "enclosure", false);
  if (first.kind !== "original" || second.kind !== "original") throw new Error("Expected original files");
  const record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Reorder training"), [native, first, second]));
  return { record, native, first, second, original };
}
async function linkAll(record: ActionPackage, packageEnclosures = false) {
  for (const occurrence of await packageCitationOccurrences(getPackageRevision(record))) {
    const targets = (await resolvePackageCitations(getPackageRevision(record))).targets;
    const target = targets.find(value => value.state === "current" && value.citationLabel?.toLowerCase() === occurrence.literal.toLowerCase()
      && (occurrence.source.kind === "reference" ? value.target.kind === "reference" : value.target.kind === (packageEnclosures ? "package-enclosure" : "native-enclosure")))!;
    record = await linkPackageCitation(record, occurrence.source, target.target.id);
  }
  return record;
}
async function persisted(record: ActionPackage) { return (await listActionPackages()).find(value => value.id === record.id)!; }

async function enclosureClause(text: string, kind: "native" | "package", offset = 1) {
  const source = createBlankSession();
  source.references = [];
  source.paragraphs = [{ id: "clause-reorder-body", text, level: 0 }];
  source.enclosures = kind === "native" ? ["First", "Second", "Third"].map(title => ({ title })) : [];
  if (offset !== 1) { source.docType = "new_page_endorsement"; source.formData.startingEnclosureNumber = offset; }
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "clause-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...source, endItems: [], publicationTables: {} }), "Clause training", "basic-letter");
  const members = [native];
  const originals = [];
  if (kind === "package") for (const name of ["one.pdf", "two.pdf", "three.pdf"]) originals.push(await captureOriginalPackageMember({ name, data: await pdfBytes() }, "enclosure", false));
  let record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Enclosure clause training"), [...members, ...originals]));
  for (const occurrence of await packageCitationOccurrences(getPackageRevision(record))) {
    const target = (await resolvePackageCitations(getPackageRevision(record))).targets.find(value => value.citationLabel === occurrence.literal && value.target.kind === (kind === "native" ? "native-enclosure" : "package-enclosure"));
    if (target) record = await linkPackageCitation(record, occurrence.source, target.target.id);
  }
  return { record, native, originals };
}

it("previews without writes, then updates repeated linked references atomically while preserving old revisions and embedded originals", async () => {
  const fixtureValue = await fixture();
  const record = await linkAll(fixtureValue.record), before = structuredClone(record);
  const plan = await preparePackageCitationReorder(record, { kind: "references", memberId: fixtureValue.native.id, order: [1, 0] }, policy);
  expect((await persisted(record)).sequence).toBe(record.sequence);
  expect(plan.changes[0].before).toContain("reference (a), reference (b), and reference (a)");
  expect(plan.changes[0].after).toContain("reference (b), reference (a), and reference (b)");
  const changed = await applyPackageCitationReorder(plan);
  expect(record).toEqual(before);
  expect(changed.revisions.slice(0, -1)).toEqual(record.revisions);
  const revision = getPackageRevision(changed), native = revision.members.find(member => member.kind === "native")!;
  expect(native.kind).toBe("native");
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.session.references.map(value => value.title)).toEqual(["Synthetic source 1", "Synthetic source 0"]);
  expect(native.session.paragraphs[0].text).toBe("😀 Use reference (b), reference (a), and reference (b).");
  expect((await resolvePackageCitations(revision)).links.every(value => value.state === "current")).toBe(true);
  expect(revision.citations!.links.map(value => value.id)).toEqual(getPackageRevision(record).citations!.links.map(value => value.id));
  const { reviewed } = await readPackageMemberDraft(native);
  expect(new Uint8Array(reviewed.files[0]!.data)).toEqual(new Uint8Array(fixtureValue.original));
  expect(new Uint8Array(await readPackageAsset(fixtureValue.first.original))).toEqual(new Uint8Array(fixtureValue.original));
  const transferred = (await parsePortableActionPackage(await buildPortableActionPackage(changed))).record;
  expect((await resolvePackageCitations(getPackageRevision(transferred))).links.every(value => value.state === "current")).toBe(true);
});

it("adjusts following occurrence ranges when a label grows and preserves uppercase citation spelling", async () => {
  const f = await fixture("😀 Use reference (A), then reference (b), then reference (a0).", 27);
  const record = await linkAll(f.record), order = Array.from({ length: 27 }, (_, index) => index);
  [order[0], order[26]] = [order[26], order[0]];
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(record, { kind: "references", memberId: f.native.id, order }, policy));
  const member = getPackageRevision(changed).members.find(value => value.kind === "native")!;
  if (member.kind !== "native") throw new Error("Expected native");
  expect(member.session.paragraphs[0].text).toBe("😀 Use reference (A0), then reference (b), then reference (a).");
  const resolved = await resolvePackageCitations(getPackageRevision(changed));
  expect(resolved.links.every(value => value.state === "current")).toBe(true);
  expect(resolved.links[1].link.source.start).toBe(getPackageRevision(record).citations!.links[1].source.start + 1);
});

it("reorders native enclosures with exact attached bytes and deliberate label updates", async () => {
  const f = await fixture("Follow enclosure (1), then enclosure (2)."), record = await linkAll(f.record);
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(record, { kind: "enclosures", memberId: f.native.id, order: [1, 0] }, policy));
  const native = getPackageRevision(changed).members.find(member => member.kind === "native")!;
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.session.enclosures.map(value => value.title)).toEqual(["Second native enclosure", "First native enclosure"]);
  expect(native.session.paragraphs[0].text).toBe("Follow enclosure (2), then enclosure (1).");
  expect((await readPackageMemberDraft(native)).reviewed.files.every(file => file && file.data.byteLength === f.original.byteLength)).toBe(true);
  expect((await resolvePackageCitations(getPackageRevision(changed))).links.every(value => value.state === "current")).toBe(true);
});

it("reorders package enclosure members and keeps the linked target identity and original signed bytes", async () => {
  const f = await fixture("Follow enclosure (1), then enclosure (2)."), record = await linkAll(f.record, true);
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(record, { kind: "members", order: [f.native.id, f.second.id, f.first.id] }, policy));
  const revision = getPackageRevision(changed), native = revision.members[0];
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.session.paragraphs[0].text).toBe("Follow enclosure (2), then enclosure (1).");
  expect(revision.members[2]).toEqual(f.first);
  expect(revision.citations!.links.map(value => value.targetId)).toEqual(getPackageRevision(record).citations!.links.map(value => value.targetId));
  expect((await resolvePackageCitations(revision)).links.every(value => value.state === "current")).toBe(true);
  expect(new Uint8Array(await readPackageAsset(f.first.original))).toEqual(new Uint8Array(f.original));
});

it.each(["Use reference (a).", 'Use "reference (a)".', "Use reference (a) through (b)."])("rejects unlinked or unsupported reference text before publishing: %s", async text => {
  const f = await fixture(text);
  await expect(preparePackageCitationReorder(f.record, { kind: "references", memberId: f.native.id, order: [1, 0] }, policy)).rejects.toThrow(/unlinked|quoted|range|manually/i);
  expect((await persisted(f.record)).sequence).toBe(f.record.sequence);
});

it("rejects ambiguous enclosure lists and stale links rather than silently updating part of a clause", async () => {
  const f = await fixture("Use enclosures (1) and (2)."), record = await linkAll(f.record, true);
  await expect(preparePackageCitationReorder(record, { kind: "members", order: [f.native.id, f.second.id, f.first.id] }, policy)).rejects.toThrow(/lists or ranges/);
  const changed = await reviseActionPackage(record, getPackageRevision(record).members.map(value => value.id === f.native.id ? { ...value, label: "Changed source" } : value));
  await expect(preparePackageCitationReorder(changed, { kind: "members", order: [f.native.id, f.second.id, f.first.id] }, policy)).rejects.toThrow(/stale or missing/);
});

it("rejects unlinked native enclosure citations even when metadata has no enclosure identities", async () => {
  const f = await fixture("Use reference (a), then enclosure (1).");
  const metadata = structuredClone(getPackageRevision(f.record).citations!);
  metadata.targets = metadata.targets.filter(target => target.kind === "reference");
  let record = await reviseActionPackage(f.record, getPackageRevision(f.record).members, undefined, metadata);
  const source = (await packageCitationOccurrences(getPackageRevision(record))).find(value => value.source.kind === "reference")!;
  record = await linkPackageCitation(record, source.source, metadata.targets[0].id);
  await expect(preparePackageCitationReorder(record, { kind: "enclosures", memberId: f.native.id, order: [1, 0] }, policy)).rejects.toThrow(/unlinked/);
  expect(await persisted(record)).toEqual(record);
  await expect(preparePackageCitationReorder(record, { kind: "members", order: [f.native.id, f.second.id, f.first.id] }, policy)).rejects.toThrow(/unlinked/);
  expect(await persisted(record)).toEqual(record);
});

it.each([" & ", " ", " / ", " ＆ ", " plus ", " along with ", " and ", " through "])("rejects an unchanged first linked enclosure followed by an unlinked moving label across %j", async separator => {
  for (const kind of ["native", "package"] as const) {
    const f = await enclosureClause(`Use enclosures (1)${separator}(2).`, kind);
    expect(getPackageRevision(f.record).citations!.links).toHaveLength(1);
    const operation = kind === "native" ? { kind: "enclosures" as const, memberId: f.native.id, order: [0, 2, 1] }
      : { kind: "members" as const, order: [f.native.id, f.originals[0].id, f.originals[2].id, f.originals[1].id] };
    await expect(preparePackageCitationReorder(f.record, operation, policy)).rejects.toThrow(/lists or ranges/);
    expect(await persisted(f.record)).toEqual(f.record);
  }
});

it.each([" and 2.", " AND 2.", " through 2.", " — 2.", " ＆ 2."])("preserves rejection of unsupported enclosure continuations without parentheses: %s", async tail => {
  const f = await enclosureClause(`Use enclosures (1)${tail}`, "native");
  await expect(preparePackageCitationReorder(f.record, { kind: "enclosures", memberId: f.native.id, order: [0, 2, 1] }, policy)).rejects.toThrow(/lists or ranges/);
  expect(await persisted(f.record)).toEqual(f.record);
});

it("rejects affected zero-padded labels in native, package and endorsement numbering without normalizing the text", async () => {
  for (const [kind, literal, offset] of [["native", "01", 1], ["package", "01", 1], ["native", "010", 10]] as const) {
    const f = await enclosureClause(`Use enclosure (${literal}).`, kind, offset);
    expect(getPackageRevision(f.record).citations!.links).toHaveLength(0);
    const operation = kind === "native" ? { kind: "enclosures" as const, memberId: f.native.id, order: [1, 0, 2] }
      : { kind: "members" as const, order: [f.native.id, f.originals[1].id, f.originals[0].id, f.originals[2].id] };
    await expect(preparePackageCitationReorder(f.record, operation, policy)).rejects.toThrow(/unlinked/);
    expect(await persisted(f.record)).toEqual(f.record);
    const native = getPackageRevision(f.record).members[0];
    if (native.kind !== "native") throw new Error("Expected native");
    expect(native.session.paragraphs[0].text).toBe(`Use enclosure (${literal}).`);
  }
});

it.each(['Use "enclosure (2)".', "Use `enclosure (2)`.", "Use https://example.test/enclosure(2)."])("keeps protected enclosure text outside linked rewriting: %s", async text => {
  for (const kind of ["native", "package"] as const) {
    const f = await enclosureClause(text, kind);
    expect(getPackageRevision(f.record).citations!.links).toHaveLength(0);
    const operation = kind === "native" ? { kind: "enclosures" as const, memberId: f.native.id, order: [0, 2, 1] }
      : { kind: "members" as const, order: [f.native.id, f.originals[0].id, f.originals[2].id, f.originals[1].id] };
    await expect(preparePackageCitationReorder(f.record, operation, policy)).rejects.toThrow(/unlinked/);
    expect(await persisted(f.record)).toEqual(f.record);
  }
});

it("leaves explicit paragraph, page and section designators unchanged beside a linked enclosure", async () => {
  const f = await enclosureClause("Use enclosure (1), paragraph (2), page (2), and section (2).", "native");
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(f.record, { kind: "enclosures", memberId: f.native.id, order: [1, 0, 2] }, policy));
  const native = getPackageRevision(changed).members[0];
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.session.paragraphs[0].text).toBe("Use enclosure (2), paragraph (2), page (2), and section (2).");
});

it("ends enclosure context when an explicit paragraph category starts its own numeric list", async () => {
  const f = await enclosureClause("Use enclosure (1). See paragraphs (2) and (3).", "native");
  const changed = await applyPackageCitationReorder(await preparePackageCitationReorder(f.record, { kind: "enclosures", memberId: f.native.id, order: [1, 0, 2] }, policy));
  const native = getPackageRevision(changed).members[0];
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.session.paragraphs[0].text).toBe("Use enclosure (2). See paragraphs (2) and (3).");
});

it("rejects forged plans, incomplete orders and late source updates without changing the reviewed package", async () => {
  const f = await fixture(), record = await linkAll(f.record);
  await expect(applyPackageCitationReorder({} as PreparedPackageCitationReorder)).rejects.toThrow(/review/);
  await expect(preparePackageCitationReorder(record, { kind: "references", memberId: f.native.id, order: [0, 0] }, policy)).rejects.toThrow(/unique/);
  const plan = await preparePackageCitationReorder(record, { kind: "references", memberId: f.native.id, order: [1, 0] }, policy);
  const renamed = await renameActionPackage(record, "Changed in another tab");
  await expect(applyPackageCitationReorder(plan)).rejects.toThrow(/package changed/i);
  expect(await persisted(record)).toEqual(renamed);
});

it("checks current policy and owner inside the actual IDB commit callback", async () => {
  for (const cause of ["policy", "owner"] as const) {
    currentPolicy = policy;
    const f = await fixture(), record = await linkAll(f.record);
    const plan = await preparePackageCitationReorder(record, { kind: "references", memberId: f.native.id, order: [1, 0] }, policy);
    let owner = true;
    const compare = db.idbCompareActionPackage;
    const spy = vi.spyOn(db, "idbCompareActionPackage").mockImplementationOnce((before, after, current) => {
      if (cause === "policy") currentPolicy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "confidential", allowedLevels: ["unclassified", "confidential"] }, runtime: { status: "absent" } });
      else owner = false;
      return compare(before, after, current);
    });
    await expect(applyPackageCitationReorder(plan, undefined, () => owner)).rejects.toThrow(cause === "policy" ? /Deployment settings changed/ : /review was closed/);
    expect((await persisted(record)).sequence).toBe(record.sequence);
    spy.mockRestore();
  }
});

it("preserves the previous package when a native asset write fails or the operation is aborted", async () => {
  const f = await fixture(), record = await linkAll(f.record);
  const plan = await preparePackageCitationReorder(record, { kind: "references", memberId: f.native.id, order: [1, 0] }, policy);
  vi.spyOn(db, "idbPutAttachment").mockResolvedValueOnce(false);
  await expect(applyPackageCitationReorder(plan)).rejects.toThrow(/Could not save/);
  expect(await persisted(record)).toEqual(record);
  const controller = new AbortController(); controller.abort();
  await expect(applyPackageCitationReorder(plan, controller.signal)).rejects.toThrow();
  expect(await persisted(record)).toEqual(record);
});
