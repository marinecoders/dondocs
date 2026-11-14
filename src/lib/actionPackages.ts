import { z } from "zod";
import type { SerializedSession } from "@/stores/documentStore";
import { validateBackupSession } from "./backupValidation";
import {
  idbReadActionPackages,
  idbCompareActionPackage,
  sameReviewStoredValue,
} from "./documentsDb";
import { scheduleBackup } from "@/stores/backupStore";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const packageRoles = [
  "basic-letter",
  "endorsement",
  "coordination-sheet",
  "supporting-document",
  "enclosure",
] as const;
export const packageAssetSchema = z
  .object({
    id,
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(100),
    size: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: digest,
  })
  .strict();
export type PackageAsset = z.infer<typeof packageAssetSchema>;
const sourceSchema = z
  .object({
    documentId: id,
    capturedAt: z.number().int().nonnegative(),
    editSequence: z.number().int().nonnegative(),
    local: z.boolean(),
  })
  .strict();
const common = {
  id,
  revisionId: id,
  label: z.string().min(1).max(120),
  role: z.enum(packageRoles),
  required: z.boolean(),
};
const nativeSchema = z
  .object({
    ...common,
    kind: z.literal("native"),
    source: sourceSchema.optional(),
    draft: packageAssetSchema,
    session: z.custom<SerializedSession>((value) => {
      try {
        validateBackupSession(value);
        return !!value && typeof value === "object";
      } catch {
        return false;
      }
    }),
    templates: z
      .record(z.string().min(1).max(180), packageAssetSchema)
      .optional(),
  })
  .strict();
const originalSchema = z
  .object({
    ...common,
    kind: z.literal("original"),
    original: packageAssetSchema,
    signedOriginal: z.boolean(),
  })
  .strict();
export const packageMemberSchema = z.discriminatedUnion("kind", [
  nativeSchema,
  originalSchema,
]);
export type PackageMember = z.infer<typeof packageMemberSchema>;
export type NativePackageMember = Extract<PackageMember, { kind: "native" }>;
const boundarySchema = z
  .object({
    memberId: id,
    startPage: z.number().int().positive(),
    pageCount: z.number().int().positive(),
    firstPageLabel: z.string().min(1).max(80),
    numbering: z.enum(["continuation", "separate"]),
  })
  .strict();
export type PackageBoundary = z.infer<typeof boundarySchema>;
const outputSchema = z
  .object({
    id,
    asset: packageAssetSchema,
    createdAt: z.number().int().nonnegative(),
    policyIdentity: z.string().min(1).max(10000),
    renderer: z.string().min(1).max(512),
    boundaries: z.array(boundarySchema).max(100),
    signingStatus: z.literal("unsigned-assembled-derivative"),
  })
  .strict();
export type PackageOutput = z.infer<typeof outputSchema>;
const revisionSchema = z
  .object({
    id,
    parentId: id.optional(),
    createdAt: z.number().int().nonnegative(),
    members: z.array(packageMemberSchema).max(100),
    outputs: z.array(outputSchema).max(20),
  })
  .strict();
export type PackageRevision = z.infer<typeof revisionSchema>;
export const actionPackageSchema = z
  .object({
    kind: z.literal("dondocs-action-package-record"),
    version: z.literal(1),
    id,
    historyScope: z.enum(["complete", "selected-revision"]).optional(),
    name: z.string().trim().min(1).max(120),
    archived: z.boolean(),
    sequence: z.number().int().nonnegative(),
    currentRevisionId: id,
    revisions: z.array(revisionSchema).min(1).max(200),
    workingCopies: z
      .array(
        z.object({ memberId: id, documentId: id, revisionId: id }).strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const seen = new Set<string>(),
      memberRevisions = new Map<string, string>();
    for (const [index, revision] of record.revisions.entries()) {
      if (
        seen.has(revision.id) ||
        (revision.parentId &&
          !seen.has(revision.parentId) &&
          !(index === 0 && record.historyScope === "selected-revision"))
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid package revision lineage.",
        });
      seen.add(revision.id);
      for (const member of revision.members) {
        const key = `${member.id}:${member.revisionId}`,
          data = JSON.stringify(member);
        if (memberRevisions.has(key) && memberRevisions.get(key) !== data)
          ctx.addIssue({
            code: "custom",
            message: "A captured member revision was rewritten.",
          });
        memberRevisions.set(key, data);
      }
      if (
        new Set(revision.members.map((member) => member.id)).size !==
        revision.members.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate package member identity.",
        });
      if (
        new Set(revision.outputs.map((output) => output.id)).size !==
        revision.outputs.length
      )
        ctx.addIssue({ code: "custom", message: "Duplicate output identity." });
      for (const output of revision.outputs)
        if (
          output.boundaries.length !== revision.members.length ||
          output.boundaries.some(
            (boundary, index) =>
              boundary.memberId !== revision.members[index].id ||
              boundary.startPage !==
                (index
                  ? output.boundaries[index - 1].startPage +
                    output.boundaries[index - 1].pageCount
                  : 1),
          )
        )
          ctx.addIssue({
            code: "custom",
            message: "Invalid output member boundaries.",
          });
    }
    if (
      record.workingCopies?.some(
        (copy) =>
          !record.revisions.some(
            (revision) =>
              revision.id === copy.revisionId &&
              revision.members.some(
                (member) =>
                  member.id === copy.memberId && member.kind === "native",
              ),
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid package working copy binding.",
      });
    if (!seen.has(record.currentRevisionId))
      ctx.addIssue({
        code: "custom",
        message: "Missing current package revision.",
      });
  });
export type ActionPackage = z.infer<typeof actionPackageSchema>;
export const newPackageId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID()}`;
export function getPackageRevision(
  record: ActionPackage,
  revisionId = record.currentRevisionId,
): PackageRevision {
  const revision = record.revisions.find(
    (revision) => revision.id === revisionId,
  );
  if (!revision) throw new Error("This package revision is unavailable.");
  return structuredClone(revision);
}
/** Failed or corrupt inventory reads must never look like an empty workspace. */
export async function listActionPackages(): Promise<ActionPackage[]> {
  return (await idbReadActionPackages()).map((value) =>
    actionPackageSchema.parse(value),
  );
}
export function packageAssets(record: ActionPackage): PackageAsset[] {
  return record.revisions.flatMap((revision) => [
    ...revision.members.flatMap((member) =>
      member.kind === "original"
        ? [member.original]
        : [member.draft, ...Object.values(member.templates ?? {})],
    ),
    ...revision.outputs.map((output) => output.asset),
  ]);
}
export function packageDefinitions(records: ActionPackage[]) {
  return records.flatMap((record) =>
    record.revisions.flatMap((revision) =>
      revision.members.flatMap((member) =>
        member.kind === "native" && member.session.genericForm
          ? [member.session.genericForm.definition]
          : [],
      ),
    ),
  );
}
export async function commitActionPackage(
  before: ActionPackage | null,
  value: ActionPackage,
  signal?: AbortSignal,
): Promise<ActionPackage> {
  const after = actionPackageSchema.parse(structuredClone(value));
  const { validateActionPackageResources } = await import(
    "./actionPackageTransfer"
  );
  const { readPackageAsset } = await import("./actionPackageAssets");
  await validateActionPackageResources(after, readPackageAsset);
  signal?.throwIfAborted();
  if (!(await idbCompareActionPackage(before, after, () => !signal?.aborted)))
    throw new Error(
      "The package changed in another tab or could not be saved. Reopen it and retry; the previous revision is preserved.",
    );
  scheduleBackup();
  return after;
}
export async function createActionPackage(
  name: string,
  signal?: AbortSignal,
): Promise<ActionPackage> {
  const revision: PackageRevision = {
    id: newPackageId("revision"),
    createdAt: Date.now(),
    members: [],
    outputs: [],
  };
  return commitActionPackage(
    null,
    {
      kind: "dondocs-action-package-record",
      version: 1,
      id: newPackageId("package"),
      name,
      archived: false,
      sequence: 0,
      currentRevisionId: revision.id,
      revisions: [revision],
    },
    signal,
  );
}
export async function reviseActionPackage(
  record: ActionPackage,
  members: PackageMember[],
  signal?: AbortSignal,
): Promise<ActionPackage> {
  if (record.archived)
    throw new Error("Reopen this archived package before editing.");
  const revision: PackageRevision = {
    id: newPackageId("revision"),
    parentId: record.currentRevisionId,
    createdAt: Date.now(),
    members: structuredClone(members).map((member) => {
      const prior = getPackageRevision(record).members.find(
        (prior) => prior.id === member.id,
      );
      return prior &&
        prior.revisionId === member.revisionId &&
        !sameReviewStoredValue(prior, member)
        ? { ...member, revisionId: newPackageId("member-revision") }
        : member;
    }),
    outputs: [],
  };
  return commitActionPackage(
    record,
    {
      ...record,
      sequence: record.sequence + 1,
      currentRevisionId: revision.id,
      revisions: [...record.revisions, revision],
    },
    signal,
  );
}
export async function renameActionPackage(
  record: ActionPackage,
  name: string,
  signal?: AbortSignal,
) {
  return commitActionPackage(
    record,
    {
      ...record,
      name,
      sequence: record.sequence + 1,
    },
    signal,
  );
}
export async function archiveActionPackage(
  record: ActionPackage,
  archived: boolean,
  signal?: AbortSignal,
) {
  return commitActionPackage(
    record,
    {
      ...record,
      archived,
      sequence: record.sequence + 1,
    },
    signal,
  );
}
export async function duplicateActionPackage(
  record: ActionPackage,
  name = `${record.name} copy`,
  signal?: AbortSignal,
): Promise<ActionPackage> {
  return commitActionPackage(
    null,
    {
      ...structuredClone(record),
      id: newPackageId("package"),
      name,
      archived: false,
      sequence: 0,
      workingCopies: undefined,
    },
    signal,
  );
}

/** Existing captured inputs and artifacts are immutable even when a caller bypasses UI actions. */
export function validPackageTransition(
  before: ActionPackage | null,
  after: ActionPackage,
): boolean {
  if (!before) return true;
  if (
    before.historyScope !== after.historyScope ||
    before.id !== after.id ||
    after.sequence !== before.sequence + 1 ||
    after.revisions.length < before.revisions.length
  )
    return false;
  for (let index = 0; index < before.revisions.length; index++) {
    const prior = before.revisions[index],
      next = after.revisions[index];
    if (
      !sameReviewStoredValue(
        { ...prior, outputs: [] },
        { ...next, outputs: [] },
      ) ||
      next.outputs.length < prior.outputs.length ||
      prior.outputs.some(
        (output, offset) =>
          !sameReviewStoredValue(output, next.outputs[offset]),
      )
    )
      return false;
  }
  if (after.revisions.length === before.revisions.length)
    return after.currentRevisionId === before.currentRevisionId;
  return (
    !before.archived &&
    after.revisions.length === before.revisions.length + 1 &&
    after.revisions.at(-1)?.parentId === before.currentRevisionId &&
    after.currentRevisionId === after.revisions.at(-1)?.id
  );
}
