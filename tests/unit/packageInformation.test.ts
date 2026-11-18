import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember } from "@/lib/actionPackageAssets";
import { actionPackageSchema, archiveActionPackage, commitActionPackage, createActionPackage, duplicateActionPackage,
  getPackageRevision, listActionPackages, reviseActionPackage } from "@/lib/actionPackages";
import { packageFactSchema, packageInformationSchema, packageInformationText, updatePackageInformation,
  type PackageInformation } from "@/lib/packageInformation";
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from "@/lib/actionPackageTransfer";
import { capturePackageBackup, restorePackageBackup, validatePackageBackup } from "@/lib/actionPackageBackup";
import { preparePackageAssembly } from "@/lib/actionPackageAssembly";
import { packageInputFingerprint } from "@/lib/packageRenderProvenance";
import { reviewPackageInformation } from "@/lib/actionPackageDisclosure";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import { preparePackageShare } from "@/lib/actionPackageShare";
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from "@/lib/packageReviewTransfer";
import { startPackageReview } from "@/lib/packageReviewRounds";
import { capturePackageTemplate, instantiatePackageTemplate } from "@/lib/packageTemplateLibrary";
import { useUIStore } from "@/stores/uiStore";

vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: vi.fn(async () => "") }));
const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
function information(value = "Alex Example"): PackageInformation {
  return { version: 1, participants: [{ id: "subject", label: "Subject person", role: "subject" }, { id: "requester", label: "Requesting official", role: "requester" }],
    facts: [{ id: "subject_name", label: "Name", participantId: "subject", kind: "text", value, source: { kind: "entered" } },
      { id: "requester_name", label: "Name", participantId: "requester", kind: "text", value: "Jamie Example", source: { kind: "document", label: "Captured training letter", field: "From", capturedAt: 100, sha256: "a".repeat(64) } },
      { id: "subject_identifier", label: "Training identifier", participantId: "subject", kind: "identifier", value: "00001234", source: { kind: "entered" } },
      { id: "amount", label: "Training amount", kind: "decimal", value: "12345678901234567890.0010", source: { kind: "entered" } },
      { id: "effective", label: "Effective date", kind: "date", value: "2028-02-29", source: { kind: "entered" } },
      { id: "confirmed", label: "Confirmed", kind: "boolean", value: false, source: { kind: "entered" } }] };
}
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("dondocs"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  if (db.objectStoreNames.length) await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], "readwrite");
    for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
}
async function fixture() {
  const session = createBlankSession();
  const snapshot = { ...session, endItems: [], publicationTables: {}, formData: { ...session.formData, subject: "Training action", unitLine1: "FICTIONAL TRAINING UNIT", from: "Training Office", to: "Training Officer", sigLast: "Example", classLevel: "unclassified" as const },
    paragraphs: [{ id: "body", text: "Synthetic training content.", level: 0 }] };
  const member = await capturePackageMember(captureDocumentRevision({ documentId: "training_source", epoch: 0, editSequence: 1, capturedAt: 100 }, snapshot), "Training letter", "basic-letter");
  return reviseActionPackage(await createActionPackage("Training action"), [member]);
}
beforeEach(async () => { vi.restoreAllMocks(); await createActionPackage("Initialize"); await clearDb(); useUIStore.setState({ storageHealth: "ok" }); });

describe("typed captured package information", () => {
  it("keeps role-specific facts, exact identifiers and decimal strings", () => {
    const value = packageInformationSchema.parse(information());
    expect(value.facts[2].value).toBe("00001234"); expect(value.facts[3].value).toBe("12345678901234567890.0010"); expect(value.facts[5].value).toBe(false);
    expect(value.facts[0].participantId).not.toBe(value.facts[1].participantId);
  });
  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-1-01", "2026-01-01T00:00:00Z"])("rejects invalid date %s", value => {
    expect(packageFactSchema.safeParse({ id: "date", label: "Date", kind: "date", value, source: { kind: "entered" } }).success).toBe(false);
  });
  it.each(["1e3", "Infinity", "NaN", "01", ".5", "1."])("rejects ambiguous decimal %s", value => {
    expect(packageFactSchema.safeParse({ id: "amount", label: "Amount", kind: "decimal", value, source: { kind: "entered" } }).success).toBe(false);
  });
  it("rejects duplicate IDs, unavailable participants, reserved keys and unbounded retained text", () => {
    const duplicates = information(); duplicates.facts.push(structuredClone(duplicates.facts[0])); expect(() => packageInformationSchema.parse(duplicates)).toThrow(/Duplicate package fact/);
    const people = information(); people.participants.push(structuredClone(people.participants[0])); expect(() => packageInformationSchema.parse(people)).toThrow(/Duplicate package participant/);
    const missing = information(); missing.facts[0].participantId = "absent"; expect(() => packageInformationSchema.parse(missing)).toThrow(/unavailable participant/);
    for (const id of ["constructor", "__proto__", "toString", "prototype"]) { const invalid = information(); invalid.facts[0].id = id; expect(() => packageInformationSchema.parse(invalid)).toThrow(/Reserved/); }
    const large = information(); large.facts = Array.from({ length: 30 }, (_, index) => ({ id: `f_${index}`, label: "Text", kind: "text", value: "x".repeat(10000), source: { kind: "entered" } }));
    expect(() => packageInformationSchema.parse(large)).toThrow(/256 KB/);
    expect(() => packageInformationSchema.parse({ ...information(), version: 2 })).toThrow();
    expect(() => packageInformationSchema.parse({ ...information(), execute: "anything" })).toThrow();
    const control = information(); control.facts[0].label = "Bad\u0000label";
    expect(() => packageInformationSchema.parse(control)).toThrow(/single-line/);
    expect(packageInformationSchema.parse(information("First line\nSecond line")).facts[0].value).toContain("\n");
  });
  it("does not treat source provenance as a live pointer or signer authority", () => {
    const value = information(); value.facts[0].source = { kind: "document", label: "Old source", field: "Name", capturedAt: 0 };
    expect(packageInformationSchema.parse(value).facts[0].source.kind).toBe("document");
    expect(() => packageInformationSchema.parse({ ...value, facts: [{ ...value.facts[0], source: { ...value.facts[0].source, documentId: "live", local: true } }] })).toThrow();
  });
});

describe("information revision ownership", () => {
  it("creates a child without rewriting historical captures and survives member edits", async () => {
    const original = await fixture(), supplied = information(); const next = await updatePackageInformation(original, supplied);
    supplied.facts[0].value = "Caller changed";
    expect(getPackageRevision(original).information).toBeUndefined();
    expect(getPackageRevision(next).information?.facts[0].value).toBe("Alex Example");
    expect(next.revisions.slice(0, original.revisions.length)).toEqual(original.revisions);
    expect(getPackageRevision(next).members).toEqual(getPackageRevision(original).members);
    const edited = await reviseActionPackage(next, getPackageRevision(next).members);
    expect(getPackageRevision(edited).information).toEqual(information());
    expect((await listActionPackages())[0]).toEqual(edited);
    const cleared = await updatePackageInformation(edited, undefined); expect(getPackageRevision(cleared).information).toBeUndefined();
    expect(cleared.revisions.at(-2)?.information).toEqual(information());
  });
  it("rejects a fact ID changing type/participant and a participant ID changing role", async () => {
    const record = await updatePackageInformation(await fixture(), information());
    const changed = information(); changed.facts[0].participantId = "requester";
    await expect(updatePackageInformation(record, changed)).rejects.toThrow(/changed type or participant/);
    const role = information(); role.participants[0].role = "approver";
    await expect(updatePackageInformation(record, role)).rejects.toThrow(/changed roles/);
    expect((await listActionPackages())[0]).toEqual(record);
  });
  it("does not publish a redundant information revision", async () => {
    const record = await updatePackageInformation(await fixture(), information());
    await expect(updatePackageInformation(record, information())).rejects.toThrow(/already matches/);
    expect((await listActionPackages())[0]).toEqual(record);
  });
  it("bounds information retained across history before resource installation", async () => {
    const record = await fixture(), revision = getPackageRevision(record), heavy = information();
    heavy.facts = Array.from({ length: 24 }, (_, i) => ({ id: `field_${i}`, label: "Training text", kind: "text", value: "x".repeat(10000), source: { kind: "entered" } }));
    const revisions = Array.from({ length: 36 }, (_, i) => ({ ...revision, id: `revision_${i}`, ...(i ? { parentId: `revision_${i - 1}` } : {}), information: heavy }));
    expect(() => actionPackageSchema.parse({ ...record, revisions, currentRevisionId: "revision_35" })).toThrow(/combined 8 MB/);
    expect((await listActionPackages())[0]).toEqual(record);
  });
  it("rejects stale, invalidated, cancelled, archived and quota-aborted updates", async () => {
    const original = await fixture(); const current = await updatePackageInformation(original, information());
    await expect(updatePackageInformation(original, information("Other"))).rejects.toThrow(/changed in another tab/);
    await expect(updatePackageInformation(current, information("Other"), undefined, () => false)).rejects.toThrow(/could not be saved/);
    const controller = new AbortController(); controller.abort(); await expect(updatePackageInformation(current, information(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) { const result = put.apply(this, args); if (this.name === "app") this.transaction.abort(); return result; });
    await expect(updatePackageInformation(current, information("Other"))).rejects.toThrow(/could not be saved/); spy.mockRestore();
    expect((await listActionPackages())[0]).toEqual(current);
    const archived = await archiveActionPackage(current, true); await expect(updatePackageInformation(archived, information())).rejects.toThrow(/Reopen/);
  });
  it("retains legacy fingerprints and includes new information without altering outputs", async () => {
    const record = await fixture(), revision = getPackageRevision(record);
    const hash = await packageInputFingerprint(revision);
    expect(await packageInputFingerprint({ ...revision, information: undefined })).toBe(hash);
    expect(await packageInputFingerprint({ ...revision, information: information() })).not.toBe(hash);
    const next = await updatePackageInformation(record, information()); expect(getPackageRevision(next).outputs).toEqual([]);
    const forged = structuredClone(next); forged.revisions.at(-1)!.information!.facts[0].value = "Historical rewrite";
    await expect(commitActionPackage(next, { ...forged, sequence: next.sequence + 1 })).rejects.toThrow(/could not be saved/);
  });
  it("preserves deliberate duplicated information while fresh template actions start without it", async () => {
    const record = await updatePackageInformation(await fixture(), information("SYNTHETIC PRIOR PERSON"));
    const copy = await duplicateActionPackage(record); expect(copy.id).not.toBe(record.id); expect(getPackageRevision(copy).information).toEqual(information("SYNTHETIC PRIOR PERSON"));
    const template = await capturePackageTemplate(record, record.currentRevisionId, "Reusable training action");
    expect(JSON.stringify(template)).not.toContain("SYNTHETIC PRIOR PERSON");
    const fresh = await instantiatePackageTemplate(template, "Fresh training action", {}, {});
    expect(getPackageRevision(fresh).information).toBeUndefined();
  });
  it("transfers the selected information and restores exact complete history from backups", async () => {
    const record = await updatePackageInformation(await fixture(), information());
    const later = await updatePackageInformation(record, information("Later Example"));
    const selected = await buildPortableActionPackage(later, record.currentRevisionId);
    expect(getPackageRevision((await parsePortableActionPackage(selected)).record).information).toEqual(information());
    const backup = await capturePackageBackup(); const assets = new Map<string, ArrayBuffer>();
    const { packageAssets } = await import("@/lib/actionPackages"); const { readPackageAsset } = await import("@/lib/actionPackageAssets");
    for (const asset of packageAssets(later)) assets.set(asset.id, await readPackageAsset(asset));
    const portable = await buildPortableActionPackage(later);
    await clearDb(); const imported = await importPortableActionPackage(portable); expect(getPackageRevision(imported).information).toEqual(information("Later Example"));
    await clearDb();
    const { idbPutAttachment } = await import("@/lib/documentsDb");
    for (const asset of packageAssets(later)) await idbPutAttachment({ id: asset.id, name: asset.name, type: asset.type, size: asset.size, data: assets.get(asset.id)! });
    const restored = await validatePackageBackup(backup, assets); await restorePackageBackup(restored);
    expect((await listActionPackages())[0].revisions.map(revision => revision.information)).toEqual(later.revisions.map(revision => revision.information));
  });
  it("pins review information, includes it in reviewer copies and blocks ownerless mutation", async () => {
    let record = await updatePackageInformation(await fixture(), information()); record = await startPackageReview(record);
    const round = record.reviewRounds!.at(-1)!;
    const later = await updatePackageInformation(record, information("Newer Owner"));
    expect(later.reviewRounds!.at(-1)!.baseline.information).toEqual(information());
    const prepared = await buildPackageReviewerCopy(later, round.id, policy);
    const parsed = await parsePackageReviewTransfer(await packageReviewTransferFile(prepared, policy));
    expect(getPackageRevision(parsed.record).information).toEqual(information());
    await expect(updatePackageInformation(parsed.record, information())).rejects.toThrow(/reviewer copy/);
    const tampered = structuredClone(later); tampered.reviewRounds![0].baseline.information!.facts[0].value = "Changed reviewed baseline";
    await expect(commitActionPackage(later, { ...tampered, sequence: later.sequence + 1 })).rejects.toThrow();
  });
});

describe("package information disclosure", () => {
  it("inspects identifiers, labels and source fields as well as displayed values", () => {
    const value = information("123-45-6789"); value.facts[1].source = { kind: "document", label: "Source 111-22-3333", field: "Field 222-33-4444", capturedAt: 0 };
    expect(packageInformationText(value)).toContain("222-33-4444");
    expect(reviewPackageInformation(value, policy).privacy.found).toBe(true);
  });
  it("exposes retained information in preparation and encrypted sharing and blocks restricted sources", async () => {
    const record = await updatePackageInformation(await fixture(), information("123-45-6789"));
    const prepared = await preparePackageAssembly(record, record.currentRevisionId, policy);
    expect(prepared.reviews.find(item => item.member === "Package information")?.review.privacy.found).toBe(true);
    const share = await preparePackageShare(record, record.currentRevisionId, policy);
    expect(share.reviews.find(item => item.member === "Package information")?.review.privacy.found).toBe(true);
    const restricted = information(); restricted.facts[1].source = { kind: "document", label: "SECRET", field: "Source", capturedAt: 0 };
    const unsafe = await updatePackageInformation(record, restricted);
    expect((await preparePackageAssembly(unsafe, unsafe.currentRevisionId, policy)).readiness.findings.some(item => /outside.*configured levels/.test(item.message))).toBe(true);
    await expect(preparePackageShare(unsafe, unsafe.currentRevisionId, policy)).rejects.toThrow(/outside.*configured levels/);
  });
  it("keeps old packages structurally identical when information is absent", async () => {
    const record = await fixture(); expect(actionPackageSchema.parse(record)).toEqual(record);
    expect(JSON.stringify(record)).not.toContain('"information"');
  });
});
