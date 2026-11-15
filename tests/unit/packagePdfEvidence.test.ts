import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectPackagePdf, reviewBoundedPackagePdf } from "@/lib/packagePdfEvidence";

import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("react-pdf", () => ({ pdfjs: { getDocument, GlobalWorkerOptions: {}, version: "test" } }));

function item(str = "Synthetic text") {
  return { str, transform: [1, 0, 0, 12, 20, 700], width: 100, height: 12, hasEOL: true };
}
function readerFixture(items: unknown[], count = 1) {
  const cleanup = vi.fn(), destroy = vi.fn(async () => {});
  const page = { view: [0, 0, 612, 792], rotate: 0, userUnit: 1, cleanup,
    streamTextContent: vi.fn(() => new ReadableStream({ start(controller) { controller.enqueue({ items });controller.close(); } })),
  };
  const getPage = vi.fn(async () => page);
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: count, getPage }), destroy });
  return { cleanup, destroy, getPage, page };
}
beforeEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());
describe("bounded PDF evidence reader", () => {
  it("hashes text and positioned layout with page geometry without exposing extracted content", async () => {
    const { destroy, cleanup } = readerFixture([item()]);
    const result = await inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ geometry: [0, 0, 612, 792, 0, 1], hasText: true });
    expect(result.pages[0].textSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("Synthetic text");
    expect(destroy).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();
    expect(getDocument.mock.calls[0][0].isEvalSupported).toBe(false);
  });
  it("does not declare scanned or empty pages to have inspectable text", async () => {
    readerFixture([]);
    expect((await inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal)).pages[0].hasText).toBe(false);
  });
  it("rejects excessive page counts before requesting a page and always destroys the document", async () => {
    const { destroy, getPage } = readerFixture([], 501);
    await expect(inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal)).rejects.toThrow("500 pages");
    expect(getPage).not.toHaveBeenCalled();expect(destroy).toHaveBeenCalledOnce();
  });
  it("stops oversized streamed text and invalid positioning before returning misleading evidence", async () => {
    let fixture = readerFixture([item("x".repeat(2_000_001))]);
    await expect(inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal)).rejects.toThrow("text layer exceeds");
    expect(fixture.cleanup).toHaveBeenCalledOnce();expect(fixture.destroy).toHaveBeenCalledOnce();
    fixture = readerFixture([{ ...item(), transform: [NaN, 0, 0, 12, 20, 700] }]);
    await expect(inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal)).rejects.toThrow("positioning is invalid");
    expect(fixture.destroy).toHaveBeenCalledOnce();
  });
  it("destroys a pending PDF load when the owning operation is cancelled", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_, fail) => { reject = fail; });
    const destroy = vi.fn(async () => { reject(new Error("worker destroyed")); });
    getDocument.mockReturnValue({ promise: pending, destroy });
    const controller = new AbortController();
    const result = inspectPackagePdf(new ArrayBuffer(1), controller.signal);
    const expectation = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
    controller.abort();await expectation;
    expect(destroy).toHaveBeenCalled();
  });
  it("destroys a stalled PDF load at the comparison deadline", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_, fail) => { reject = fail; });
    const destroy = vi.fn(async () => { reject(new Error("worker destroyed")); });
    getDocument.mockReturnValue({ promise: pending, destroy });
    vi.useFakeTimers();
    const result = inspectPackagePdf(new ArrayBuffer(1), new AbortController().signal);
    const expectation = expect(result).rejects.toThrow("took too long");
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(45_000);
    await expectation;
    expect(destroy).toHaveBeenCalled();
  });

  it("applies bounded extraction and the existing marking policy before comparison acknowledgement", async () => {
    const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
    readerFixture([item("Synthetic unclassified text")]);
    expect((await reviewBoundedPackagePdf(new ArrayBuffer(1), "Synthetic original", policy, new AbortController().signal)).notices).toHaveLength(1);
    readerFixture([], 501);
    await expect(reviewBoundedPackagePdf(new ArrayBuffer(1), "Synthetic original", policy, new AbortController().signal)).rejects.toThrow("500 pages");
    readerFixture([item("(TS) SYNTHETIC MARKING")]);
    await expect(reviewBoundedPackagePdf(new ArrayBuffer(1), "Synthetic original", policy, new AbortController().signal)).rejects.toThrow("configured levels");
  });

});
