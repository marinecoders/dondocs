import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import * as attachments from "@/lib/attachments";
import {
  idbGetSnapshots,
  idbAddSnapshot,
  MAX_SNAPSHOTS,
} from "@/lib/documentsDb";
import {
  useDocumentsStore,
  flushDocumentWrites,
} from "@/stores/documentsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useProfileStore } from "@/stores/profileStore";
it("lists and retains newer checkpoints ahead of an older checkpoint delayed by signature fallback", async () => {
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: true,
  });
  useDocumentsStore.getState().newDocument();
  const id = useDocumentsStore.getState().currentId!;
  const ref = { id: "owned", name: "saved.png", size: 3, type: "image/png" };
  let release!: (
    value: Awaited<ReturnType<typeof attachments.readAttachment>>,
  ) => void;
  const pending = new Promise<
    Awaited<ReturnType<typeof attachments.readAttachment>>
  >((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(attachments, "readAttachment").mockReturnValue(pending);
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    useDocumentStore
      .getState()
      .setField("signatureImage", {
        name: ref.name,
        size: 3,
        data: "",
        fileRef: ref,
      });
    useDocumentStore.getState().setField("subject", "Earlier checkpoint");
    useDocumentsStore.getState().saveCurrent();
    now.mockReturnValue(2000);
    useDocumentStore
      .getState()
      .setField("signatureImage", {
        name: ref.name,
        size: 3,
        data: "AQID",
        fileRef: ref,
      });
    useDocumentStore.getState().setField("subject", "Newer checkpoint");
    useDocumentsStore.getState().saveCurrent();
    await vi.waitFor(async () =>
      expect(
        (await idbGetSnapshots(id)).some((snapshot) => snapshot.ts === 2000),
      ).toBe(true),
    );
    release({
      status: "found",
      attachment: { ...ref, data: new Uint8Array([1, 2, 3]).buffer },
    });
    await flushDocumentWrites();
    await vi.waitFor(async () =>
      expect((await idbGetSnapshots(id)).length).toBeGreaterThanOrEqual(2),
    );
    const snapshots = await idbGetSnapshots(id);
    expect(snapshots[0].ts).toBe(2000);
    expect(snapshots[0].session.formData.subject).toBe("Newer checkpoint");
  } finally {
    now.mockRestore();
    read.mockRestore();
  }
});

it("keeps the newest bounded checkpoint set when an obsolete capture arrives after the ring is full", async () => {
  const saved = {
    documentMode: "compliant",
    documentCategory: "correspondence",
    docType: "naval_letter",
    formType: "navmc_10274",
    formData: { subject: "Saved" },
    paragraphs: [],
    references: [],
    enclosures: [],
    copyTos: [],
    distributions: [],
    timestamp: 1,
  } as never;
  for (let index = 1; index <= MAX_SNAPSHOTS; index++)
    expect(
      await idbAddSnapshot("full-ring", { ts: index + 100, session: saved }),
    ).toBe(true);
  expect(await idbAddSnapshot("full-ring", { ts: 1, session: saved })).toBe(
    true,
  );
  const ring = await idbGetSnapshots("full-ring");
  expect(ring).toHaveLength(MAX_SNAPSHOTS);
  expect(ring.map((snapshot) => snapshot.ts)).toEqual(
    Array.from(
      { length: MAX_SNAPSHOTS },
      (_, index) => 100 + MAX_SNAPSHOTS - index,
    ),
  );
});
