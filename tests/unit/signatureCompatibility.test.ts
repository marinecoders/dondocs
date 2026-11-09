import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { parseSavedSession as oldParse } from "../_fixtures/legacy-1.3.37/savedSession";
import { serializeDocumentSnapshot as oldSerialize } from "../_fixtures/legacy-1.3.37/documentSerialization";
import { serializeDocumentSnapshot as serialize } from "@/lib/documentSerialization";
import { parseSavedSession as currentParse } from "@/lib/savedSession";
import { persistSignature } from "@/lib/signatureAssets";
import {
  createBlankSession,
  prepareSessionState,
  useDocumentStore,
} from "@/stores/documentStore";
import {
  useDocumentsStore,
  flushDocumentWrites,
  captureDocumentTarget,
} from "@/stores/documentsStore";
import { useProfileStore } from "@/stores/profileStore";
import { useFormStore, FORMS_PERSIST_KEY } from "@/stores/formStore";
import { useBatchStore, runBatchJob } from "@/stores/batchStore";
import { compressedParse } from "@/lib/compressedStorage";
import { restoreBackup } from "@/lib/backup";
import * as db from "@/lib/documentsDb";
import type { DocumentSnapshot } from "@/stores/historyStore";
import type { SerializedSession } from "@/stores/documentStore";
async function fixture(
  kind: "correspondence" | "navmc_10274" | "navmc_118_11" = "correspondence",
  refOnly = false,
) {
  const image = await persistSignature({
    name: "original.png",
    size: 3,
    data: "AQID",
  });
  const snapshot = prepareSessionState(
    createBlankSession(kind === "correspondence" ? undefined : kind),
  );
  if (kind === "correspondence")
    Object.assign(snapshot.formData, {
      signatureType: "image",
      signatureImage: { ...image, ...(refOnly ? { data: "" } : {}) },
    });
  else
    snapshot.forms![
      kind === "navmc_10274" ? "navmc10274" : "navmc11811"
    ]!.signatureBlocks = [
      {
        name: "Signer",
        statement: "",
        style: "image",
        image: refOnly ? undefined : image.data,
        imageRef: image.fileRef,
      },
    ];
  return { image, snapshot, session: serialize(snapshot, 1) };
}
function record(id: string, session: SerializedSession) {
  return {
    id,
    meta: {
      id,
      title: id,
      docType: session.docType,
      createdAt: 1,
      updatedAt: 1,
    },
    session,
  };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  await flushDocumentWrites();
  for (const record of (await db.idbGetAllDocuments()) ?? [])
    await db.idbDeleteDocument(record.id);
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: true,
  });
  useDocumentStore.getState().resetForm();
  useBatchStore.getState().reset();
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.restoreAllMocks();
});
it.each(["correspondence", "navmc_10274", "navmc_118_11"] as const)(
  "preserves inline fallback through 1.3.37 edit/save codec for new %s saves",
  async (kind) => {
    const { snapshot, image } = await fixture(kind);
    const saved = serialize(snapshot, 1);
    const old = oldParse(saved);
    if (kind === "correspondence") old.formData.subject = "Edited by407";
    else
      old.forms![
        kind === "navmc_10274" ? "navmc10274" : "navmc11811"
      ]!.signatureBlocks[0].name = "Edited by407";
    const again = oldSerialize(old as unknown as DocumentSnapshot, 2);
    const before = record("old-cas-" + kind, saved);
    const after = {
      ...before,
      meta: { ...before.meta, updatedAt: 2 },
      session: again,
    };
    expect(await db.idbWriteDocument(null, before as never)).toBe("committed");
    expect(await db.idbWriteDocument(before as never, after as never)).toBe(
      "committed",
    );
    const reopened = currentParse(
      (await db.idbGetAllDocuments())!.find(
        (record) => record.id === before.id,
      )!.session,
    );
    if (kind === "correspondence") {
      expect(saved.formData.signatureImage?.fileRef).toEqual(image.fileRef);
      expect(again.formData.signatureImage?.data).toBe("AQID");
      expect(reopened.formData.signatureImage?.data).toBe("AQID");
    } else {
      const key = kind === "navmc_10274" ? "navmc10274" : "navmc11811";
      expect(saved.forms![key]!.signatureBlocks[0].imageRef).toEqual(
        image.fileRef,
      );
      expect(again.forms![key]!.signatureBlocks[0].image).toBe("AQID");
      expect(reopened.forms![key]!.signatureBlocks[0].image).toBe("AQID");
    }
  },
);
it("backfills readable inactive reference-only library records during init without losing a missing-asset record", async () => {
  const { session, image } = await fixture("correspondence", true);
  await db.idbPutDocument(record("readable-legacy", session) as never);
  await db.idbSetSnapshots("readable-legacy", [{ ts: 1, session }]);
  const missing = structuredClone(session);
  missing.formData.signatureImage!.fileRef!.id = "missing-408-image";
  await db.idbPutDocument(record("missing-legacy", missing) as never);
  await db.idbSetCurrentId(null);
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: false,
  });
  await useDocumentsStore.getState().init();
  const records = await db.idbGetAllDocuments();
  expect(
    records!.find((record) => record.id === "readable-legacy")!.session.formData
      .signatureImage?.data,
  ).toBe("AQID");
  expect(
    records!.find((record) => record.id === "readable-legacy")!.session.formData
      .signatureImage?.fileRef,
  ).toEqual(image.fileRef);
  expect(
    records!.find((record) => record.id === "missing-legacy")!.session,
  ).toEqual(missing);
  expect(useDocumentsStore.getState().docs["missing-legacy"]).toBeDefined();
  expect(
    oldParse((await db.idbGetSnapshots("readable-legacy"))[0].session).formData
      .signatureImage?.data,
  ).toBe("AQID");
});
it("materializes ref-only backup document and history assets before publishing them", async () => {
  const { session, image } = await fixture("correspondence", true);
  const result = await restoreBackup(
    JSON.stringify({
      kind: "dondocs-backup",
      documents: [record("imported408", session)],
      snapshots: { imported408: [{ ts: 1, session }] },
    }),
  );
  expect(result.documents.imported).toBe(1);
  const saved = (await db.idbGetAllDocuments())!.find(
    (record) => record.id === "imported408",
  )!.session;
  expect(oldParse(saved).formData.signatureImage?.data).toBe("AQID");
  expect(saved.formData.signatureImage?.fileRef).toEqual(image.fileRef);
  expect(
    oldParse((await db.idbGetSnapshots("imported408"))[0].session).formData
      .signatureImage?.data,
  ).toBe("AQID");
});
it("materializes a selected reference-only profile seed before its saved document is acknowledged", async () => {
  const { image } = await fixture("correspondence", true);
  const seed = Object.values(useProfileStore.getInitialState().profiles)[0];
  useProfileStore.setState({
    selectedProfile: "RefOnly",
    profiles: {
      RefOnly: {
        ...seed,
        sigFirst: "Signer",
        signatureImage: { ...image, data: "" },
      },
    },
  });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField("subject", "Immediate edit");
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  const saved = (await db.idbGetAllDocuments())!.find(
    (record) => record.id === useDocumentsStore.getState().currentId,
  )!.session;
  expect(oldParse(saved).formData.signatureImage?.data).toBe("AQID");
});
it("materializes a ref-only snapshot before its restore save is acknowledged", async () => {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField("subject", "Current");
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  const { session } = await fixture("correspondence", true);
  expect(
    await useDocumentsStore
      .getState()
      .restoreSnapshot(session, captureDocumentTarget()),
  ).toBe("applied");
  await flushDocumentWrites();
  const saved = (await db.idbGetAllDocuments())!.find(
    (record) => record.id === useDocumentsStore.getState().currentId,
  )!.session;
  expect(oldParse(saved).formData.signatureImage?.data).toBe("AQID");
});
it("keeps inactive form image bytes in the persisted idle NAVMC buffers", async () => {
  const { image } = await fixture("correspondence", true);
  useFormStore
    .getState()
    .setNavmc10274Field("signatureBlocks", [
      {
        name: "Signer",
        statement: "",
        style: "typed",
        imageRef: image.fileRef,
      },
    ]);
  useFormStore
    .getState()
    .setNavmc11811Field("signatureBlocks", [
      {
        name: "Signer",
        statement: "",
        style: "digital",
        imageRef: image.fileRef,
      },
    ]);
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: false,
  });
  await useDocumentsStore.getState().init();
  await flushDocumentWrites();
  const saved = compressedParse<{
    state: {
      navmc10274: { signatureBlocks: Array<{ image?: string }> };
      navmc11811: { signatureBlocks: Array<{ image?: string }> };
    };
  }>(localStorage.getItem(FORMS_PERSIST_KEY)!);
  expect(saved.state.navmc10274.signatureBlocks[0].image).toBe("AQID");
  expect(saved.state.navmc11811.signatureBlocks[0].image).toBe("AQID");
});
it("keeps a ref-only frozen batch source portable to the407 reader", async () => {
  const { session } = await fixture("correspondence", true);
  const generate = vi.fn(async (_values, context) => {
    expect(oldParse(context.source).formData.signatureImage?.data).toBe("AQID");
    return new Uint8Array([1]);
  });
  await runBatchJob({
    source: session,
    title: "Batch",
    placeholders: [],
    generate,
    download: async () => {},
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(
    oldParse(useBatchStore.getState().source).formData.signatureImage?.data,
  ).toBe("AQID");
});

it("materializes a raw408 registry record through normal unopened-document metadata save", async () => {
  const { session, image } = await fixture("correspondence", true);
  const input = record("metadata408", session);
  await db.idbPutDocument(input as never);
  useDocumentsStore.setState({
    docs: { metadata408: { meta: input.meta, session } as never },
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: true,
  });
  useDocumentsStore.getState().renameDocument("metadata408", "Renamed safely");
  await flushDocumentWrites();
  const saved = (await db.idbGetAllDocuments())!.find(
    (record) => record.id === "metadata408",
  )!;
  expect(saved.meta.name).toBe("Renamed safely");
  expect(oldParse(saved.session).formData.signatureImage?.data).toBe("AQID");
  expect(saved.session.formData.signatureImage?.fileRef).toEqual(image.fileRef);
});
it("materializes readable inactive signers even when another image in the same session is unavailable", async () => {
  const { materializeSignatureFallbacks } =
    await import("@/lib/signatureCompatibility");
  const { session, image } = await fixture("navmc_10274", true);
  const missing = {
    id: "missing-independent-signer",
    name: "missing.png",
    size: 1,
    type: "image/png",
  };
  session.forms!.navmc10274!.signatureBlocks = [
    { name: "Missing", statement: "", style: "image", imageRef: missing },
    {
      name: "Readable",
      statement: "",
      style: "typed",
      imageRef: image.fileRef,
    },
  ];
  const before = structuredClone(session);
  const owned = await materializeSignatureFallbacks(session);
  expect(owned.forms!.navmc10274!.signatureBlocks[0]).toEqual(
    before.forms!.navmc10274!.signatureBlocks[0],
  );
  expect(owned.forms!.navmc10274!.signatureBlocks[1]).toMatchObject({
    style: "typed",
    image: "AQID",
    imageRef: image.fileRef,
  });
  expect(session).toEqual(before);
});
it("does not block readable library initialization on a stalled optional fallback backfill write", async () => {
  const { session } = await fixture("correspondence", true);
  const input = record("stalled-backfill408", session);
  await db.idbPutDocument(input as never);
  await db.idbSetCurrentId(null);
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: false,
  });
  const actual = db.idbWriteDocument;
  let entered = false;
  let release!: () => void;
  vi.spyOn(db, "idbWriteDocument").mockImplementation((...args) => {
    if (args[1].id === "stalled-backfill408") {
      entered = true;
      return new Promise((resolve) => {
        release = () => resolve("failed");
      });
    }
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let finished = false;
  const initializing = useDocumentsStore
    .getState()
    .init()
    .then(() => {
      finished = true;
    });
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    await vi.advanceTimersByTimeAsync(15001);
    await vi.waitFor(() => expect(finished).toBe(true), { timeout: 1000 });
    expect(
      useDocumentsStore.getState().docs["stalled-backfill408"],
    ).toBeDefined();
  } finally {
    release?.();
    vi.useRealTimers();
    await initializing;
  }
});
it("does not create a legacy form persistence key when no signature fallback changes", async () => {
  const { materializeStoredSignatureFallbacks } =
    await import("@/stores/signatureCompatibility");
  useFormStore.setState({
    navmc10274: structuredClone(useFormStore.getInitialState().navmc10274),
    navmc11811: structuredClone(useFormStore.getInitialState().navmc11811),
  });
  localStorage.removeItem(FORMS_PERSIST_KEY);
  const original = useFormStore.getState();
  await materializeStoredSignatureFallbacks();
  expect(localStorage.getItem(FORMS_PERSIST_KEY)).toBeNull();
  expect(useFormStore.getState().navmc10274).toBe(original.navmc10274);
  expect(useFormStore.getState().navmc11811).toBe(original.navmc11811);
});
