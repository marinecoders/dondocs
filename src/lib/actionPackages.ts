import { packagePdfReviewSchema } from './packagePdfReviewModel';
import { packageFieldReviewApplicationSchema, packageFormReviewSchema } from './packageFormReviewModel';
import { packageSigningSchema, packageSigningAssets, MAX_PACKAGE_SIGNING_HISTORY_BYTES } from './packageSigningModel';
import { MAX_PACKAGE_WORK_HISTORY_BYTES, packageWorkSchema } from "./packageWorkModel";
import { MAX_PACKAGE_REQUIREMENTS_HISTORY_BYTES, packageRequirementsSchema } from "./packageRequirementsModel";
import { packageRoles } from "./packageRoles";
export { packageRoles } from "./packageRoles";
import { z } from "zod";
import { packageConsistencySchema, packageConsistencyRuleIdentity, MAX_PACKAGE_CONSISTENCY_HISTORY_BYTES } from './packageConsistencyModel';
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
import { MAX_CONDITIONAL_HISTORY_BYTES, packageConditionalStateSchema } from './packageConditionalState';
import { MAX_PACKAGE_INFORMATION_HISTORY_BYTES, packageInformationSchema } from "./packageInformation";

import { MAX_PACKAGE_BINDING_HISTORY_BYTES, packageFieldBindingsSchema } from "./packageFieldBindings";

import { supportsReviewComments } from "./reviewCommentTargets";
import { reviewRoundSchema } from "./reviewRounds";
import { reviewCommentsSchema } from "./reviewComments";
import { reviewSuggestionStateSchema, reviewSuggestionResolutionSchema } from "./reviewSuggestions";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

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
    information: packageInformationSchema.optional(),
    bindings: packageFieldBindingsSchema.optional(),
    templateState: packageConditionalStateSchema.optional(),
    requirements: packageRequirementsSchema.optional(),
    consistency: packageConsistencySchema.optional(),
    work: packageWorkSchema.optional(),
    signing: packageSigningSchema.optional(),
  })
  .strict();
export type PackageRevision = z.infer<typeof packageRevisionSchema>;
/** Package review authority is separate from native document ownership. */
export const packageReviewBindingSchema = z.object({
  packageId: id, roundId: id, revisionId: id, baselineDigest: digest,
  memberId: id, memberRevisionId: id, memberDigest: digest, assetDigest: digest,
}).strict();
export type PackageReviewBinding = z.infer<typeof packageReviewBindingSchema>;
/** Package drafts own their embedded bytes; this adapter never resolves device-local handles.
 * safeExtend keeps every native round timestamp and metadata refinement intact.
 */
export const packageNativeReviewRoundSchema = reviewRoundSchema.safeExtend({
  baseline: reviewRoundSchema.shape.baseline.safeExtend({
    session: nativeSchema.shape.session.refine(session => supportsReviewComments(session),
      "Package native review supports correspondence only.").refine(session =>
      !!session.formData && Array.isArray(session.enclosures) && Array.isArray(session.paragraphs)
      && !session.formData.basicLetterFileRef && !session.formData.signatureImage?.fileRef
      && !session.formData.wordSource?.fileRef
      && !session.enclosures.some(enclosure => enclosure.fileRef)
      && !session.paragraphs.some(paragraph => paragraph.figure?.fileRef)
      && ![session.forms?.navmc10274, session.forms?.navmc11811].some(form =>
        form?.signatureBlocks.some(block => block.imageRef)),
    "Package review baselines cannot resolve device-local file handles."),
  }),
  ownerDocumentId: z.never().optional(),
  lifecycle: z.never().optional(),
  checkpoints: z.never().optional(),
});
export const packageMemberReviewSchema = z.object({
  binding: packageReviewBindingSchema,
  nativeRound: packageNativeReviewRoundSchema.optional(),
  fieldReview: packageFormReviewSchema.optional(),
  pdfReview: packagePdfReviewSchema.optional(),
  comments: reviewCommentsSchema,
  suggestions: reviewSuggestionStateSchema.optional(),
}).strict();
export type PackageMemberReview = z.infer<typeof packageMemberReviewSchema>;
export const packageReviewRoundSchema = z.object({
  kind: z.literal("dondocs-package-review-round"), version: z.literal(1),
  id, packageId: id, revisionId: id, label: z.string().trim().min(1).max(120),
  createdAt: z.number().int().nonnegative(), baselineDigest: digest,
  // Captured again because output may be appended to a saved revision later.
  // This also remains a GC/backup root if history pruning is added in future.
  baseline: packageRevisionSchema,
  members: z.array(packageReviewBindingSchema).max(100),
  memberReviews: z.array(packageMemberReviewSchema).max(100).optional(),
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
  const children = new Set<string>();
  for (const child of round.memberReviews ?? []) {
    const member = round.baseline.members.find(member => member.id === child.binding.memberId);
    const binding = round.members.find(binding => binding.memberId === child.binding.memberId);
    if (child.pdfReview && member?.kind !== 'original') ctx.addIssue({ code: 'custom', message: 'PDF region feedback requires an original PDF member.' });
    if (child.fieldReview && (member?.kind !== 'native' || member.session.documentCategory !== 'forms'))
      ctx.addIssue({ code: 'custom', message: 'Field feedback requires a captured form member.' });
    if (!member || children.has(child.binding.memberId) || !sameReviewStoredValue(binding, child.binding)
      || member.kind === "native" && supportsReviewComments(member.session) && (!child.nativeRound || !child.suggestions
        || child.nativeRound.ownerDocumentId !== undefined || child.nativeRound.lifecycle !== undefined
        || child.nativeRound.checkpoints !== undefined || child.nativeRound.sourceDocumentId !== member.id
        || child.nativeRound.label !== member.label
        || !sameReviewStoredValue(child.nativeRound.baseline, { ts: member.session.timestamp, session: member.session })
        || child.suggestions.roundId !== child.nativeRound.id || child.suggestions.baselineDigest !== child.nativeRound.baselineDigest
        || child.suggestions.decisions.length !== 0)
      || (member.kind === "original" || !supportsReviewComments(member.session)) && (child.nativeRound !== undefined || child.suggestions !== undefined
        || child.comments.threads.some(thread => thread.anchor.kind !== "document")))
      ctx.addIssue({ code: "custom", message: "Invalid package member review association." });
    children.add(child.binding.memberId);
  }
  if (new TextEncoder().encode(JSON.stringify(round.memberReviews ?? [])).byteLength > 2 * 1024 * 1024)
    ctx.addIssue({ code: "custom", message: "Package feedback exceeds the combined 2 MB limit." });
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
export const packageFeedbackChoiceSchema = z.object({
  member: z.enum(['current', 'restore-reviewed']).optional(),
  comments: z.enum(['merge', 'skip']).optional(),
  commentConflicts: z.record(z.string().min(1).max(300), z.enum(['current', 'returned'])).optional(),
  proposals: z.record(z.string().min(1).max(100), z.object({ action: z.enum(['accepted', 'rejected', 'keep']),
    resolutions: z.array(reviewSuggestionResolutionSchema).max(20).optional() }).strict()).optional(),
}).strict();
export const packageReviewApplicationSchema = z.object({
  id, roundId: id, baselineDigest: digest, returnId: id, returnDigest: digest,
  createdAt: z.number().int().nonnegative(), revisionId: id,
  feedback: z.array(packageMemberReviewSchema).max(100),
  outcomes: z.array(z.object({ memberId: id, choice: packageFeedbackChoiceSchema,
    comments: reviewCommentsSchema.optional(), suggestions: reviewSuggestionStateSchema.optional() }).strict()).max(100),
}).strict();
export type PackageReviewApplication = z.infer<typeof packageReviewApplicationSchema>;
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
    reviewApplications: z.array(packageReviewApplicationSchema).max(500).optional(),
    fieldReviewApplications: z.array(packageFieldReviewApplicationSchema).max(500).optional(),
    workingCopies: z
      .array(
        z.object({ memberId: id, documentId: id, revisionId: id }).strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    let informationBytes = 0, bindingBytes = 0, conditionalBytes = 0, requirementBytes = 0, consistencyBytes = 0, workBytes = 0, signingBytes = 0;
    for (const revision of [...record.revisions, ...(record.reviewRounds ?? []).map(round => round.baseline)]) {
      if (revision.signing) {
        signingBytes += new TextEncoder().encode(JSON.stringify(revision.signing)).byteLength;
        if (revision.signing.handoffs.some(item => item.packageId !== record.id)) ctx.addIssue({ code: 'custom', message: 'A signing handoff belongs to a different package.' });
      }
      if (signingBytes > MAX_PACKAGE_SIGNING_HISTORY_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'Retained package signing metadata exceeds the combined 8 MB limit.' }); break;
      }
      if (revision.consistency) consistencyBytes += new TextEncoder().encode(JSON.stringify(revision.consistency)).byteLength;
      if (consistencyBytes > MAX_PACKAGE_CONSISTENCY_HISTORY_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'Retained package consistency declarations exceed the combined 8 MB limit.' }); break;
      }
      if (revision.work) workBytes += new TextEncoder().encode(JSON.stringify(revision.work)).byteLength;
      if (workBytes > MAX_PACKAGE_WORK_HISTORY_BYTES) {
        ctx.addIssue({ code: "custom", message: "Retained package work exceeds the combined 8 MB limit." }); break;
      }
      if (revision.templateState) conditionalBytes += new TextEncoder().encode(JSON.stringify(revision.templateState)).byteLength;
      if (conditionalBytes > MAX_CONDITIONAL_HISTORY_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'Retained conditional intake exceeds the combined 16 MB limit.' }); break;
      }
      if (revision.requirements) requirementBytes += new TextEncoder().encode(JSON.stringify(revision.requirements)).byteLength;
      if (requirementBytes > MAX_PACKAGE_REQUIREMENTS_HISTORY_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'Retained package requirements exceed the combined 8 MB limit.' }); break;
      }
      if (revision.bindings) bindingBytes += new TextEncoder().encode(JSON.stringify(revision.bindings)).byteLength;
      if (bindingBytes > MAX_PACKAGE_BINDING_HISTORY_BYTES) {
        ctx.addIssue({ code: "custom", message: "Retained package field links exceed the combined 8 MB limit." });
        break;
      }
      if (revision.information) informationBytes += new TextEncoder().encode(JSON.stringify(revision.information)).byteLength;
      if (informationBytes > MAX_PACKAGE_INFORMATION_HISTORY_BYTES) {
        ctx.addIssue({ code: "custom", message: "Retained package information exceeds the combined 8 MB limit." });
        break;
      }
    }
    const seen = new Set<string>(),
      memberRevisions = new Map<string, string>(),
      citationOwners = new Map<string, string>(),
      informationFacts = new Map<string, string>(),
      informationParticipants = new Map<string, string>(), requirementIdentities = new Map<string, string>(), consistencyIdentities = new Map<string, string>(), signingIdentities = new Map<string, string>(), signingReturnIdentities = new Map<string, string>();
    for (const [index, revision] of record.revisions.entries()) {
      for (const handoff of revision.signing?.handoffs ?? []) {
        const source = record.revisions.find(item => item.id === handoff.sourceRevisionId);
        if (record.historyScope !== 'selected-revision' && !source) ctx.addIssue({ code: 'custom', message: 'The captured signing source revision is unavailable.' });
        if (source) {
          const target = handoff.target;
          const member = target.kind === 'member' ? source.members.find(item => item.id === target.id && item.revisionId === target.revisionId) : undefined;
          const asset = target.kind === 'output' ? source.outputs.find(item => item.id === target.id)?.asset : member?.kind === 'original' && !member.signedOriginal ? member.original : undefined;
          if (!sameReviewStoredValue(asset, handoff.pdfs.source)) ctx.addIssue({ code: 'custom', message: 'The exact signing source does not match its captured revision.' });
        }
        for (const returned of handoff.returns ?? []) {
          const prior = signingReturnIdentities.get(returned.id), value = JSON.stringify(returned);
          if (prior !== undefined && prior !== value) ctx.addIssue({ code: 'custom', message: 'An exact signing return changed under its saved identity.' });
          signingReturnIdentities.set(returned.id, value);
          const applied = record.revisions.find(item => item.id === returned.appliedRevisionId);
          if (record.historyScope !== 'selected-revision' && !applied) ctx.addIssue({ code: 'custom', message: 'The signing return application revision is unavailable.' });
          if (applied) {
            const member = applied.members.find(item => item.id === returned.memberId);
            if (member?.kind !== 'original' || !member.signedOriginal || !sameReviewStoredValue(member.original, returned.returnedAsset))
              ctx.addIssue({ code: 'custom', message: 'The preserved returned PDF does not match its application revision.' });
          }
        }
        const identity = JSON.stringify({ ...handoff, returns: undefined }), previous = signingIdentities.get(handoff.id);
        if (previous !== undefined && previous !== identity) ctx.addIssue({ code: 'custom', message: 'An exact signing handoff changed under its saved identity.' });
        signingIdentities.set(handoff.id, identity);
      }
      for (const rule of revision.consistency?.rules ?? []) {
        const identity = packageConsistencyRuleIdentity(rule), prior = consistencyIdentities.get(rule.id);
        if (prior !== undefined && prior !== identity) ctx.addIssue({ code: 'custom', message: 'A consistency relationship identity changed its values, relation or person.' });
        consistencyIdentities.set(rule.id, identity);
      }
      for (const requirement of revision.requirements?.items ?? []) {
        const identity = JSON.stringify([requirement.kind, requirement.definitionId, requirement.participantId]);
        const prior = requirementIdentities.get(requirement.id);
        if (prior !== undefined && prior !== identity) ctx.addIssue({ code: "custom", message: "A requirement identity changed its kind, definition or person." });
        requirementIdentities.set(requirement.id, identity);
      }
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
      for (const participant of revision.information?.participants ?? []) {
        const prior = informationParticipants.get(participant.id);
        if (prior !== undefined && prior !== participant.role)
          ctx.addIssue({ code: "custom", message: "A package participant identity changed roles. Create a new participant identity." });
        informationParticipants.set(participant.id, participant.role);
      }
      for (const fact of revision.information?.facts ?? []) {
        const owner = JSON.stringify([fact.kind, fact.participantId ?? null]);
        if (informationFacts.has(fact.id) && informationFacts.get(fact.id) !== owner)
          ctx.addIssue({ code: "custom", message: "A package fact identity changed type or participant. Create a new fact identity." });
        informationFacts.set(fact.id, owner);
      }
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
    const fieldApplications = record.fieldReviewApplications ?? [];
    if (new TextEncoder().encode(JSON.stringify(fieldApplications)).byteLength > 4 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: 'Retained form decisions exceed the combined 4 MB limit.' });
    const fieldIds = new Set<string>(), undone = new Set<string>(), fieldDecisions = new Set<string>();
    for (const application of fieldApplications) {
      const round = rounds.find(round => round.id === application.roundId);
      const target = fieldApplications.find(prior => prior.id === application.undoOf);
      const decisionKey = JSON.stringify([application.roundId, application.memberId, application.proposal.id]);
      if (application.action !== 'undo' && fieldDecisions.has(decisionKey)) ctx.addIssue({ code: 'custom', message: 'A form proposal already has a retained decision.' });
      if (application.action === 'undo') fieldDecisions.delete(decisionKey); else fieldDecisions.add(decisionKey);
      if (fieldIds.has(application.id) || !round || round.ownerPackageId !== record.id
        || !round.members.some(member => member.memberId === application.memberId)
        || !seen.has(application.beforeRevisionId) || !seen.has(application.revisionId)
        || application.createdAt < round.createdAt
        || application.action === 'undo' && (!target || !fieldIds.has(target.id) || target.action === 'undo' || undone.has(target.id)
          || target.roundId !== application.roundId || target.memberId !== application.memberId || !sameReviewStoredValue(target.proposal, application.proposal)))
        ctx.addIssue({ code: 'custom', message: 'Invalid exact form decision history.' });
      fieldIds.add(application.id); if (application.undoOf) undone.add(application.undoOf);
    }
    const applications = record.reviewApplications ?? [];
    if (new TextEncoder().encode(JSON.stringify(applications)).byteLength > 4 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: 'Retained package application metadata exceeds the 4 MB limit. Start a new package for further review.' });
    if (new Set(applications.map(item => item.id)).size !== applications.length
      || new Set(applications.map(item => item.returnId)).size !== applications.length
      || new Set(applications.map(item => item.revisionId)).size !== applications.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate package feedback application.' });
    for (const application of applications) {
      const round = rounds.find(round => round.id === application.roundId);
      const memberIds = application.feedback.map(child => child.binding.memberId);
      if (!round || round.ownerPackageId !== record.id || round.baselineDigest !== application.baselineDigest
        || application.createdAt < round.createdAt || !seen.has(application.revisionId)
        || new Set(memberIds).size !== memberIds.length || application.outcomes.length !== memberIds.length
        || new Set(application.outcomes.map(item => item.memberId)).size !== memberIds.length
        || application.outcomes.some(item => !memberIds.includes(item.memberId))
        || application.feedback.some(child => !round.members.some(binding => sameReviewStoredValue(binding, child.binding))))
        ctx.addIssue({ code: 'custom', message: 'Invalid package application owner, baseline or member binding.' });
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
    ...(revision.templateState ? [revision.templateState.source] : []),
    ...(revision.signing ? packageSigningAssets(revision.signing) : []),
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
  stagedAttachments: readonly import("./documentsDb").StoredAttachment[] = [],
): Promise<ActionPackage> {
  const after = actionPackageSchema.parse(structuredClone(value));
  const { validateActionPackageResources } = await import(
    "./actionPackageTransfer"
  );
  const { readPackageAsset } = await import("./actionPackageAssets");
  const staged = new Map(stagedAttachments.map(asset => [asset.id, asset]));
  await validateActionPackageResources(after, async asset => staged.get(asset.id)?.data ?? readPackageAsset(asset));
  signal?.throwIfAborted();
  if (!(await idbCompareActionPackage(before, after, () => !signal?.aborted && isCurrent(), stagedAttachments)))
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
  const current = getPackageRevision(record);
  const revision: PackageRevision = {
    id: newPackageId("revision"),
    parentId: record.currentRevisionId,
    createdAt: Date.now(),
    members: structuredClone(members).map((member) => {
      const prior = current.members.find(
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
    ...(current.bindings ? { bindings: current.bindings } : {}),
    ...(current.templateState ? { templateState: current.templateState } : {}),
    ...(current.information ? { information: current.information } : {}),
    ...(current.requirements ? { requirements: current.requirements } : {}),
    ...(current.consistency ? { consistency: current.consistency } : {}),
    ...(current.work ? { work: current.work } : {}),
    ...(current.signing ? { signing: current.signing } : {}),
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
      revisions: record.revisions.map(revision => { const copy = structuredClone(revision); delete copy.signing; return copy; }),
      reviewRounds: undefined,
      reviewApplications: undefined,
      fieldReviewApplications: undefined,
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
  const previousFields = before.fieldReviewApplications ?? [], fields = after.fieldReviewApplications ?? [];
  if (fields.length < previousFields.length || fields.length > previousFields.length + 1
    || !sameReviewStoredValue(previousFields, fields.slice(0, previousFields.length))) return false;
  if (fields.length > previousFields.length) {
    const receipt = fields.at(-1)!, round = before.reviewRounds?.find(round => round.id === receipt.roundId);
    if (before.archived || !round || round.ownerPackageId !== before.id
      || (round.lifecycle?.events.at(-1)?.state ?? 'active') !== 'active'
      || receipt.beforeRevisionId !== before.currentRevisionId || receipt.revisionId !== after.currentRevisionId
      || after.revisions.length !== before.revisions.length + 1 || !sameReviewStoredValue(before.reviewRounds, after.reviewRounds)) return false;
  }
  const previousApplications = before.reviewApplications ?? [], applications = after.reviewApplications ?? [];
  if (applications.length < previousApplications.length || applications.length > previousApplications.length + 1
    || !sameReviewStoredValue(previousApplications, applications.slice(0, previousApplications.length))) return false;
  if (applications.length > previousApplications.length) {
    const application = applications.at(-1)!, round = before.reviewRounds?.find(item => item.id === application.roundId);
    if (before.archived || !round || round.ownerPackageId !== before.id
      || (round.lifecycle?.events.at(-1)?.state ?? 'active') !== 'active'
      || application.revisionId !== after.currentRevisionId || after.revisions.length !== before.revisions.length + 1
      || !sameReviewStoredValue(before.reviewRounds, after.reviewRounds)) return false;
  }
  const oldRounds = before.reviewRounds ?? [], newRounds = after.reviewRounds ?? [];
  if (oldRounds.some(round => round.ownerPackageId === undefined) && (newRounds.length !== oldRounds.length
    || !sameReviewStoredValue({ ...before, sequence: 0, reviewRounds: undefined }, { ...after, sequence: 0, reviewRounds: undefined }))) return false;
  if (newRounds.length < oldRounds.length || newRounds.length > oldRounds.length + 1) return false;
  for (let index = 0; index < oldRounds.length; index++) {
    const prior = oldRounds[index], next = newRounds[index];
    if (!sameReviewStoredValue({ ...prior, lifecycle: undefined, memberReviews: undefined }, { ...next, lifecycle: undefined, memberReviews: undefined })) return false;
    const children = prior.memberReviews ?? [];
    const changedChildren = !sameReviewStoredValue(children, next.memberReviews ?? []);
    if (changedChildren && (before.archived || (prior.lifecycle?.events.at(-1)?.state ?? "active") !== "active")) return false;
    for (const child of children) {
      const changed = next.memberReviews?.find(value => value.binding.memberId === child.binding.memberId);
      if (!changed || !sameReviewStoredValue({ ...child, comments: undefined, suggestions: undefined, fieldReview: undefined, pdfReview: undefined },
        { ...changed, comments: undefined, suggestions: undefined, fieldReview: undefined, pdfReview: undefined })) return false;
      for (const previous of [...child.fieldReview?.comments ?? [], ...child.pdfReview?.comments ?? []]) {
        const nextComment = [...changed.fieldReview?.comments ?? [], ...changed.pdfReview?.comments ?? []].find(comment => comment.id === previous.id);
        if (nextComment && !sameReviewStoredValue(previous.anchor, nextComment.anchor)) return false;
      }
      const formProposals = child.fieldReview?.proposals ?? [], incomingForm = changed.fieldReview?.proposals ?? [];
      if (incomingForm.length < formProposals.length || !sameReviewStoredValue(formProposals, incomingForm.slice(0, formProposals.length))) return false;
      const proposals = child.suggestions?.proposals ?? [], incoming = changed.suggestions?.proposals ?? [];
      if (incoming.length < proposals.length || !sameReviewStoredValue(proposals, incoming.slice(0, proposals.length))) return false;
    }
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
