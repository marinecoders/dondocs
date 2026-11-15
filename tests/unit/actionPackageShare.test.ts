import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember } from "@/lib/actionPackageAssets";
import { createActionPackage, reviseActionPackage, renameActionPackage, listActionPackages } from "@/lib/actionPackages";
import { preparePackageShare, prepareReceivedPackageShare, encryptPreparedPackageShare, packageShareDelivery,
  importPreparedPackageShare, type EncryptedPackageShare } from "@/lib/actionPackageShare";
import { parseEncryptedShareFile } from "@/lib/encryptedShareFile";
import { decryptSharePayload } from "@/lib/shareCrypto";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import * as database from "@/lib/documentsDb";

vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/lib/packagePdfEvidence", async () => ({
  reviewBoundedPackagePdf: async (bytes: ArrayBuffer, label: string, policy: Parameters<typeof import("@/lib/actionPackageDisclosure")["reviewPackageOriginal"]>[2], signal: AbortSignal) => {
    signal.throwIfAborted();
    return (await import("@/lib/actionPackageDisclosure")).reviewPackageOriginal(bytes, label, policy);
  },
}));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: vi.fn(async () => "Synthetic retained PDF text.") }));
const { policyState } = vi.hoisted(() => ({ policyState: { current: undefined as unknown } }));
vi.mock("@/config/classification", async importOriginal => ({
  ...(await importOriginal<typeof import("@/config/classification")>()),
  getExportDeploymentPolicy: async () => policyState.current,
  getExportDeploymentPolicySync: () => policyState.current,
}));
const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
async function clearDatabase() {
  await createActionPackage("Initialize database");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("dondocs");request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], "readwrite");
    for (const name of db.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();tx.onerror = () => reject(tx.error);
  });db.close();
}
async function fixture(large = false) {
  const session = createBlankSession();
  session.formData = { ...session.formData, subject: "SYNTHETIC PACKAGE", unitLine1: "FICTIONAL TRAINING UNIT", from: "Training office", to: "Training officer", sigLast: "Example", classLevel: "unclassified" };
  session.paragraphs = [{ id: "package-body", text: "Exact captured synthetic paragraph.", level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "local-source", epoch: 1, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), "Training letter", "basic-letter");
  const pdf = await PDFDocument.create();pdf.addPage([612, 792]);
  if (large) pdf.setSubject([...crypto.getRandomValues(new Uint8Array(32_000))].map(value => value.toString(16).padStart(2, "0")).join(""));
  const bytes = new Uint8Array(await pdf.save()).buffer;
  const original = await captureOriginalPackageMember({ name: "signed-original.pdf", data: bytes }, "enclosure", true);
  const record = await reviseActionPackage(await createActionPackage("Training action"), [native, original]);
  return { record, native, original, bytes };
}
async function decoded(encrypted: EncryptedPackageShare) {
  const delivery = await packageShareDelivery(encrypted);
  const payload = parseEncryptedShareFile(new TextDecoder().decode(delivery.file));
  return { delivery, payload, data: await decryptSharePayload(payload, "synthetic-password") };
}
beforeEach(async () => { vi.restoreAllMocks();policyState.current = policy;await clearDatabase(); });
afterEach(() => vi.restoreAllMocks());

it("encrypts one exact selected revision, preserves original bytes and installs only after review", async () => {
  const { record, bytes } = await fixture();
  const newer = await reviseActionPackage(record, record.revisions.at(-1)!.members);
  const selected = record.currentRevisionId;
  const prepared = await preparePackageShare(newer, selected, policy);
  const encrypted = await encryptPreparedPackageShare(prepared, "synthetic-password");
  expect(encrypted.url).toContain("#s=");
  const { data, payload } = await decoded(encrypted);
  await expect(decryptSharePayload(payload, "wrong-password")).rejects.toThrow(/Wrong password/);
  const envelope = data as { kind: string; package: { package: { revisions: unknown[]; currentRevisionId: string; workingCopies?: unknown } } };
  expect(envelope.kind).toBe("dondocs-action-package-share");
  expect(envelope.package.package.revisions).toHaveLength(1);
  expect(envelope.package.package.currentRevisionId).toBe(selected);
  expect(envelope.package.package.workingCopies).toBeUndefined();
  await clearDatabase();
  const reviewed = await prepareReceivedPackageShare(data, policy);
  expect(await listActionPackages()).toEqual([]);
  expect(reviewed.reviews.some(entry => entry.member === "signed-original.pdf")).toBe(true);
  const imported = await importPreparedPackageShare(reviewed);
  const member = imported.revisions[0].members.find(member => member.kind === "original")!;
  if (member.kind !== "original") throw new Error("Expected original");
  expect((await database.idbGetAttachment(member.original.id))!.data).toEqual(bytes);
  const native = imported.revisions[0].members.find(member => member.kind === "native")!;
  if (native.kind !== "native") throw new Error("Expected native");
  expect(native.source?.local).toBe(false);
  expect(native.session.paragraphs[0].text).toBe("Exact captured synthetic paragraph.");
  await importPreparedPackageShare(reviewed);
  expect(await listActionPackages()).toHaveLength(1);
});

it("offers encrypted-file fallback for a package exceeding the URL budget", async () => {
  const { record } = await fixture(true);
  const encrypted = await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password");
  expect(encrypted.url).toBeNull();
  const { data } = await decoded(encrypted);
  expect((await prepareReceivedPackageShare(data, policy)).name).toBe("Training action");
});

it("authenticates expiry and rejects tampered ciphertext or expired opening without installing", async () => {
  const { record } = await fixture();const expiresAt = Date.now() + 60_000;
  const { data, payload } = await decoded(await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password", expiresAt));
  const position = Math.floor(payload.length / 2), changed = payload.slice(0, position) + (payload[position] === "A" ? "B" : "A") + payload.slice(position + 1);
  await expect(decryptSharePayload(changed, "synthetic-password")).rejects.toThrow(/Wrong password/);
  await clearDatabase();vi.spyOn(Date, "now").mockReturnValue(expiresAt);
  await expect(prepareReceivedPackageShare(data, policy)).rejects.toThrow(/expired/);
  expect(await listActionPackages()).toEqual([]);
});

it("rejects an expiry crossed while a decrypted review is open", async () => {
  const { record } = await fixture();const expiresAt = Date.now() + 60_000;
  const { data } = await decoded(await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password", expiresAt));
  await clearDatabase();const prepared = await prepareReceivedPackageShare(data, policy);
  vi.spyOn(Date, "now").mockReturnValue(expiresAt);
  await expect(importPreparedPackageShare(prepared)).rejects.toThrow(/expired/);
  expect(await listActionPackages()).toEqual([]);
});

it.each(["expiry", "cancel"])("checks %s again inside the package transaction", async reason => {
  const { record } = await fixture();const expiresAt = Date.now() + 60_000;
  const { data } = await decoded(await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password", expiresAt));
  await clearDatabase();const prepared = await prepareReceivedPackageShare(data, policy), controller = new AbortController();
  const compare = database.idbCompareActionPackage;let checks = 0;
  vi.spyOn(database, "idbCompareActionPackage").mockImplementation((before, after, isCurrent) => compare(before, after, () => {
    checks++;
    if (checks === 2) { if (reason === "expiry") vi.spyOn(Date, "now").mockReturnValue(expiresAt); else controller.abort(); }
    return isCurrent?.() ?? true;
  }));
  await expect(importPreparedPackageShare(prepared, controller.signal)).rejects.toThrow();
  expect(checks).toBeGreaterThanOrEqual(2);
  expect(await listActionPackages()).toEqual([]);
});

it("invalidates prepared/generation delivery when source or deployment policy changes", async () => {
  const { record } = await fixture();const prepared = await preparePackageShare(record, record.currentRevisionId, policy);
  const encrypted = await encryptPreparedPackageShare(prepared, "synthetic-password");
  await renameActionPackage(record, "Changed source");
  await expect(packageShareDelivery(encrypted)).rejects.toThrow(/changed/);
  await expect(encryptPreparedPackageShare(prepared, "synthetic-password")).rejects.toThrow(/changed/);
  const latest = (await listActionPackages())[0];const current = await encryptPreparedPackageShare(await preparePackageShare(latest, latest.currentRevisionId, policy), "synthetic-password");
  policyState.current = resolveExportDeploymentPolicy({ hostname: "example.gov", environment: null, runtime: { status: "absent" } });
  await expect(packageShareDelivery(current)).rejects.toThrow(/Deployment settings changed/);
});

it("refuses policy changes during received review and never overwrites unrelated packages on storage failure", async () => {
  const { record } = await fixture();const { data } = await decoded(await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password"));
  await clearDatabase();const unrelated = await createActionPackage("Existing unrelated action");
  const prepared = await prepareReceivedPackageShare(data, policy);
  policyState.current = { status: "not-ready", message: "Policy is loading" };
  await expect(importPreparedPackageShare(prepared)).rejects.toThrow(/loading/);
  policyState.current = policy;
  vi.spyOn(database, "idbCompareActionPackage").mockResolvedValue(false);
  await expect(importPreparedPackageShare(prepared)).rejects.toThrow(/could not be saved|changed/);
  expect(await listActionPackages()).toEqual([unrelated]);
});

it("rejects missing/corrupt resources, malformed envelopes and forged review tokens", async () => {
  const { record } = await fixture();const { data } = await decoded(await encryptPreparedPackageShare(await preparePackageShare(record, record.currentRevisionId, policy), "synthetic-password"));
  await clearDatabase();
  const broken = structuredClone(data) as { package: { portableResources: { entries: unknown[] } } };broken.package.portableResources.entries.pop();
  await expect(prepareReceivedPackageShare(broken, policy)).rejects.toThrow();
  for (const change of [{ version: 2 }, { expiresAt: null }, { unexpected: true }])
    await expect(prepareReceivedPackageShare({ ...data, ...change }, policy)).rejects.toThrow(/invalid or unsupported/);
  await expect(importPreparedPackageShare({} as never)).rejects.toThrow(/Review this package again/);
  expect(await listActionPackages()).toEqual([]);
});

it("keeps retained assembled PDF bytes and hashes in encrypted delivery", async () => {
  const { record } = await fixture();
  const { retainPackageAsset, readPackageAsset } = await import("@/lib/actionPackageAssets");
  const { commitActionPackage, getPackageRevision } = await import("@/lib/actionPackages");
  const pdf = await PDFDocument.create();pdf.addPage();pdf.addPage();
  const bytes = new Uint8Array(await pdf.save()).buffer;
  const asset = await retainPackageAsset("retained-exact.pdf", "application/pdf", bytes);
  const revision = getPackageRevision(record);
  const output = { id: "handoff-output", asset, createdAt: 100, policyIdentity: "historical-policy", renderer: "synthetic-test",
    signingStatus: "unsigned-assembled-derivative" as const,
    boundaries: revision.members.map((member, index) => ({ memberId: member.id, startPage: index + 1, pageCount: 1,
      firstPageLabel: String(index + 1), numbering: "continuation" as const })) };
  const retained = await commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    revisions: record.revisions.map(value => value.id === revision.id ? { ...value, outputs: [output] } : value) });
  const encrypted = await encryptPreparedPackageShare(await preparePackageShare(retained, revision.id, policy), "synthetic-password");
  const { data } = await decoded(encrypted);
  await clearDatabase();
  const imported = await importPreparedPackageShare(await prepareReceivedPackageShare(data, policy));
  const received = getPackageRevision(imported).outputs[0];
  expect(received.asset.sha256).toBe(asset.sha256);
  expect(await readPackageAsset(received.asset)).toEqual(bytes);
});

it("rejects cancelled package preparation before exposing review or installing assets", async () => {
  const { record } = await fixture();
  const controller = new AbortController();controller.abort();
  await expect(preparePackageShare(record, record.currentRevisionId, policy, controller.signal)).rejects.toThrow();
});
