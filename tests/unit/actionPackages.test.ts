import { reviewPackageNative, reviewPackageOriginal } from "@/lib/actionPackageDisclosure";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fixtureInstance, fixturePage } from "../_helpers/formFixture";
import { formTemplateAttachmentId } from "@/lib/formTemplateAssets";
import { preparePackageMember } from "@/lib/actionPackageAssets";
import { prepareFormSession } from "@/stores/formStore";
import { PDFDocument } from "pdf-lib";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import {
  capturePackageMember,
  captureOriginalPackageMember,
  readPackageAsset,
  readPackageMemberDraft,
  retainPackageAsset,
} from "@/lib/actionPackageAssets";
import {
  createActionPackage,
  commitActionPackage,
  getPackageRevision,
  listActionPackages,
  reviseActionPackage,
  renameActionPackage,
  duplicateActionPackage,
  archiveActionPackage,
  packageAssets,
  type ActionPackage,
} from "@/lib/actionPackages";
import {
  idbCompareActionPackage,
  idbDeleteAttachment,
  idbFormDefinitions,
  idbPutAttachment,
} from "@/lib/documentsDb";
import {
  buildPortableActionPackage,
  importPortableActionPackage,
  parsePortableActionPackage,
} from "@/lib/actionPackageTransfer";
import { collectLiveAttachmentIds } from "@/lib/attachmentGc";
import {
  assemblePackage,
  preparePackageAssembly,
  capturePreparedPackageComparison,
  copyPreparedPackageOutput,
  assertPreparedPackagePolicy,
} from "@/lib/actionPackageAssembly";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import {
  capturePackageBackup,
  validatePackageBackup,
  restorePackageBackup,
} from "@/lib/actionPackageBackup";
import { persistAttachment, newAttachmentId } from "@/lib/attachments";
import { useDocumentsStore } from "@/stores/documentsStore";
import { buildBackup, restoreBackup } from "@/lib/backup";
import { parseDraftFile } from "@/lib/draftFile";
import type { BackupBundle } from "@/lib/backup";
import {
  portableResourceDigest,
  buildPortableResources,
  type PortableResourceManifest,
} from "@/lib/portableResources";
import { composeBasicLetterId } from "@/lib/endorsement";
import { DISCREPANCY_NOTICE, MI_REPORTING } from "@/data/techpub/sections";

vi.mock("@/stores/backupStore", () => ({
  scheduleBackup: vi.fn(),
  useBackupStore: { getState: () => ({}) },
}));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: vi.fn(async () => "") }));
type Packet = {
  version: number;
  package: ActionPackage;
  portableResources: PortableResourceManifest;
};
const policy = resolveExportDeploymentPolicy({
  hostname: "localhost",
  environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] },
  runtime: { status: "absent" },
});
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("dondocs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], "readwrite");
    for (const name of db.objectStoreNames)
      transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
async function pdfBytes(count = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index++) pdf.addPage([612, 792]);
  return new Uint8Array(await pdf.save()).buffer;
}
function snapshot() {
  const session = createBlankSession();
  return {
    ...session,
    endItems: [],
    publicationTables: {},
    formData: {
      ...session.formData,
      unitLine1: "FICTIONAL TRAINING UNIT",
      subject: "SYNTHETIC PACKAGE",
      from: "Training Office",
      to: "Training Officer",
      sigLast: "Example",
      classLevel: "unclassified",
      date: "14 Nov 26",
    },
    paragraphs: [{ id: "body", text: "Fictional training content.", level: 0 }],
  };
}
async function fixture() {
  const source = snapshot();
  const captured = captureDocumentRevision(
    {
      documentId: "source-example",
      epoch: 0,
      editSequence: 1,
      capturedAt: 100,
    },
    source,
  );
  const member = await capturePackageMember(
    captured,
    "Training letter",
    "basic-letter",
  );
  const empty = await createActionPackage("Training action");
  const record = await reviseActionPackage(empty, [member]);
  return { record, member, source };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await createActionPackage("Initialize database");
  await clearDb();
  useDocumentsStore.setState({
    docs: {},
    currentId: null,
    hydrated: true,
    baseline: null,
  });
});

it("keeps endorsements linked to the same letter through reorder, revision and portable transfer", async () => {
  const { record, member, source } = await fixture();
  const endorsement = { ...snapshot(), docType: "new_page_endorsement" };
  const make = (documentId: string) => capturePackageMember(
    captureDocumentRevision({ documentId, epoch: 0, editSequence: 1, capturedAt: 200 }, endorsement),
    "Endorsement", "endorsement");
  const first = await make("endorsement-one"), second = await make("endorsement-two");
  const routed = await reviseActionPackage(record, [member, first, second]);
  const members = getPackageRevision(routed).members;
  expect(members.slice(1).map(item => item.endorsementLink?.ordinal)).toEqual(["FIRST", "SECOND"]);
  const changed = { ...source, formData: { ...source.formData, from: "Different Office", date: "20 Nov 26" } };
  const updated = await capturePackageMember(captureDocumentRevision(
    { documentId: "source-example", epoch: 0, editSequence: 2, capturedAt: 300 }, changed), member.label, member.role, member);
  const reordered = await reviseActionPackage(routed, [updated, members[2], members[1]]);
  const revision = getPackageRevision(reordered);
  for (const [i, item] of revision.members.slice(1).entries()) {
    if (item.kind !== "native") throw new Error("Expected editable endorsement");
    const { reviewed } = await readPackageMemberDraft(item);
    expect(reviewed.session.formData).toMatchObject({ endorsementOrdinal: ["FIRST", "SECOND"][i], basicLetterId: composeBasicLetterId(changed) });
    expect(item.endorsementLink?.basicMemberId).toBe(member.id);
  }
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(reordered));
  expect(getPackageRevision(portable.record).members[1].endorsementLink).toEqual(revision.members[1].endorsementLink);
  const previous = members[1];
  if (previous.kind !== "native") throw new Error("Expected historical endorsement");
  expect((await readPackageMemberDraft(previous)).reviewed.session.formData.basicLetterId).toBe(composeBasicLetterId(source));

  const original = await captureOriginalPackageMember({ name: "received.pdf", data: await pdfBytes() }, "endorsement", true);
  const protectedMember = { ...original, id: members[2].id, endorsementLink: members[2].endorsementLink };
  const stale = await reviseActionPackage(reordered, [updated, protectedMember]);
  const preparation = await preparePackageAssembly(stale, stale.currentRevisionId, policy);
  expect(preparation.readiness.findings.some(item => item.message.includes("obtain an updated endorsement"))).toBe(true);
  expect(getPackageRevision(stale).members[1]).toEqual(protectedMember);
});

it("prevents a route offset change from silently redirecting a printed enclosure citation", async () => {
  const { record, member, source } = await fixture();
  const enclosure = { title: "Training attachment", hasFile: false };
  const end = { ...snapshot(), docType: "new_page_endorsement", enclosures: [enclosure],
    paragraphs: [{ id: "citing-body", text: "See enclosure (1).", level: 0 }] };
  const captured = await capturePackageMember(captureDocumentRevision(
    { documentId: "citing-endorsement", epoch: 0, editSequence: 1, capturedAt: 100 }, end), "Forwarding endorsement", "endorsement");
  const routed = await reviseActionPackage(record, [member, captured]);
  const updated = await capturePackageMember(captureDocumentRevision(
    { documentId: "source-example", epoch: 0, editSequence: 2, capturedAt: 200 }, { ...source, enclosures: [enclosure] }), member.label, member.role, member);
  await expect(reviseActionPackage(routed, [updated, getPackageRevision(routed).members[1]])).rejects.toThrow(/citation affected by the new routing order/);
  expect((await listActionPackages(routed.id))[0].currentRevisionId).toBe(routed.currentRevisionId);
});

it("binds comparison copies to two reviewed outputs of the same immutable revision and current policy", async () => {
  const { record } = await fixture();
  const ports = { compile: async () => new Uint8Array(await pdfBytes()), convertDocx: vi.fn(), waitForReady: async () => true };
  const first = await assemblePackage(await preparePackageAssembly(record, record.currentRevisionId, policy), ports);
  const second = await assemblePackage(await preparePackageAssembly(first, first.currentRevisionId, policy), ports);
  const revision = getPackageRevision(second), [before, after] = revision.outputs;
  expect(before.provenance?.inputSha256).toBe(after.provenance?.inputSha256);
  const prepared = await preparePackageAssembly(second, revision.id, policy);
  assertPreparedPackagePolicy(prepared, policy);
  expect(() => assertPreparedPackagePolicy(prepared, { status: "error", message: "changed" })).toThrow("policy changed");
  expect(() => capturePreparedPackageComparison(prepared, before.id, before.id)).toThrow("two different");
  expect(() => capturePreparedPackageComparison(prepared, before.id, "other-revision-output")).toThrow("same reviewed");
  const captured = capturePreparedPackageComparison(prepared, before.id, after.id);
  new Uint8Array(captured.beforeBytes).fill(0);
  captured.before.boundaries[0].pageCount = 999;
  expect(new Uint8Array(copyPreparedPackageOutput(prepared, before.asset.id))[0]).toBe(37);
  expect(capturePreparedPackageComparison(prepared, before.id, after.id).before.boundaries[0].pageCount).toBe(1);
  const portable = await buildPortableActionPackage(second);
  expect((await parsePortableActionPackage(portable)).record.revisions[0].outputs[0].provenance).toEqual(before.provenance);
  const legacy = JSON.parse(portable);
  for (const output of legacy.package.revisions[0].outputs) delete output.provenance;
  const restored = await parsePortableActionPackage(JSON.stringify(legacy));
  expect(restored.record.revisions[0].outputs[0].provenance).toBeUndefined();
  expect(restored.resources.get(`assets/${before.asset.id}`)?.data).toEqual(await readPackageAsset(before.asset));
});

describe("retained package ownership and transactions", () => {
  it("owns captured models and bytes across source mutation, replacement, deletion, removal and reload reads", async () => {
    const { record, member, source } = await fixture();
    source.formData.subject = "Changed live source";
    expect(
      (await readPackageMemberDraft(member)).reviewed.session.formData.subject,
    ).toBe("SYNTHETIC PACKAGE");
    const original = await captureOriginalPackageMember(
      { name: "signed-original.pdf", data: await pdfBytes() },
      "enclosure",
      true,
    );
    const withFile = await reviseActionPackage(record, [member, original]);
    const removed = await reviseActionPackage(withFile, [member]);
    expect(
      getPackageRevision(removed, withFile.currentRevisionId).members,
    ).toHaveLength(2);
    const retained = await listActionPackages();
    expect(retained.find((item) => item.id === record.id)).toEqual(removed);
    const roots = await collectLiveAttachmentIds();
    for (const asset of packageAssets(removed))
      expect(roots!.has(asset.id)).toBe(true);
    expect(
      new Uint8Array(
        await readPackageAsset(
          original.kind === "native" ? original.draft : original.original,
        ),
      ),
    ).toEqual(
      new Uint8Array(
        await readPackageAsset(
          original.kind === "native" ? original.draft : original.original,
        ),
      ),
    );
  });
  it("rejects stale tabs and historical model, member-identity and artifact rewrites at storage boundary", async () => {
    const { record } = await fixture();
    const renamed = await renameActionPackage(record, "Renamed action");
    await expect(renameActionPackage(record, "Stale tab")).rejects.toThrow(
      /changed/,
    );
    for (const mutate of [
      (copy: ActionPackage) => {
        copy.revisions[1].members[0].label = "Tampered saved member";
      },
      (copy: ActionPackage) => {
        copy.revisions[1].createdAt++;
      },
      (copy: ActionPackage) => {
        copy.revisions.shift();
      },
    ]) {
      const copy = structuredClone(renamed);
      copy.sequence++;
      mutate(copy);
      expect(await idbCompareActionPackage(renamed, copy)).toBe(false);
    }
    expect(
      (await listActionPackages()).find((item) => item.id === record.id),
    ).toEqual(renamed);
  });
  it("leaves the previous complete revision on quota abort and never commits missing bytes", async () => {
    const { record, member } = await fixture();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const result = put.apply(this, args);
      if (this.name === "app") this.transaction.abort();
      return result;
    });
    await expect(renameActionPackage(record, "Quota failure")).rejects.toThrow(
      /could not be saved/,
    );
    vi.restoreAllMocks();
    expect((await listActionPackages())[0]).toEqual(record);
    await idbDeleteAttachment(member.draft.id);
    expect(
      await idbCompareActionPackage(record, {
        ...record,
        sequence: record.sequence + 1,
        name: "Missing bytes",
      }),
    ).toBe(false);
    const readiness = await preparePackageAssembly(
      record,
      record.currentRevisionId,
      policy,
    );
    expect(readiness.readiness.state).toBe("incomplete");
    expect(
      readiness.readiness.findings.some(
        (finding) =>
          finding.memberId === member.id &&
          /Missing or corrupt/.test(finding.message),
      ),
    ).toBe(true);
  });
  it("does not treat corrupt inventory as empty and preserves it through recovery refusal", async () => {
    await fixture();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("dondocs");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = db.transaction("app", "readwrite");
      transaction
        .objectStore("app")
        .put({ key: "action-package:broken", value: { id: "wrong" } });
      transaction.oncomplete = () => resolve();
    });
    db.close();
    await expect(listActionPackages()).rejects.toThrow(/corrupt/);
    expect(await collectLiveAttachmentIds()).toBeNull();
    expect(await idbFormDefinitions()).toBeNull();
    await expect(buildBackup()).rejects.toThrow();
  });
  it("duplicates without sharing mutable metadata and archives without losing history", async () => {
    const { record } = await fixture();
    const duplicate = await duplicateActionPackage(record);
    expect(duplicate.id).not.toBe(record.id);
    expect(duplicate.revisions).toEqual(record.revisions);
    const archived = await archiveActionPackage(record, true);
    await expect(reviseActionPackage(archived, [])).rejects.toThrow(/archived/);
    const reopened = await archiveActionPackage(archived, false);
    expect(reopened.revisions).toEqual(record.revisions);
  });
  it.each(["A".repeat(120), "😀".repeat(60), "A".repeat(115)])("duplicates a maximum-length package name without losing the copy suffix", async name => {
    const record = await createActionPackage(name);
    const duplicate = await duplicateActionPackage(record);
    expect(duplicate.name.length).toBeLessThanOrEqual(120);
    expect(duplicate.name.endsWith(" copy")).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(duplicate.name))).toBe(duplicate.name);
    const saved = await listActionPackages();
    expect(saved.find(item => item.id === record.id)?.name).toBe(name);
    expect(saved.find(item => item.id === duplicate.id)?.name).toBe(duplicate.name);
    expect(duplicate.id).not.toBe(record.id);
    expect(duplicate.revisions).toEqual(record.revisions);
  });
});

describe("portable package and recovery boundaries", () => {
  it("exports only the selected revision, imports offline exact bytes idempotently and keeps source IDs foreign", async () => {
    const { record, member } = await fixture();
    const removed = await reviseActionPackage(record, []);
    const portable = await buildPortableActionPackage(
        removed,
        record.currentRevisionId,
      ),
      envelope = JSON.parse(portable);
    expect(envelope.package.revisions).toHaveLength(1);
    expect(envelope.package.revisions[0].id).toBe(record.currentRevisionId);
    expect(envelope.package.revisions[0].members[0].source.local).toBe(false);
    expect(await importPortableActionPackage(portable)).toEqual(removed);
    const expected = await readPackageAsset(member.draft);
    await clearDb();
    const imported = await importPortableActionPackage(portable);
    expect(imported.revisions[0].members[0].kind).toBe("native");
    expect(await readPackageAsset(member.draft)).toEqual(expected);
    expect(await importPortableActionPackage(portable)).toEqual(imported);
    expect(await listActionPackages()).toHaveLength(1);
  });
  it("rejects missing resources, tampered hashes, manifest versions and native projections before publishing bytes", async () => {
    const { record } = await fixture(),
      portable = await buildPortableActionPackage(record);
    await clearDb();
    for (const mutate of [
      (value: Packet) => {
        value.portableResources.entries = [];
      },
      (value: Packet) => {
        value.portableResources.entries[0].sha256 = "f".repeat(64);
      },
      (value: Packet) => {
        value.version = 2;
      },
      (value: Packet) => {
        const member = value.package.revisions[0].members[0];
        if (member.kind === "native")
          member.session.formData.subject = "Hidden differing content";
      },
      (value: Packet) => {
        const member = value.package.revisions[0].members[0];
        if (member.kind === "native") member.source!.local = true;
      },
    ]) {
      const parsed = JSON.parse(portable);
      mutate(parsed);
      await expect(
        importPortableActionPackage(JSON.stringify(parsed)),
      ).rejects.toThrow();
      expect(await listActionPackages()).toEqual([]);
    }
  });
  it("rejects internally corrupt PDF resources even when the outer checksum has been recomputed", async () => {
    const { record, member } = await fixture();
    const packet = JSON.parse(await buildPortableActionPackage(record));
    const draft = (await readPackageMemberDraft(member)).draft as {
      enclosures: unknown[];
    };
    draft.enclosures = [
      {
        title: "Broken required PDF",
        hasFile: true,
        file: { name: "broken.pdf", size: 4, data: btoa("nope") },
      },
    ];
    const data = new TextEncoder().encode(JSON.stringify(draft)).buffer;
    const asset = {
      ...member.draft,
      size: data.byteLength,
      sha256: await portableResourceDigest(data),
    };
    packet.package.revisions[0].members[0].draft = asset;
    packet.package.revisions[0].members[0].session = parseDraftFile(
      draft,
      false,
      true,
    ).session;
    // A matching projection cannot make unreadable native resources ready.
    packet.portableResources = await buildPortableResources([
      {
        path: `assets/${asset.id}`,
        name: asset.name,
        mediaType: asset.type,
        data,
      },
    ]);
    await expect(
      parsePortableActionPackage(JSON.stringify(packet)),
    ).rejects.toThrow();
  });
  it("preserves complete package history in version12 backups, rejects corrupt recovery before workspace writes, and never replaces local history", async () => {
    const { record, member } = await fixture();
    const latest = await reviseActionPackage(record, []);
    const backup = await buildBackup(),
      parsed = JSON.parse(backup);
    expect(parsed.version).toBe(12);
    expect(parsed.actionPackages[0].revisions).toHaveLength(3);
    const corrupted = structuredClone(parsed) as BackupBundle;
    corrupted.attachments.find((asset) => asset.id === member.draft.id)!.data =
      btoa("corrupt");
    corrupted.attachments.find((asset) => asset.id === member.draft.id)!.size =
      7;
    await expect(restoreBackup(JSON.stringify(corrupted))).rejects.toThrow(
      /corrupt/,
    );
    expect((await listActionPackages())[0]).toEqual(latest);
    const recovery = await capturePackageBackup(),
      decoded = new Map(
        await Promise.all(
          packageAssets(latest).map(
            async (asset) => [asset.id, await readPackageAsset(asset)] as const,
          ),
        ),
      );
    expect(await validatePackageBackup(recovery, decoded)).toEqual(recovery);
    await renameActionPackage(latest, "Newer local history");
    await expect(restorePackageBackup(recovery)).rejects.toThrow(
      /different local history/,
    );
    await clearDb();
    const result = await restoreBackup(backup);
    expect(result.actionPackagesRestored).toBe(1);
    expect((await listActionPackages())[0].revisions).toHaveLength(3);
  });
});

describe("readiness and retained assembly", () => {
  it("blocks missing required fields, unresolved citations, corrupt native attachment bytes and contradictory endorsement chains", async () => {
    const { record, member } = await fixture();
    for (const change of [
      (source: ReturnType<typeof snapshot>) => {
        source.formData.subject = "";
      },
      (source: ReturnType<typeof snapshot>) => {
        source.paragraphs[0].text = "See reference (z).";
      },
    ]) {
      const source = snapshot();
      change(source);
      const captured = captureDocumentRevision(
        {
          documentId: "source-example",
          epoch: 0,
          editSequence: 2,
          capturedAt: 200,
        },
        source,
      );
      const updated = await capturePackageMember(
        captured,
        member.label,
        member.role,
        member,
      );
      const revised = await reviseActionPackage(record, [updated]);
      expect(
        (
          await preparePackageAssembly(
            revised,
            revised.currentRevisionId,
            policy,
          )
        ).readiness.state,
      ).toBe("incomplete");
      // Start each independent branch from the last committed record.
      record.sequence = revised.sequence;
      record.revisions = revised.revisions;
      record.currentRevisionId = revised.currentRevisionId;
    }
    const endorsement = snapshot();
    endorsement.docType = "new_page_endorsement";
    endorsement.formData = {
      ...endorsement.formData,
      endorsementOrdinal: "SECOND",
      basicLetterId: composeBasicLetterId(snapshot()),
    } as typeof endorsement.formData;
    const end = await capturePackageMember(
      captureDocumentRevision(
        {
          documentId: "endorsement-source",
          epoch: 0,
          editSequence: 1,
          capturedAt: 300,
        },
        endorsement,
      ),
      "Endorsement",
      "endorsement",
    );
    const revised = await reviseActionPackage(record, [member, end]);
    const preparation = await preparePackageAssembly(
      revised,
      revised.currentRevisionId,
      policy,
    );
    expect(
      preparation.readiness.findings.some((finding) =>
        /ordinal/.test(finding.message),
      ),
    ).toBe(true);
  });
  it("uses one preserved assembly for boundaries, preview/export identity and unchanged signed originals", async () => {
    const originalBytes = await pdfBytes(2),
      original = await captureOriginalPackageMember(
        { name: "signed.pdf", data: originalBytes },
        "basic-letter",
        true,
      );
    const enclosure = await captureOriginalPackageMember(
      { name: "enclosure.pdf", data: await pdfBytes() },
      "enclosure",
      false,
    );
    const empty = await createActionPackage("Original action"),
      record = await reviseActionPackage(empty, [original, enclosure]);
    const prepared = await preparePackageAssembly(
      record,
      record.currentRevisionId,
      policy,
    );
    expect(prepared.readiness.state).toBe("ready");
    const ports = {
      compile: vi.fn(),
      convertDocx: vi.fn(),
      waitForReady: vi.fn(),
    };
    const assembled = await assemblePackage(prepared, ports);
    expect(ports.compile).not.toHaveBeenCalled();
    const output = getPackageRevision(assembled).outputs[0];
    expect(
      output.boundaries.map((item) => [
        item.startPage,
        item.pageCount,
        item.numbering,
      ]),
    ).toEqual([
      [1, 2, "continuation"],
      [3, 1, "separate"],
    ]);
    expect(
      (
        await PDFDocument.load(await readPackageAsset(output.asset))
      ).getPageCount(),
    ).toBe(3);
    expect(
      await readPackageAsset(
        original.kind === "native" ? original.draft : original.original,
      ),
    ).toEqual(originalBytes);
    const json = await buildPortableActionPackage(assembled);
    await clearDb();
    const imported = await importPortableActionPackage(json);
    const retained = getPackageRevision(imported).outputs[0];
    expect(retained.asset.sha256).toBe(output.asset.sha256);
    expect(await readPackageAsset(retained.asset)).toEqual(
      await (
        await parsePortableActionPackage(json)
      ).resources.get(`assets/${retained.asset.id}`)!.data,
    );
  });
  it("retains the previous package when metadata commit fails after rendering", async () => {
    const empty = await createActionPackage("Quota action"),
      original = await captureOriginalPackageMember(
        { name: "original.pdf", data: await pdfBytes() },
        "basic-letter",
        true,
      ),
      record = await reviseActionPackage(empty, [original]);
    const prepared = await preparePackageAssembly(
        record,
        record.currentRevisionId,
        policy,
      ),
      put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      if (this.name === "app") this.transaction.abort();
      return request;
    });
    await expect(
      assemblePackage(prepared, {
        compile: vi.fn(),
        convertDocx: vi.fn(),
        waitForReady: vi.fn(),
      }),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    expect((await listActionPackages())[0]).toEqual(record);
    const unattached = newAttachmentId();
    await idbPutAttachment({
      id: unattached,
      name: "staging residue",
      size: 1,
      type: "application/octet-stream",
      data: new Uint8Array([1]).buffer,
    });
    expect((await collectLiveAttachmentIds())?.has(unattached)).toBe(false);
  });
});

describe("native form package revisions", () => {
  it("preserves configured definitions and exact durable template bytes, edits and assembles after offline transfer", async () => {
    const page = await fixturePage(),
      instance = fixtureInstance();
    instance.definition.pages[0].sha256 = page.sha256;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(page.bytes))),
    );
    const source = {
      ...snapshot(),
      documentCategory: "forms" as const,
      formType: "fixture",
      genericForm: instance,
    };
    const member = await capturePackageMember(
      captureDocumentRevision(
        {
          documentId: "configured-source",
          epoch: 0,
          editSequence: 1,
          capturedAt: 100,
        },
        source,
      ),
      "Configured coordination",
      "basic-letter",
    );
    expect(member.templates?.["page1.pdf"].id).toBe(
      formTemplateAttachmentId(page.sha256),
    );
    const record = await reviseActionPackage(
      await createActionPackage("Configured package"),
      [member],
    );
    expect(
      (await idbFormDefinitions())?.some(
        (definition) => definition.formId === "fixture",
      ),
    ).toBe(true);
    expect(
      (await collectLiveAttachmentIds())?.has(
        formTemplateAttachmentId(page.sha256),
      ),
    ).toBe(true);
    const portable = await buildPortableActionPackage(record),
      backup = JSON.parse(await buildBackup());
    expect(backup.version).toBe(12);
    expect(
      backup.portableResources.entries.filter(
        (entry: { sha256: string }) => entry.sha256 === page.sha256,
      ),
    ).toHaveLength(1);
    expect(
      backup.attachments.some(
        (asset: { id: string }) =>
          asset.id === formTemplateAttachmentId(page.sha256),
      ),
    ).toBe(false);
    await clearDb();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const imported = await importPortableActionPackage(portable),
      selected = getPackageRevision(imported).members[0];
    if (selected.kind !== "native")
      throw new Error("Expected configured member");
    expect(
      (await preparePackageMember(selected)).snapshot.genericForm?.answers,
    ).toEqual(instance.answers);
    const prepared = await preparePackageAssembly(
      imported,
      imported.currentRevisionId,
      policy,
    );
    expect(
      prepared.readiness.findings.filter(
        (finding) => finding.severity === "error",
      ),
    ).toEqual([]);
    const assembled = await assemblePackage(prepared, {
      compile: vi.fn(),
      convertDocx: vi.fn(),
      waitForReady: vi.fn(),
    });
    expect(
      (
        await PDFDocument.load(
          await readPackageAsset(
            getPackageRevision(assembled).outputs[0].asset,
          ),
        )
      ).getPageCount(),
    ).toBe(1);
    await clearDb();
    await restoreBackup(JSON.stringify(backup));
    expect((await listActionPackages())[0].revisions).toHaveLength(2);
    expect(
      (await preparePackageMember(member)).snapshot.genericForm?.definition
        .pages[0].sha256,
    ).toBe(page.sha256);
  });
  it("rejects a configured template with a self-consistent resource hash but a different pinned definition or geometry", async () => {
    const page = await fixturePage(),
      instance = fixtureInstance();
    instance.definition.pages[0].sha256 = page.sha256;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(page.bytes))),
    );
    const source = {
      ...snapshot(),
      documentCategory: "forms" as const,
      formType: "fixture",
      genericForm: instance,
    };
    const member = await capturePackageMember(
      captureDocumentRevision(
        {
          documentId: "configured-source",
          epoch: 0,
          editSequence: 1,
          capturedAt: 100,
        },
        source,
      ),
      "Configured",
      "basic-letter",
    );
    const record = await reviseActionPackage(
        await createActionPackage("Configured package"),
        [member],
      ),
      packet = JSON.parse(await buildPortableActionPackage(record));
    const wrong = await pdfBytes(2),
      asset = packet.package.revisions[0].members[0].templates["page1.pdf"];
    const replacement = {
      ...asset,
      size: wrong.byteLength,
      sha256: await portableResourceDigest(wrong),
    };
    packet.package.revisions[0].members[0].templates["page1.pdf"] = replacement;
    const decoded = await parsePortableActionPackage(
      await buildPortableActionPackage(record),
    );
    packet.portableResources = await buildPortableResources(
      await Promise.all(
        [...decoded.resources].map(async ([path, resource]) => ({
          path,
          name: resource.name,
          mediaType: resource.mediaType,
          data: path === `assets/${asset.id}` ? wrong : resource.data,
        })),
      ),
    );
    await expect(
      parsePortableActionPackage(JSON.stringify(packet)),
    ).rejects.toThrow(/template/);
  });
  it("stages and renders a built-in form without passing correspondence-only preservation flags or using the engine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            new Uint8Array(
              await readFile(
                resolve(
                  "public",
                  "templates",
                  decodeURI(url).split("templates/")[1],
                ),
              ),
            ),
          ),
      ),
    );
    const forms = prepareFormSession("navmc_10274");
    forms.navmc10274 = {
      ...forms.navmc10274!,
      from: "Training office",
      to: "Training officer",
      natureOfAction: "Fictional coordination action",
    };
    const source = {
      ...snapshot(),
      documentCategory: "forms" as const,
      formType: "navmc_10274",
      forms,
    };
    const member = await capturePackageMember(
      captureDocumentRevision(
        {
          documentId: "builtin-source",
          epoch: 0,
          editSequence: 1,
          capturedAt: 100,
        },
        source,
      ),
      "Built-in coordination",
      "basic-letter",
    );
    expect(
      (await preparePackageMember(member)).snapshot.forms?.navmc10274
        ?.natureOfAction,
    ).toBe("Fictional coordination action");
    const record = await reviseActionPackage(
      await createActionPackage("Builtin package"),
      [member],
    );
    const prepared = await preparePackageAssembly(
      record,
      record.currentRevisionId,
      policy,
    );
    expect(
      prepared.readiness.findings.filter(
        (finding) => finding.severity === "error",
      ),
    ).toEqual([]);
    const ports = {
        compile: vi.fn(),
        convertDocx: vi.fn(),
        waitForReady: vi.fn(),
      },
      assembled = await assemblePackage(prepared, ports);
    expect(ports.compile).not.toHaveBeenCalled();
    expect(
      (
        await PDFDocument.load(
          await readPackageAsset(
            getPackageRevision(assembled).outputs[0].asset,
          ),
        )
      ).getPageCount(),
    ).toBeGreaterThan(0);
  });
});

it.each(["(S) Synthetic omitted note", "Contact synthetic-portable@example.test"])("reviews omitted raw native text only when preparing editable package transfer: %s", async text => {
  const { record, member } = await fixture();
  const { draft } = await readPackageMemberDraft(member);
  Object.assign(draft as object, { legacyRetainedText: text });
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).buffer;
  const asset = await retainPackageAsset(member.draft.name, member.draft.type, bytes);
  const owner = await reviseActionPackage(record, [{ ...member, draft: asset }]);
  const pdf = await preparePackageAssembly(owner, owner.currentRevisionId, policy);
  expect(pdf.readiness.state).toBe("ready");
  const portable = await preparePackageAssembly(owner, owner.currentRevisionId, policy, { includeRetainedDraftText: true });
  if (text.startsWith("(S)")) {
    expect(portable.readiness.state).toBe("incomplete");
    expect(portable.readiness.findings.some(finding => /markings|levels/.test(finding.message))).toBe(true);
  } else {
    expect(portable.readiness.state).toBe("ready");
    expect(portable.reviews.flatMap(entry => entry.review.privacy.findings).some(finding => finding.value === "synthetic-portable@example.test")).toBe(true);
    expect((await parsePortableActionPackage(await buildPortableActionPackage(owner))).resources.get(`assets/${asset.id}`)!.data).toEqual(bytes);
  }
  expect((await listActionPackages()).find(value => value.id === owner.id)).toEqual(owner);
});

it("reviews every transferred native definition choice, retained legacy answer and metadata filename", () => {
  for (const mutate of [
    (instance: ReturnType<typeof fixtureInstance>) => {
      instance.definition.fields.decision.options![1].label = "SECRET";
    },
    (instance: ReturnType<typeof fixtureInstance>) => {
      instance.answers.retired_answer = "SECRET";
    },
  ]) {
    const instance = fixtureInstance();
    mutate(instance);
    const source = {
      ...createBlankSession(),
      documentCategory: "forms" as const,
      formType: instance.definition.formId,
      genericForm: instance,
    };
    expect(() =>
      reviewPackageNative(source, "Fictional package", policy),
    ).toThrow(/configured levels/);
  }
  const instance = fixtureInstance();
  instance.definition.pages[0].file = "fictional-123-45-6789.pdf";
  const source = {
    ...createBlankSession(),
    documentCategory: "forms" as const,
    formType: instance.definition.formId,
    genericForm: instance,
  };
  const review = reviewPackageNative(source, "Fictional package", policy);
  expect(
    review.privacy.findings.some((finding) =>
      finding.value.includes("123-45-6789"),
    ),
  ).toBe(true);
  const retained = snapshot();
  Object.assign(retained.formData, { legacy: { image: 'data:image/not-an-asset\r\nSSN 123-45-6789' } });
  expect(reviewPackageNative(retained, "Fictional package", policy).privacy.findings.some(finding => finding.value.includes('123-45-6789'))).toBe(true);
});

it.each(["(S)", "(TS)", "(CUI)"])("blocks retained %s portions in unused form choices and original PDF text", async marking => {
  const instance = fixtureInstance();
  instance.definition.fields.decision.options![1].label = `${marking} Unselected retained option`;
  const source = { ...createBlankSession(), documentCategory: "forms" as const, formType: instance.definition.formId, genericForm: instance };
  expect(() => reviewPackageNative(source, "Fictional package", policy)).toThrow(/configured levels/);
  const { extractPdfText } = await import("@/lib/pdfText");
  vi.mocked(extractPdfText).mockResolvedValueOnce(`Ordinary first line\n${marking} Captured supporting text`);
  await expect(reviewPackageOriginal(await pdfBytes(), "original.pdf", policy)).rejects.toThrow(/configured levels/);
});

it("reviews actual retained output content under current policy and retrieves the same reviewed bytes", async () => {
  const { record } = await fixture();
  const { retainPackageAsset } = await import("@/lib/actionPackageAssets");
  const { commitActionPackage } = await import("@/lib/actionPackages");
  const { copyPreparedPackageOutput } = await import(
    "@/lib/actionPackageAssembly"
  );
  const { extractPdfText } = await import("@/lib/pdfText");
  const bytes = await pdfBytes(),
    asset = await retainPackageAsset(
      "retained-output.pdf",
      "application/pdf",
      bytes,
    );
  const output = {
    id: "output-inspection",
    asset,
    createdAt: 100,
    policyIdentity: "historical-policy",
    renderer: "synthetic-test",
    signingStatus: "unsigned-assembled-derivative" as const,
    boundaries: [
      {
        memberId: getPackageRevision(record).members[0].id,
        startPage: 1,
        pageCount: 1,
        firstPageLabel: "1",
        numbering: "continuation" as const,
      },
    ],
  };
  const revised = await commitActionPackage(record, {
    ...record,
    sequence: record.sequence + 1,
    revisions: record.revisions.map((revision) =>
      revision.id === record.currentRevisionId
        ? { ...revision, outputs: [output] }
        : revision,
    ),
  });
  vi.mocked(extractPdfText).mockResolvedValueOnce("SECRET");
  const rejected = await preparePackageAssembly(
    revised,
    revised.currentRevisionId,
    policy,
  );
  expect(rejected.readiness.state).toBe("incomplete");
  expect(
    rejected.readiness.findings.some((finding) =>
      /configured levels/.test(finding.message),
    ),
  ).toBe(true);
  expect(() => copyPreparedPackageOutput(rejected, asset.id)).toThrow(/Review/);
  vi.mocked(extractPdfText).mockResolvedValueOnce("Fictional SSN 123-45-6789");
  const reviewed = await preparePackageAssembly(
    revised,
    revised.currentRevisionId,
    policy,
  );
  expect(
    reviewed.reviews.some(
      (entry) =>
        entry.member.startsWith("Retained PDF:") && entry.review.privacy.found,
    ),
  ).toBe(true);
  expect(copyPreparedPackageOutput(reviewed, asset.id)).toEqual(bytes);
  await idbDeleteAttachment(asset.id);
  expect(copyPreparedPackageOutput(reviewed, asset.id)).toEqual(bytes);
});

it("preserves source enclosure bytes after replacement and deletion of the original source attachment", async () => {
  const original = await pdfBytes(),
    replacement = await pdfBytes(2);
  const first = await persistAttachment(
    { name: "support.pdf", type: "application/pdf", size: original.byteLength },
    original,
  );
  const source = {
    ...snapshot(),
    enclosures: [{ title: "Original support", fileRef: first }],
  };
  const member = await capturePackageMember(
    captureDocumentRevision(
      {
        documentId: "replace-source",
        epoch: 0,
        editSequence: 1,
        capturedAt: 100,
      },
      source,
    ),
    "Source with original enclosure",
    "basic-letter",
  );
  const record = await reviseActionPackage(
    await createActionPackage("Replacement preservation"),
    [member],
  );
  source.enclosures[0].fileRef = await persistAttachment(
    {
      name: "support.pdf",
      type: "application/pdf",
      size: replacement.byteLength,
    },
    replacement,
  );
  await idbDeleteAttachment(first.id);
  expect(
    (await readPackageMemberDraft(member)).reviewed.files[0]?.data,
  ).toEqual(original);
  const portable = await buildPortableActionPackage(record);
  await clearDb();
  const imported = await importPortableActionPackage(portable),
    retained = getPackageRevision(imported).members[0];
  if (retained.kind !== "native") throw new Error("Expected native member");
  expect(
    (await readPackageMemberDraft(retained)).reviewed.files[0]?.data,
  ).toEqual(original);
  expect((await collectLiveAttachmentIds())?.has(first.id)).toBe(false);
});

it.each([false, true])("cleans up a cancelled working-copy write without deleting a newer copy (newer: %s)", async newer => {
  const { record, member } = await fixture();
  const db = await import("@/lib/documentsDb");
  const { flushDocumentWrites } = await import("@/stores/documentsStore");
  const { editPackageMember } = await import("@/lib/actionPackageWorkingCopy");
  useDocumentsStore.getState().newDocument();
  await flushDocumentWrites();
  let writtenId = "";
  const put = db.idbPutDocument;
  const controller = new AbortController();
  vi.spyOn(db, "idbPutDocument").mockImplementationOnce(async document => {
    writtenId = document.id;
    expect(await put(document)).toBe(true);
    if (newer) expect(await put({ ...document, meta: { ...document.meta, title: "Newer independent copy" } })).toBe(true);
    controller.abort();
    return true;
  });
  await expect(editPackageMember(record, member, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  const documents = (await db.idbGetAllDocuments())!.filter(item => item.id === writtenId);
  expect(documents).toHaveLength(newer ? 1 : 0);
  if (newer) expect(documents![0].meta.title).toBe("Newer independent copy");
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it("opens a retained working copy when the recipient has no active document", async () => {
  const { record, member } = await fixture();
  const { editPackageMember } = await import("@/lib/actionPackageWorkingCopy");
  const updated = await editPackageMember(record, member);
  expect(updated.workingCopies).toHaveLength(1);
  expect(useDocumentsStore.getState().currentId).toBe(updated.workingCopies![0].documentId);
});

it("retains native PDF figures through package transfer and PDF assembly", async () => {
  const bytes = await pdfBytes();
  const fileRef = await persistAttachment({ name: "native-figure.pdf", type: "application/pdf", size: bytes.byteLength }, bytes);
  const source = { ...snapshot(), docType: "i_type" as const,
    formData: { ...snapshot().formData, shortTitle: "MI 12345A-26/1", pcn: "184 123456 00", nomenclature: "SUPPORT EQUIPMENT", subject: "INSPECT THE BRACKET",
      date: "30 Oct 26", publicationSigningDate: "2026-10-15", controllingOffice: "Program Office", cuiDistStatement: "A", signatureType: "digital" as const,
      fontFamily: "times", fontSize: "12pt", publicationType: "MI" as const, miUrgency: "normal" as const, miCompletionDate: "" }, paragraphs: [
    { id: "purpose", level: 0, header: "Purpose", text: "Inspect the support bracket." },
    { id: "administration", level: 0, header: "Administrative Instructions", text: `For questions or concerns with the content or procedures in this Modification Instruction (MI) contact office@example.mil. ${DISCREPANCY_NOTICE} ${MI_REPORTING}` },
    { id: "pdf-figure", text: "Preserved PDF diagram", level: 0, figure: { fileRef, name: "native-figure.pdf", type: "application/pdf" } },
  ] };
  const member = await capturePackageMember(captureDocumentRevision({ documentId: "pdf-figure-source", epoch: 0, editSequence: 1, capturedAt: Date.UTC(2026, 10, 14) }, source), "PDF figure source", "basic-letter");
  const record = await reviseActionPackage(await createActionPackage("PDF figure package"), [member]);
  const portable = await buildPortableActionPackage(record);
  await clearDb();
  const imported = await importPortableActionPackage(portable);
  const selected = getPackageRevision(imported).members[0];
  if (selected.kind !== "native") throw new Error("Expected native figure member");
  expect((await readPackageMemberDraft(selected)).reviewed.figures[2]?.data).toEqual(bytes);
  const ready = await preparePackageAssembly(imported, imported.currentRevisionId, policy);
  expect(ready.readiness.findings.filter(item => item.severity === "error")).toEqual([]);
  const result = await assemblePackage(ready, { compile: async () => new Uint8Array(await pdfBytes()), convertDocx: vi.fn(), waitForReady: async () => true });
  expect(getPackageRevision(result).outputs).toHaveLength(1);
});

it("rejects multi-page PDF figures before capture or portable import while allowing complete original PDFs", async () => {
  const { validatePackageDraft } = await import("@/lib/actionPackageDraft");
  const { buildDraftFileFromSnapshot } = await import("@/lib/draftFile");
  const bytes = await pdfBytes(2);
  const fileRef = await persistAttachment({ name: "two-page-drawing.pdf", type: "application/pdf", size: bytes.byteLength }, bytes);
  const source = { ...snapshot(), docType: "i_type" as const, paragraphs: [{ text: "Multi-sheet drawing", level: 0,
    figure: { name: "two-page-drawing.pdf", type: "application/pdf", fileRef } }] };
  await expect(capturePackageMember(captureDocumentRevision({ documentId: "multi-page-figure", epoch: 0, editSequence: 1, capturedAt: Date.now() }, source), "Drawing", "basic-letter"))
    .rejects.toThrow(/single-page figure.*enclosure/);
  const draft = await buildDraftFileFromSnapshot(source, Date.now());
  await expect(validatePackageDraft(draft)).rejects.toThrow(/single-page figure.*enclosure/);
  await expect(captureOriginalPackageMember({ name: "complete-drawing.pdf", data: bytes }, "enclosure", false)).resolves.toMatchObject({ kind: "original" });
});

it("reports unsupported business-letter PDF figures before assembly instead of failing during rendering", async () => {
  const bytes = await pdfBytes();
  const fileRef = await persistAttachment({ name: "business-drawing.pdf", type: "application/pdf", size: bytes.byteLength }, bytes);
  const source = { ...snapshot(), documentMode: "custom" as const, docType: "business_letter" as const,
    paragraphs: [{ text: "Original drawing", level: 0, figure: { name: "business-drawing.pdf", type: "application/pdf", fileRef } }] };
  const member = await capturePackageMember(captureDocumentRevision({ documentId: "business-pdf-figure", epoch: 0, editSequence: 1, capturedAt: Date.now() }, source), "Business letter", "basic-letter");
  const record = await reviseActionPackage(await createActionPackage("Business PDF figure"), [member]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, policy);
  expect(prepared.readiness.state).toBe("incomplete");
  expect(prepared.readiness.findings).toContainEqual(expect.objectContaining({ memberId: member.id, severity: "error", message: expect.stringMatching(/Business-letter figures require PNG or JPEG/) }));
});

it("assembles long supporting labels and preserves long original filenames", async () => {
  const { record, member } = await fixture();
  const name = `${"supporting-original-".repeat(8)}.pdf`;
  const original = await captureOriginalPackageMember({ name, data: await pdfBytes() }, "supporting-document", true);
  const updated = await reviseActionPackage(record, [member, original]);
  const ready = await preparePackageAssembly(updated, updated.currentRevisionId, policy);
  expect(ready.readiness.state).toBe("ready");
  const assembled = await assemblePackage(ready, { compile: async () => new Uint8Array(await pdfBytes()), convertDocx: vi.fn(), waitForReady: async () => true });
  expect(getPackageRevision(assembled).outputs[0].boundaries[1].firstPageLabel.length).toBeGreaterThan(80);
  const parsed = await parsePortableActionPackage(await buildPortableActionPackage(assembled));
  const retained = getPackageRevision(parsed.record).members[1];
  if (retained.kind !== "original") throw new Error("Expected original member");
  expect(retained.original.name).toBe(name);
});

async function zeroPageOriginalBytes() {
  const pdf = await PDFDocument.create();
  return new Uint8Array(await pdf.save({ addDefaultPage: false })).buffer;
}

async function zeroPageOriginalPacket() {
  const original = await captureOriginalPackageMember({ name: "original.pdf", data: await pdfBytes() }, "basic-letter", true);
  const record = await reviseActionPackage(await createActionPackage("Original validation"), [original]);
  const packet = JSON.parse(await buildPortableActionPackage(record)) as Packet;
  const member = getPackageRevision(packet.package).members[0];
  if (member.kind !== "original") throw new Error("Expected original PDF");
  const data = await zeroPageOriginalBytes();
  const ref = await persistAttachment({ name: member.original.name, type: "application/pdf", size: data.byteLength }, data);
  const asset = { ...ref, sha256: await portableResourceDigest(data) };
  packet.package.revisions[0].members[0] = { ...member, original: asset };
  packet.portableResources = await buildPortableResources([{ path: `assets/${asset.id}`, name: asset.name, mediaType: asset.type, data }]);
  return { packet, data, asset };
}

it("rejects zero-page originals before capture while preserving complete original PDF bytes", async () => {
  const { idbGetAllAttachments } = await import("@/lib/documentsDb");
  const before = await idbGetAllAttachments();
  await expect(captureOriginalPackageMember({ name: "empty-original.pdf", data: await zeroPageOriginalBytes() }, "basic-letter", true))
    .rejects.toThrow(/at least one page/);
  expect(await idbGetAllAttachments()).toEqual(before);
  const data = await pdfBytes(2);
  const member = await captureOriginalPackageMember({ name: "complete-original.pdf", data }, "basic-letter", true);
  if (member.kind !== "original") throw new Error("Expected original PDF");
  expect(await readPackageAsset(member.original)).toEqual(data);
});

it("rejects a checksummed zero-page original in a portable package before installation", async () => {
  const { packet } = await zeroPageOriginalPacket();
  const before = await listActionPackages();
  await expect(parsePortableActionPackage(JSON.stringify(packet))).rejects.toThrow(/at least one page/);
  await expect(importPortableActionPackage(JSON.stringify(packet))).rejects.toThrow(/at least one page/);
  expect(await listActionPackages()).toEqual(before);
});

it("rejects a checksummed zero-page original during package backup validation", async () => {
  const { packet, data, asset } = await zeroPageOriginalPacket();
  const before = await listActionPackages();
  await expect(validatePackageBackup([packet.package], new Map([[asset.id, data]]))).rejects.toThrow(/at least one page/);
  expect(await listActionPackages()).toEqual(before);
});

it("reports a retained zero-page original as incomplete before assembly", async () => {
  const { packet } = await zeroPageOriginalPacket();
  const prepared = await preparePackageAssembly(packet.package, packet.package.currentRevisionId, policy);
  expect(prepared.readiness.state).toBe("incomplete");
  expect(prepared.readiness.findings).toContainEqual(expect.objectContaining({ severity: "error", message: expect.stringMatching(/at least one page/) }));
  await expect(assemblePackage(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }))
    .rejects.toThrow(/Resolve package readiness findings/);
});

it("keeps an earlier marked original readable after version 200 and reload", async () => {
  const bytes = await pdfBytes();
  const original = await captureOriginalPackageMember({ name: "original.pdf", data: bytes }, "basic-letter", true);
  if (original.kind !== "original") throw new Error("Expected a captured original PDF");
  const prototype = await createActionPackage("Long-running action");
  const first = { ...getPackageRevision(prototype), members: [original] };
  const revisions = Array.from({ length: 200 }, (_, i) => ({
    ...first, id: `revision-${i + 1}`, ...(i > 0 && { parentId: `revision-${i}` }),
  }));
  const record = await commitActionPackage(null, { ...prototype, id: "package-long-history", revisions, currentRevisionId: "revision-200" });
  const saved = await reviseActionPackage(record, []);
  const [restored] = await listActionPackages(saved.id);
  expect(restored.revisions).toHaveLength(201);
  expect(getPackageRevision(restored).parentId).toBe("revision-200");
  expect(getPackageRevision(restored, "revision-1").members).toEqual([original]);
  expect(await readPackageAsset(original.original)).toEqual(bytes);
  const portable = await buildPortableActionPackage(restored, "revision-1");
  expect((await parsePortableActionPackage(portable)).record.revisions).toHaveLength(1);
});
