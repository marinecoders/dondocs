import { afterEach, expect, it, vi } from "vitest";
import * as attachments from "@/lib/attachments";
import { materializeSignatureFallback } from "@/lib/signatureCompatibility";
import { STORAGE_WAIT_MS } from "@/lib/documentWrites";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("finishes optional compatibility fallback when only the attachment read stalls", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.spyOn(attachments, "readAttachment").mockReturnValueOnce(
    new Promise(() => {}),
  );
  const source = {
    name: "stalled.png",
    size: 1,
    data: "",
    fileRef: {
      id: "stalled-signature",
      name: "stalled.png",
      size: 1,
      type: "image/png",
    },
  };
  let result: unknown;
  void materializeSignatureFallback(source).then((value) => {
    result = value;
  });
  await vi.advanceTimersByTimeAsync(STORAGE_WAIT_MS + 1);
  expect(result).toEqual(source);
});
