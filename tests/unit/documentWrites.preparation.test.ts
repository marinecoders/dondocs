import { expect, it, vi } from "vitest";
import { DocumentWrites, WRITE_JOURNAL_KEY } from "@/lib/documentWrites";
import type { StoredDocument, DocumentWriteOutcome } from "@/lib/documentsDb";
function record(subject: string): StoredDocument {
  return {
    id: "A",
    meta: { id: "A", title: "A", docType: "naval_letter", updatedAt: 1 },
    session: {
      documentMode: "compliant",
      documentCategory: "correspondence",
      docType: "naval_letter",
      formType: "navmc_10274",
      formData: {
        subject,
        signatureImage: {
          name: "saved.png",
          size: 3,
          data: "",
          fileRef: {
            id: "asset",
            name: "saved.png",
            size: 3,
            type: "image/png",
          },
        },
      },
      paragraphs: [],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
      timestamp: 1,
    },
  };
}
function enriched(value: StoredDocument) {
  const result = structuredClone(value);
  result.session.formData.signatureImage!.data = "AQID";
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("journals an owned capture immediately, adopts prepared bytes under the same revision, and receipts match actual storage", async () => {
  sessionStorage.removeItem(WRITE_JOURNAL_KEY);
  const gate = deferred<StoredDocument>();
  const writeGate = deferred<DocumentWriteOutcome>();
  const write = vi.fn((_before: StoredDocument | null, _after: StoredDocument) => writeGate.promise);
  const prepare = vi.fn(() => gate.promise);
  const queue = new DocumentWrites(write, () => {}, prepare);
  const original = record("Captured");
  const revision = queue.enqueue(null, original);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0].versions[0]
      .session.formData.subject,
  ).toBe("Captured");
  original.session.formData.subject = "Later caller mutation";
  const actual = enriched(record("Captured"));
  gate.resolve(actual);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const pending = JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0]
    .versions[0];
  expect(pending).toEqual(actual);
  actual.session.formData.subject = "Later preparer mutation";
  expect(write.mock.calls[0][1].session.formData.subject).toBe("Captured");
  writeGate.resolve("committed");
  expect(await queue.flush()).toBe(true);
  const status = queue.status(revision);
  expect(status?.status).toBe("committed");
  if (status?.status !== "committed") throw new Error("Missing receipt");
  expect(status.receipt.revision).toBe(revision);
  expect(queue.matches(status.receipt, enriched(record("Captured")))).toBe(
    true,
  );
  expect(queue.matches(status.receipt, record("Captured"))).toBe(false);
});
it("uses actual prepared predecessor for the queued successor CAS rather than its original ref-only capture", async () => {
  const first = deferred<StoredDocument>();
  const saved: StoredDocument[] = [];
  const prepare = vi.fn(async (value: StoredDocument) =>
    prepare.mock.calls.length === 1 ? first.promise : enriched(value),
  );
  const write = vi.fn(
    async (before: StoredDocument | null, after: StoredDocument) => {
      expect(before).toEqual(saved.at(-1) ?? null);
      saved.push(structuredClone(after));
      return "committed" as const;
    },
  );
  const queue = new DocumentWrites(write, () => {}, prepare);
  const one = queue.enqueue(null, record("One"));
  const two = queue.enqueue(record("One"), record("Two"));
  first.resolve(enriched(record("One")));
  expect(await queue.flush()).toBe(true);
  expect(write).toHaveBeenCalledTimes(2);
  expect(saved.map((v) => v.session.formData.subject)).toEqual(["One", "Two"]);
  expect(queue.status(one)?.status).toBe("committed");
  expect(queue.status(two)?.status).toBe("committed");
});
it("cancellation during preparation cannot write or resurrect the obsolete revision and a new same-id revision still drains", async () => {
  const old = deferred<StoredDocument>();
  const prepare = vi.fn(async (value: StoredDocument) =>
    prepare.mock.calls.length === 1 ? old.promise : enriched(value),
  );
  const write = vi.fn(async (_before: StoredDocument | null, _after: StoredDocument) => "committed" as const);
  const queue = new DocumentWrites(write, () => {}, prepare);
  const obsolete = queue.enqueue(null, record("Obsolete"));
  queue.cancel("A");
  const latest = queue.enqueue(null, record("Latest"));
  old.resolve(enriched(record("Obsolete")));
  expect(await queue.flush()).toBe(true);
  expect(queue.status(obsolete)?.status).toBe("cancelled");
  expect(queue.status(latest)?.status).toBe("committed");
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][1].session.formData.subject).toBe("Latest");
});
it("preparation failure retains recoverable input and retries without losing the original revision", async () => {
  const prepare = vi.fn(async (value: StoredDocument) => {
    if (prepare.mock.calls.length === 1)
      throw new Error("Temporary read failure");
    return enriched(value);
  });
  const write = vi.fn(async (_before: StoredDocument | null, _after: StoredDocument) => "committed" as const);
  const queue = new DocumentWrites(write, () => {}, prepare);
  const revision = queue.enqueue(null, record("Recover me"));
  await vi.waitFor(() => expect(queue.failure("A")).toBe("failed"));
  expect(write).not.toHaveBeenCalled();
  expect(queue.status(revision)?.status).toBe("failed");
  expect(
    JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0].versions[0]
      .session.formData.subject,
  ).toBe("Recover me");
  expect(await queue.flush()).toBe(true);
  expect(queue.status(revision)?.status).toBe("committed");
  expect(write).toHaveBeenCalledTimes(1);
});
it("representation-only verification remains non-edit during prepared bytes and receives an actual receipt", async () => {
  const actual = record("Unchanged");
  const gate = deferred<DocumentWriteOutcome>();
  const write = vi.fn(() => gate.promise);
  const queue = new DocumentWrites(
    write,
    () => {},
    async (value) => enriched(value),
  );
  const revision = queue.enqueue(actual, actual);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(queue.hasChanges("A")).toBe(false);
  expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).toBeNull();
  gate.resolve("committed");
  expect(await queue.flush()).toBe(true);
  expect(queue.status(revision)?.status).toBe("committed");
});

it("a slow preparation reports the storage deadline without spawning a duplicate writer and may still commit its owned revision", async () => {
  vi.useFakeTimers();
  try {
    const gate = deferred<StoredDocument>();
    const prepare = vi.fn(() => gate.promise);
    const write = vi.fn(async (_before: StoredDocument | null, _after: StoredDocument) => "committed" as const);
    const queue = new DocumentWrites(write, () => {}, prepare);
    const revision = queue.enqueue(null, record("Slow but retained"));
    await vi.advanceTimersByTimeAsync(15001);
    expect(queue.failure("A")).toBe("failed");
    expect(queue.status(revision)?.status).toBe("failed");
    queue.retry("A");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(
      JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0].versions[0]
        .session.formData.subject,
    ).toBe("Slow but retained");
    gate.resolve(enriched(record("Slow but retained")));
    expect(await queue.flush()).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.status(revision)?.status).toBe("committed");
  } finally {
    vi.useRealTimers();
  }
});
