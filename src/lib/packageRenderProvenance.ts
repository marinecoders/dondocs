import { z } from "zod";
import type { PackageRevision } from "./actionPackages";
import { portableResourceDigest } from "./portableResources";
import { APP_VERSION, GIT_SHA } from "./version";

const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Recorded build/input identifiers are comparison context, not an attestation. */
export const packageRenderProvenanceSchema = z.object({
  version: z.literal(1),
  inputSha256: digest,
  applicationVersion: z.string().max(32).regex(/^\d+\.\d+\.\d+$/),
  gitSha: z.string().regex(/^(?:[a-f0-9]{7,40}|test|dev|unknown)$/),
  templatesRevision: z.string().regex(/^(?:[a-f0-9]{64}|test)$/),
  runtimeRevision: digest.optional(),
  assembly: z.literal("package-v1"),
  exportContract: z.literal("prepared-export-v1"),
  pdfLibrary: z.literal("pdf-lib-1.17.1"),
}).strict();

export type PackageRenderProvenance = z.infer<typeof packageRenderProvenanceSchema>;

/** Source pointers and prior outputs do not affect rendering; member order does. */
export async function packageInputFingerprint(revision: PackageRevision): Promise<string> {
  const input = {
    version: 1,
    revisionId: revision.id,
    ...(revision.assembly ? { assembly: revision.assembly } : {}),
    ...(revision.templateState ? { templateState: revision.templateState } : {}),
    ...(revision.bindings ? { bindings: revision.bindings } : {}),
    ...(revision.information ? { information: revision.information } : {}),
    ...(revision.requirements ? { requirements: revision.requirements } : {}),
    members: revision.members.map(member => ({
      id: member.id,
      revisionId: member.revisionId,
      label: member.label,
      role: member.role,
      required: member.required,
      kind: member.kind,
      resources: member.kind === "original"
        ? [["original", member.original.sha256]]
        : [["draft", member.draft.sha256], ...Object.entries(member.templates ?? {})
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([name, asset]) => [name, asset.sha256])],
    })),
  };
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify(input)).buffer);
}

export async function capturePackageRenderProvenance(revision: PackageRevision): Promise<PackageRenderProvenance> {
  const runtimeRevision = /^\/runtimes\/([a-f0-9]{64})\/$/.exec(__RUNTIME_BASE__)?.[1];
  return packageRenderProvenanceSchema.parse({
    version: 1,
    inputSha256: await packageInputFingerprint(revision),
    applicationVersion: APP_VERSION,
    gitSha: GIT_SHA,
    templatesRevision: __LATEX_TEMPLATES_REVISION__,
    ...(runtimeRevision ? { runtimeRevision } : {}),
    assembly: "package-v1",
    exportContract: "prepared-export-v1",
    pdfLibrary: "pdf-lib-1.17.1",
  });
}
