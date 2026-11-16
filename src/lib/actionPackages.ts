import { z } from "zod";
import type { SerializedSession } from "@/stores/documentStore";
import { validateBackupSession } from "./backupValidation";
import {
  idbReadActionPackages,
  idbCompareActionPackage,
  sameReviewStoredValue,
} from "./documentsDb";
import { scheduleBackup } from "@/stores/backupStore";
import { packageRenderProvenanceSchema } from "./packageRenderProvenance";
import { packageCitationsSchema, type PackageCitations } from "./packageCitationSchema";

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
    firstPageLabel: z.string().min(1).max(120),
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
    provenance: packageRenderProvenanceSchema.optional(),
    boundaries: z.array(boundarySchema).max(100),
    signingStatus: z.literal("unsigned-assembled-derivative"),
  })
  .strict();
export type PackageOutput = z.infer<typeof outputSchema>;
export const packageRevisionSchema = z
  .object({
    id,
    parentId: id.optional(),
    createdAt: z.number().int().nonnegative(),
    members: z.array(packageMemberSchema).max(100),
    outputs: z.array(outputSchema).max(20),
    citations: packageCitationsSchema.optional(),
  })
  .strict();
export type PackageRevision = z.infer<typeof packageRevisionSchema>;
/** Package review authority is separate from native document ownership. */
export const packageReviewBindingSchema = z.object({
  packageId: id, roundId: id, revisionId: id, baselineDigest: digest,
  memberId: id, memberRevisionId: id, memberDigest: digest, assetDigest: digest,
}).strict();
export type PackageReviewBinding = z.infer<typeof packageReviewBindingSchema>;
export const packageReviewRoundSchema = z.object({
  kind: z.literal("dondocs-package-review-round"), version: z.literal(1),
  id, packageId: id, revisionId: id, label: z.string().trim().min(1).max(120),
  createdAt: z.number().int().nonnegative(), baselineDigest: digest,
  // Captured again because output may be appended to a saved revision later.
  // This also remains a GC/backup root if history pruning is added in future.
  baseline: packageRevisionSchema,
  members: z.array(packageReviewBindingSchema).max(100),
  ownerPackageId: id.optional(),
  lifecycle: z.object({ events: z.array(z.object({
    id, state: z.enum(["active", "closed", "superseded"]),
    changedAt: z.number().int().nonnegative(), replacementRoundId: id.optional(),
  }).strict()).min(1).max(100) }).strict().optional(),
}).strict().superRefine((round, ctx) => {
  let state = "active", changedAt = round.createdAt;
  const events = new Set<string>();
  if (round.revisionId !== round.baseline.id || round.createdAt < round.baseline.createdAt
    || round.ownerPackageId !== undefined && round.ownerPackageId !== round.packageId
    || round.members.length !== round.baseline.members.length
    || round.members.some((binding, index) => binding.packageId !== round.packageId
      || binding.roundId !== round.id || binding.revisionId !== round.revisionId
      || binding.baselineDigest !== round.baselineDigest
      || binding.memberId !== round.baseline.members[index].id
      || binding.memberRevisionId !== round.baseline.members[index].revisionId
      || binding.assetDigest !== (round.baseline.members[index].kind === "native"
        ? round.baseline.members[index].draft.sha256 : round.baseline.members[index].original.sha256)))
    ctx.addIssue({ code: "custom", message: "Invalid exact package review binding." });
  for (const event of round.lifecycle?.events ?? []) {
    if (!(state === "active" && event.state !== "active" || state === "closed" && event.state === "active")
      || event.changedAt < changedAt || events.has(event.id)
      || (event.state === "superseded") !== !!event.replacementRoundId || event.replacementRoundId === round.id)
      ctx.addIssue({ code: "custom", message: "Invalid package review lifecycle." });
    state = event.state; changedAt = event.changedAt; events.add(event.id);
  }
});
export type PackageReviewRound = z.infer<typeof packageReviewRoundSchema>;
/** Portable/recovery normalization never turns source provenance into authority. */
export function packageReviewRevision(revision: PackageRevision): PackageRevision {
  const baseline = structuredClone(revision);
  for (const member of baseline.members) if (member.kind === "native" && member.source) member.source.local = false;
  return baseline;
}
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
    revisions: z.array(packageRevisionSchema).min(1).max(200),
    reviewRounds: z.array(packageReviewRoundSchema).max(100).optional(),
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
      memberRevisions = new Map<string, string>(),
      citationOwners = new Map<string, string>();
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
      for (const target of revision.citations?.targets ?? []) {
        const owner = `${target.kind}:${target.memberId}`;
        if (citationOwners.has(target.id) && citationOwners.get(target.id) !== owner)
          ctx.addIssue({ code: "custom", message: "A citation target identity changed owners." });
        citationOwners.set(target.id, owner);
      }
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
    const rounds = record.reviewRounds ?? [];
    if (new Set(rounds.map(round => round.id)).size !== rounds.length)
      ctx.addIssue({ code: "custom", message: "Duplicate package review round." });
    for (const round of rounds) {
      const revision = record.revisions.find(revision => revision.id === round.revisionId);
      if (round.packageId !== record.id || !revision
        || !sameReviewStoredValue(packageReviewRevision({ ...revision, outputs: revision.outputs.slice(0, round.baseline.outputs.length) }), round.baseline)
        || round.lifecycle?.events.some(event => event.replacementRoundId && !rounds.some(replacement =>
          replacement.id === event.replacementRoundId && replacement.createdAt > round.createdAt
          && replacement.ownerPackageId === round.ownerPackageId)))
        ctx.addIssue({ code: "custom", message: "The package review baseline or replacement is unavailable." });
    }
    if (!seen.has(record.currentRevisionId))
      ctx.addIssue({
        code: "custom",
        message: "Missing current package revision.",
      });
  });
export type ActionPackage = z.infer<typeof actionPackageSchema>;
export const newPackageId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID()}`;
function shortenPackageLabel(name: string, limit: number): string {
  const value = name.trim() || "Package member";
  if (value.length <= limit) return value;
  let clipped = "";
  for (const character of value) {
    if (clipped.length + character.length > limit - 1) break;
    clipped += character;
  }
  return `${clipped}…`;
}
/** Display labels are bounded independently of the preserved original filename. */
export function packageMemberLabel(name: string): string {
  return shortenPackageLabel(name, 120);
}
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
  const records = (await idbReadActionPackages()).map(value => actionPackageSchema.parse(value));
  const { validatePackageReviewBaselines } = await import("./packageReviewRounds");
  for (const record of records) await validatePackageReviewBaselines(record);
  return records;
}
export function packageAssets(record: ActionPackage): PackageAsset[] {
  return [...record.revisions, ...(record.reviewRounds ?? []).map(round => round.baseline)].flatMap((revision) => [
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
    [...record.revisions, ...(record.reviewRounds ?? []).map(round => round.baseline)].flatMap((revision) =>
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
  isCurrent: () => boolean = () => true,
): Promise<ActionPackage> {
  const after = actionPackageSchema.parse(structuredClone(value));
  const { validateActionPackageResources } = await import(
    "./actionPackageTransfer"
  );
  const { readPackageAsset } = await import("./actionPackageAssets");
  await validateActionPackageResources(after, readPackageAsset);
  signal?.throwIfAborted();
  if (!(await idbCompareActionPackage(before, after, () => !signal?.aborted && isCurrent())))
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
  citations: PackageCitations | undefined = getPackageRevision(record).citations,
  isCurrent: () => boolean = () => true,
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
    ...(citations ? { citations: structuredClone(citations) } : {}),
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
    isCurrent,
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
  name = `${shortenPackageLabel(record.name, 115)} copy`,
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
      reviewRounds: undefined,
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
  const oldRounds = before.reviewRounds ?? [], newRounds = after.reviewRounds ?? [];
  if (newRounds.length < oldRounds.length || newRounds.length > oldRounds.length + 1) return false;
  for (let index = 0; index < oldRounds.length; index++) {
    const prior = oldRounds[index], next = newRounds[index];
    if (!sameReviewStoredValue({ ...prior, lifecycle: undefined }, { ...next, lifecycle: undefined })) return false;
    const events = prior.lifecycle?.events ?? [], updated = next.lifecycle?.events ?? [];
    if (updated.length < events.length || updated.length > events.length + 1
      || !sameReviewStoredValue(events, updated.slice(0, events.length))) return false;
    if (updated.length !== events.length) {
      if (prior.ownerPackageId !== before.id) return false;
      const event = updated.at(-1)!;
      if (event.state === "superseded") {
        const replacement = newRounds.find(round => round.id === event.replacementRoundId);
        if (!replacement || replacement.ownerPackageId !== before.id
          || (replacement.lifecycle?.events.at(-1)?.state ?? "active") !== "active") return false;
      }
    }
  }
  if (newRounds.length > oldRounds.length && (before.archived || newRounds.at(-1)?.ownerPackageId !== before.id || newRounds.at(-1)?.lifecycle !== undefined)) return false;
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
