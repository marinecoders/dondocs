import { describe, expect, it } from "vitest";
import type { PackageRevision } from "@/lib/actionPackages";
import { capturePackageRenderProvenance, packageInputFingerprint, packageRenderProvenanceSchema } from "@/lib/packageRenderProvenance";

const sha = "a".repeat(64);
function revision(): PackageRevision {
  return {
    id: "revision-one", createdAt: 1, outputs: [], members: [{
      id: "member", revisionId: "member-revision", kind: "original", label: "Original", role: "basic-letter", required: true,
      signedOriginal: true, original: { id: "asset", name: "signed.pdf", type: "application/pdf", size: 3, sha256: sha },
    }],
  };
}
describe("recorded package render inputs", () => {
  it("binds input bytes, roles, ordering and revision identity without depending on previous outputs", async () => {
    const input = revision(), fingerprint = await packageInputFingerprint(input);
    const variant = structuredClone(input);
    variant.members[0].role = "enclosure";
    expect(await packageInputFingerprint(variant)).not.toBe(fingerprint);
    variant.members[0] = structuredClone(input.members[0]);
    if (variant.members[0].kind === "original") variant.members[0].original.sha256 = "b".repeat(64);
    expect(await packageInputFingerprint(variant)).not.toBe(fingerprint);
    variant.members[0] = structuredClone(input.members[0]);
    variant.id = "different-revision";
    expect(await packageInputFingerprint(variant)).not.toBe(fingerprint);
    variant.id = input.id;
    variant.outputs = [{ id: "irrelevant" } as PackageRevision["outputs"][number]];
    expect(await packageInputFingerprint(variant)).toBe(fingerprint);
    variant.members.push({ ...structuredClone(variant.members[0]), id: "other", revisionId: "other-revision" });
    const ordered = await packageInputFingerprint(variant);
    variant.members.reverse();
    expect(await packageInputFingerprint(variant)).not.toBe(ordered);
  });
  it("records known build/template identifiers and leaves mutable runtime resources unqualified", async () => {
    const input = revision(), context = await capturePackageRenderProvenance(input);
    expect(context.inputSha256).toBe(await packageInputFingerprint(input));
    expect(context.applicationVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(context.runtimeRevision).toBeUndefined();
    expect(context.assembly).toBe("package-v1");
  });
  it("rejects unknown versions, arbitrary metadata and unsupported claimed attestations", async () => {
    const context = await capturePackageRenderProvenance(revision());
    for (const bad of [{ ...context, version: 2 }, { ...context, applicationVersion: "SECRET" }, { ...context, gitSha: "user supplied text" },
      { ...context, runtimeRevision: "mutable/latest" }, { ...context, authenticated: true }]) {
      expect(packageRenderProvenanceSchema.safeParse(bad).success).toBe(false);
    }
  });
});
