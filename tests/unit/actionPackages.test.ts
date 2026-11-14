import { reviewPackageNative } from "@/lib/actionPackageDisclosure";
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
} from "@/lib/actionPackageAssets";
import {
  createActionPackage,
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
          original.kind === "original" ? original.original : original.draft,
        ),
      ),
    ).toEqual(
      new Uint8Array(
        await readPackageAsset(
          original.kind === "original" ? original.original : original.draft,
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
        original.kind === "original" ? original.original : original.draft,
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
