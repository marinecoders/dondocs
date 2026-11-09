import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import * as db from "@/lib/documentsDb";
import { createBlankSession } from "@/stores/documentStore";
import { useDocumentsStore } from "@/stores/documentsStore";
import { useProfileStore } from "@/stores/profileStore";
import { useBatchStore } from "@/stores/batchStore";
import { useUserTemplatesStore } from "@/stores/userTemplatesStore";
import { useUIStore } from "@/stores/uiStore";
it("initializes healthy library records within the storage deadline when optional old-history read stalls", async () => {
  const session = createBlankSession();
  session.formData.subject = "Healthy visible document";
  expect(
    await db.idbPutDocument({
      id: "healthy",
      meta: {
        id: "healthy",
        title: "Healthy",
        docType: session.docType,
        updatedAt: 1,
      },
      session,
    }),
  ).toBe(true);
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useBatchStore.setState({ source: null, status: "idle" });
  useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: "ok" });
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: false,
    activationEpoch: 0,
  });
  let entered!: () => void;
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = vi.spyOn(db, "idbReadSnapshots").mockImplementation(async () => {
    entered();
    return await new Promise<db.DocSnapshot[]>(() => {});
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    let settled = false;
    const starting = useDocumentsStore
      .getState()
      .init()
      .then(() => {
        settled = true;
      });
    await called;
    await vi.advanceTimersByTimeAsync(15001);
    expect(settled).toBe(true);
    expect(
      useDocumentsStore.getState().docs.healthy?.session.formData.subject,
    ).toBe("Healthy visible document");
    await starting;
  } finally {
    vi.useRealTimers();
    spy.mockRestore();
  }
});
