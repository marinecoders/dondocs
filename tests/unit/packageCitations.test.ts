import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from "@/lib/actionPackageAssets";
import { actionPackageSchema, createActionPackage, duplicateActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from "@/lib/actionPackages";
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from "@/lib/actionPackageTransfer";
import { packageCitationsSchema } from "@/lib/packageCitationSchema";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationCandidates, packageCitationOccurrences, packageCitationTargetLabel, resolvePackageCitations, validCitationBoundary } from "@/lib/packageCitations";
import { portableResourceDigest } from "@/lib/portableResources";

vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));

async function fixture() {
  const session = createBlankSession();
  session.formData = { ...session.formData, subject: "SYNTHETIC CITATION TRAINING", classLevel: "unclassified" };
  session.references = [{ letter: "a", title: "Training reference" }, { letter: "b", title: "Training reference" }];
  session.paragraphs = [{ id: "citation-body", text: "😀 Follow reference (a) and enclosure (1).", level: 0 }];
  session.enclosures = [{ title: "Native training enclosure" }];
  const captured = captureDocumentRevision({ documentId: "citation-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} });
  const native = await capturePackageMember(captured, "Training letter", "basic-letter");
  const pdf = await PDFDocument.create(); pdf.addPage();
  const original = await captureOriginalPackageMember({ name: "signed-training.pdf", data: new Uint8Array(await pdf.save()).buffer }, "enclosure", true);
  if (original.kind !== "original") throw new Error("Expected original member");
  const record = await reviseActionPackage(await createActionPackage("Citation training"), [native, original]);
  return { record, native, original };
}

it("keeps legacy packages valid and initializes distinct durable identities without changing captured bytes", async () => {
  const { record, native, original } = await fixture();
  expect(actionPackageSchema.parse(record).revisions.at(-1)?.citations).toBeUndefined();
  const prior = structuredClone(record), bytes = await readPackageAsset(original.original);
  const updated = await initializePackageCitationTargets(record);
  expect(record).toEqual(prior);
  expect(updated.revisions.slice(0, -1)).toEqual(record.revisions);
  expect(getPackageRevision(updated).members).toEqual([native, original]);
  expect(getPackageRevision(updated).citations?.targets).toHaveLength(4);
  const references = getPackageRevision(updated).citations!.targets.filter(target => target.kind === "reference");
  expect(references[0].id).not.toBe(references[1].id);
  expect(new Uint8Array(await readPackageAsset(original.original))).toEqual(new Uint8Array(bytes));
  expect(JSON.stringify(getPackageRevision(updated).citations)).not.toContain("Training reference");
});

it("resolves identities after schema, storage, duplicate and portable transfer roundtrips", async () => {
  const { record } = await fixture();
  const identified = await initializePackageCitationTargets(record);
  const source = (await packageCitationOccurrences(getPackageRevision(identified))).find(value => value.source.kind === "reference")!;
  const target = getPackageRevision(identified).citations!.targets.find(value => value.kind === "reference" && value.index === 0)!;
  const linked = await linkPackageCitation(identified, source.source, target.id);
  const fromDb = (await listActionPackages()).find(value => value.id === linked.id)!;
  for (const value of [actionPackageSchema.parse(linked), fromDb, await duplicateActionPackage(linked), (await parsePortableActionPackage(await buildPortableActionPackage(linked))).record]) {
    const resolved = await resolvePackageCitations(getPackageRevision(value));
    expect(resolved.targets.every(target => target.state === "current")).toBe(true);
    expect(resolved.links[0].state).toBe("current");
    expect(resolved.links[0].link.targetId).toBe(target.id);
    await expect(initializePackageCitationTargets(value)).rejects.toThrow(/already have identities/);
  }
  const imported = await importPortableActionPackage(await buildPortableActionPackage(linked));
  expect((await resolvePackageCitations(getPackageRevision(imported))).links[0].state).toBe("current");
});

it("retains exact identities through member reorder and marks changed or removed owners explicitly", async () => {
  const { record } = await fixture();
  const identified = await initializePackageCitationTargets(record), revision = getPackageRevision(identified);
  const reordered = await reviseActionPackage(identified, [...revision.members].reverse());
  expect(getPackageRevision(reordered).citations).toEqual(revision.citations);
  expect((await resolvePackageCitations(getPackageRevision(reordered))).targets.every(value => value.state === "current")).toBe(true);
  const changed = await reviseActionPackage(reordered, getPackageRevision(reordered).members.map(value => value.kind === "native" ? { ...value, label: "Changed label" } : value));
  const stale = await resolvePackageCitations(getPackageRevision(changed));
  expect(stale.targets.filter(value => value.target.kind !== "package-enclosure").every(value => value.state === "stale")).toBe(true);
  const removed = await reviseActionPackage(changed, []);
  expect(getPackageRevision(removed).citations).toEqual(revision.citations);
  expect((await resolvePackageCitations(getPackageRevision(removed))).targets.every(value => value.state === "missing")).toBe(true);
  expect(removed.revisions.slice(0, identified.revisions.length)).toEqual(identified.revisions);
});

it("requires initial labels to match and never links a same-title reference by inference", async () => {
  const { record } = await fixture();
  const identified = await initializePackageCitationTargets(record), revision = getPackageRevision(identified);
  const occurrence = (await packageCitationOccurrences(revision)).find(value => value.source.kind === "reference")!;
  const targets = revision.citations!.targets.filter(value => value.kind === "reference");
  await expect(linkPackageCitation(identified, occurrence.source, targets[1].id)).rejects.toThrow(/label does not match/);
  expect((await listActionPackages()).find(value => value.id === identified.id)?.sequence).toBe(identified.sequence);
  const linked = await linkPackageCitation(identified, occurrence.source, targets[0].id);
  await expect(linkPackageCitation(linked, occurrence.source, targets[0].id)).rejects.toThrow(/Duplicate citation occurrence/);
});

it("cannot link a member's literal reference to a different member's reference list", async () => {
  const { record, native } = await fixture();
  const other = { ...native, id: "second-letter", revisionId: "second-revision" };
  const expanded = await reviseActionPackage(record, [...getPackageRevision(record).members, other]);
  const identified = await initializePackageCitationTargets(expanded), revision = getPackageRevision(identified);
  const source = (await packageCitationOccurrences(revision)).find(value => value.source.memberId === native.id && value.source.kind === "reference")!;
  const target = revision.citations!.targets.find(value => value.kind === "reference" && value.memberId === other.id && value.index === 0)!;
  await expect(linkPackageCitation(identified, source.source, target.id)).rejects.toThrow(/own list/);
  const metadata = structuredClone(revision.citations!);
  metadata.links.push({ id: "forged-link", source: source.source, targetId: target.id });
  expect(packageCitationsSchema.safeParse(metadata).success).toBe(false);
});

it("rejects forged offsets, stale submissions, duplicates and unsupported metadata", async () => {
  const { record } = await fixture();
  const identified = await initializePackageCitationTargets(record), revision = getPackageRevision(identified);
  const source = (await packageCitationOccurrences(revision))[0].source;
  const target = revision.citations!.targets.find(value => value.kind === "reference" && value.index === 0)!;
  await expect(linkPackageCitation(identified, { ...source, start: source.start + 1 }, target.id)).rejects.toThrow(/text changed/);
  for (const metadata of [
    { ...revision.citations!, version: 2 },
    { ...revision.citations!, hidden: "unexpected" },
    { ...revision.citations!, targets: [...revision.citations!.targets, target] },
    { ...revision.citations!, links: [{ id: "bad-link", source, targetId: "unknown-target" }] },
    { ...revision.citations!, links: [{ id: "bad-link", source: { ...source, end: source.start }, targetId: target.id }] },
  ]) expect(packageCitationsSchema.safeParse(metadata).success).toBe(false);
  expect(validCitationBoundary("😀x", 1)).toBe(false);
  expect(validCitationBoundary("😀x", 2)).toBe(true);
  expect(validCitationBoundary("x", -1)).toBe(false);
  const forged = structuredClone(identified), next = structuredClone(revision);
  next.id = "forged-revision"; next.parentId = revision.id;
  next.citations!.targets[0].memberId = "unrelated-owner";
  forged.currentRevisionId = next.id; forged.revisions.push(next);
  expect(actionPackageSchema.safeParse(forged).success).toBe(false);
});

it("keeps quoted, coded and URL enclosure text out of editable occurrences", async () => {
  const { record } = await fixture();
  const revision = getPackageRevision(record);
  const native = revision.members.find(value => value.kind === "native")!;
  if (native.kind !== "native") throw new Error("Expected native");
  native.session.paragraphs[0].text = 'Use enclosure (1). "enclosure (2)" `enclosure (3)` https://example.test/enclosure(4)\n> enclosure (5)\nUse reference (a).';
  const occurrences = await packageCitationOccurrences(revision);
  expect(occurrences.map(value => [value.source.kind, value.literal])).toEqual([["reference", "a"], ["enclosure", "1"]]);
});

it("derives package enclosure labels from enclosure-role order, independently of native list labels", async () => {
  const { record, original } = await fixture();
  const second = { ...original, id: "another-enclosure", revisionId: "another-original" };
  const expanded = await reviseActionPackage(record, [original, getPackageRevision(record).members[0], second]);
  const identified = await initializePackageCitationTargets(expanded), revision = getPackageRevision(identified);
  const target = revision.citations!.targets.find(value => value.kind === "package-enclosure" && value.memberId === second.id)!;
  expect(await packageCitationTargetLabel(revision, target)).toBe("2");
  revision.members.reverse();
  expect(await packageCitationTargetLabel(revision, target)).toBe("1");
  expect((await packageCitationCandidates(revision)).find(value => value.target.kind === "native-enclosure")?.citationLabel).toBe("1");
});

it("marks an unchanged literal stale when its linked package enclosure moves to a different label", async () => {
  const { record, original } = await fixture();
  const expanded = await reviseActionPackage(record, [...getPackageRevision(record).members, { ...original, id: "moving-second", revisionId: "moving-second-revision" }]);
  const identified = await initializePackageCitationTargets(expanded), revision = getPackageRevision(identified);
  const occurrence = (await packageCitationOccurrences(revision)).find(value => value.source.kind === "enclosure")!;
  const target = revision.citations!.targets.find(value => value.kind === "package-enclosure" && value.memberId === original.id)!;
  const linked = await linkPackageCitation(identified, occurrence.source, target.id);
  const next = getPackageRevision(linked);
  const moved = await reviseActionPackage(linked, [next.members[0], next.members[2], next.members[1]]);
  const resolved = (await resolvePackageCitations(getPackageRevision(moved))).links[0];
  expect(resolved.target.state).toBe("current");
  expect(resolved.sourceState).toBe("current");
  expect(resolved.labelMatches).toBe(false);
  expect(resolved.state).toBe("stale");
});

it("uses the existing endorsement enclosure continuation offset for native targets", async () => {
  const { record } = await fixture(), revision = getPackageRevision(record);
  const native = revision.members.find(member => member.kind === "native")!;
  if (native.kind !== "native") throw new Error("Expected native");
  native.session.docType = "new_page_endorsement";
  native.session.formData.startingEnclosureNumber = 5;
  const candidate = (await packageCitationCandidates(revision)).find(value => value.target.kind === "native-enclosure")!;
  expect(candidate.citationLabel).toBe("5");
  expect(candidate.label).toContain("native enclosure (5)");
});

it("preserves the previous record after cancellation or a stale compare-and-swap", async () => {
  const { record, original } = await fixture();
  const hash = await portableResourceDigest(await readPackageAsset(original.original));
  const controller = new AbortController(); controller.abort();
  await expect(initializePackageCitationTargets(record, controller.signal)).rejects.toThrow();
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(record);
  const identified = await initializePackageCitationTargets(record);
  await expect(initializePackageCitationTargets(record)).rejects.toThrow(/changed in another tab/);
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(identified);
  expect(await portableResourceDigest(await readPackageAsset(original.original))).toBe(hash);
});
