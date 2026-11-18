import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturePreparedPackageComparison, type PreparedPackageAssembly } from "@/lib/actionPackageAssembly";
import type { PackageOutput, PackageRevision } from "@/lib/actionPackages";
import { capturePackageRenderProvenance } from "@/lib/packageRenderProvenance";
import { portableResourceDigest } from "@/lib/portableResources";
import { comparePreparedPackageOutputs, MAX_PACKAGE_COMPARISON_BYTES, type PackagePdfEvidence } from "@/lib/packageRenderComparison";

vi.mock("@/lib/actionPackageAssembly", () => ({ capturePreparedPackageComparison: vi.fn(), preparePackageAssembly: vi.fn() }));
const digest = "a".repeat(64);
const prepared = { purpose: "pdf", revisionId: "revision", readiness: { state: "ready", findings: [] }, reviews: [] } as PreparedPackageAssembly;
const evidence = (text = "same", width = 612, hasText = true): PackagePdfEvidence => ({ pages: [{ geometry: [0, 0, width, 792, 0, 1], textSha256: text, layoutSha256: text, hasText }] });
async function fixture() {
  const revision: PackageRevision = { id: "revision", createdAt: 1, members: [{ id: "member", revisionId: "member-revision", role: "basic-letter", required: true,
    kind: "original", label: "Original", signedOriginal: true, original: { id: "original", name: "signed.pdf", type: "application/pdf", size: 1, sha256: digest } }], outputs: [] };
  const beforeBytes = new Uint8Array([1, 2, 3]).buffer, afterBytes = new Uint8Array([4, 5, 6]).buffer;
  const provenance = await capturePackageRenderProvenance(revision);
  const before: PackageOutput = { id: "before", createdAt: 1, asset: { id: "before-asset", name: "a.pdf", type: "application/pdf", size: 3, sha256: await portableResourceDigest(beforeBytes) },
    policyIdentity: "policy", renderer: "legacy renderer", boundaries: [{ memberId: "member", startPage: 1, pageCount: 1, firstPageLabel: "1", numbering: "continuation" }], signingStatus: "unsigned-assembled-derivative", provenance };
  const after: PackageOutput = { ...structuredClone(before), id: "after", createdAt: 2, asset: { ...before.asset, id: "after-asset", sha256: await portableResourceDigest(afterBytes) } };
  revision.outputs = [before, after];
  const input = { revision, before, after, beforeBytes, afterBytes };
  vi.mocked(capturePreparedPackageComparison).mockReturnValue(input);
  return input;
}
beforeEach(() => vi.resetAllMocks());
describe("retained PDF evidence comparison", () => {
  it("distinguishes byte changes from matching observed PDF metrics without claiming visual parity", async () => {
    await fixture();
    const result = await comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, async () => evidence());
    expect(result).toMatchObject({ identicalBytes: false, extractedText: "matches", textLayout: "matches", pageGeometry: "matches", memberBoundaries: "matches", recordedResources: "unavailable", recordedInputs: "matches" });
    expect(result).not.toHaveProperty("equivalent");
    expect(capturePreparedPackageComparison).toHaveBeenCalledWith(prepared, "before", "after");
  });
  it("reports actual text, page geometry and member-boundary differences independently", async () => {
    const input = await fixture(); input.after.boundaries[0].firstPageLabel = "Changed";
    const inspect = vi.fn().mockResolvedValueOnce(evidence()).mockResolvedValueOnce(evidence("new-text", 792));
    expect(await comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, inspect))
      .toMatchObject({ extractedText: "differs", textLayout: "differs", pageGeometry: "differs", memberBoundaries: "differs" });
  });
  it("handles legacy and scanned outputs without treating missing provenance or empty text as a match", async () => {
    const input = await fixture(); delete input.before.provenance;
    const result = await comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, async () => evidence("", 612, false));
    expect(result).toMatchObject({ extractedText: "unavailable", textLayout: "unavailable", recordedInputs: "unavailable", beforeVersion: null, pagesWithoutText: [1] });
  });
  it("does not let matching app versions override different recorded runtime or template resources", async () => {
    const input = await fixture();
    input.before.provenance = { ...input.before.provenance!, runtimeRevision: "1".repeat(64), templatesRevision: "2".repeat(64) };
    input.after.provenance = { ...input.after.provenance!, runtimeRevision: "3".repeat(64), templatesRevision: "2".repeat(64) };
    const result = await comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, async () => evidence());
    expect(result.recordedResources).toBe("differs");
    input.after.provenance.runtimeRevision = input.before.provenance.runtimeRevision;
    expect((await comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, async () => evidence())).recordedResources).toBe("matches");
  });
  it("rejects inconsistent input provenance, corrupt bytes and an oversized pair before PDF inspection", async () => {
    const input = await fixture(), inspect = vi.fn(async () => evidence());
    input.before.provenance!.inputSha256 = "f".repeat(64);
    await expect(comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, inspect)).rejects.toThrow("recorded inputs");
    delete input.before.provenance;
    input.before.asset.sha256 = "f".repeat(64);
    await expect(comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, inspect)).rejects.toThrow("checksum");
    input.beforeBytes = new ArrayBuffer(MAX_PACKAGE_COMPARISON_BYTES);
    await expect(comparePreparedPackageOutputs(prepared, "before", "after", new AbortController().signal, inspect)).rejects.toThrow("25 MB");
    expect(inspect).not.toHaveBeenCalled();
  });
  it("stops a cancelled comparison between asynchronous PDF reads without publishing a result", async () => {
    await fixture(); const controller = new AbortController(), inspect = vi.fn(async () => { controller.abort();return evidence(); });
    await expect(comparePreparedPackageOutputs(prepared, "before", "after", controller.signal, inspect)).rejects.toMatchObject({ name: "AbortError" });
    expect(inspect).toHaveBeenCalledOnce();
  });
});
