import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankSession } from "@/stores/documentStore";
import { persistSignature } from "@/lib/signatureAssets";
import * as attachments from "@/lib/attachments";
import { useBatchStore, runBatchJob } from "@/stores/batchStore";
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const image = await persistSignature({
    name: "saved.png",
    size: 3,
    data: "AQID",
  });
  const source = createBlankSession();
  source.timestamp = 100;
  source.formData.signatureImage = { ...image, data: "" };
  useBatchStore.setState({
    rows: [{ id: "row1", values: { name: "Original" }, status: "pending" }],
    source: null,
    jobId: null,
    status: "idle",
    review: null,
    rowCanCancel: false,
    rowActive: false,
    title: "",
    placeholders: [],
    stopRequested: false,
    recoveryError: "",
  });
  let finish!: (
    value: Awaited<ReturnType<typeof attachments.readAttachment>>,
  ) => void;
  const reading = new Promise<
    Awaited<ReturnType<typeof attachments.readAttachment>>
  >((resolve) => {
    finish = resolve;
  });
  vi.spyOn(attachments, "readAttachment").mockReturnValue(reading);
  const release = () =>
    finish({
      status: "found",
      attachment: { ...image.fileRef!, data: new Uint8Array([1, 2, 3]).buffer },
    });
  return { source, release };
}
it("reserves batch ownership before async compatibility materialization and preserves capture identity", async () => {
  const { source, release } = await setup();
  const generate = vi.fn(async (_values, context) => {
    expect(context.source.timestamp).toBe(100);
    expect(context.capturedAt).toBe(100);
    expect(context.source.formData.signatureImage.data).toBe("AQID");
    return new Uint8Array([1]);
  });
  const download = vi.fn();
  const first = runBatchJob({
    source,
    title: "Captured",
    placeholders: ["name"],
    generate,
    download,
  });
  expect(useBatchStore.getState().status).toBe("running");
  const id = useBatchStore.getState().jobId;
  const second = runBatchJob({
    source: { ...source, timestamp: 999 },
    title: "Later",
    placeholders: [],
    generate,
    download,
  });
  source.timestamp = 999;
  source.formData.subject = "Later";
  useBatchStore.getState().reset();
  expect(useBatchStore.getState().jobId).toBe(id);
  expect(useBatchStore.getState().status).toBe("running");
  release();
  await Promise.all([first, second]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledTimes(1);
  expect(useBatchStore.getState().source!.timestamp).toBe(100);
});
it("honors Stop while compatibility materialization is waiting", async () => {
  const { source, release } = await setup();
  const generate = vi.fn(async () => new Uint8Array([1]));
  const download = vi.fn();
  const run = runBatchJob({
    source,
    title: "Captured",
    placeholders: ["name"],
    generate,
    download,
  });
  expect(useBatchStore.getState().status).toBe("running");
  useBatchStore.getState().stop();
  release();
  await run;
  expect(generate).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(useBatchStore.getState().status).toBe("paused");
});
