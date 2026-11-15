import type { SerializedSession } from "@/stores/documentStore";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import { assertExportDeploymentPolicy } from "./exportDeploymentPolicy";
import { getPackageRevision, newPackageId, type ActionPackage, type PackageMember, type PackageRevision } from "./actionPackages";
import { sameReviewStoredValue } from "./documentsDb";
import { packageCitationsSchema, type PackageCitations, type PackageCitationSource, type PackageCitationTarget } from "./packageCitationSchema";
import { packageCitationCandidates, packageCitationOccurrences, resolvePackageCitations, type PackageCitationCandidate } from "./packageCitations";
import { commitPackageCitationRevision } from "./packageCitationRevision";

export type PackageCitationRepairAction =
  | { kind: "relink"; linkId: string; source: PackageCitationSource; target: PackageCitationCandidate["target"] }
  | { kind: "discard-link"; linkId: string }
  | { kind: "remove-target"; targetId: string };
export interface PreparedPackageCitationRepair {
  readonly revisionId: string;
  readonly explanation: string;
  readonly before: string;
  readonly after: string;
  readonly changesText: boolean;
  readonly discardsLink: boolean;
}
interface RepairCapture {
  record: ActionPackage;
  policy: PolicyResolution;
  sessions: Map<string, SerializedSession>;
  metadata(members: PackageMember[]): Promise<PackageCitations>;
}
const captures = new WeakMap<PreparedPackageCitationRepair, RepairCapture>();
const withoutId = <T extends { id: string }>({ id: _id, ...value }: T) => value;
const sameLocation = (left: PackageCitationSource, right: PackageCitationSource) => left.memberId === right.memberId
  && left.paragraphId === right.paragraphId && left.field === right.field && left.start === right.start && left.end === right.end;
const candidateLocation = (left: PackageCitationCandidate["target"], right: PackageCitationTarget) =>
  left.kind === right.kind && left.memberId === right.memberId
  && (left.kind === "package-enclosure" || right.kind !== "package-enclosure" && left.index === right.index);

export function packageCitationSourceLocation(revision: PackageRevision, source: PackageCitationSource): string {
  const member = revision.members.find(member => member.id === source.memberId);
  const index = member?.kind === "native" ? member.session.paragraphs.findIndex(paragraph => paragraph.id === source.paragraphId) : -1;
  return `${member?.label ?? "Missing citing member"}${index >= 0 ? ` · paragraph ${index + 1}${source.field === "header" ? " heading" : ""}` : " · missing paragraph"}`;
}

/** A repair is an explicit choice, never a search for matching old text or title. */
export async function preparePackageCitationRepair(
  input: ActionPackage,
  action: PackageCitationRepairAction,
  policy: PolicyResolution,
  signal?: AbortSignal,
): Promise<PreparedPackageCitationRepair> {
  signal?.throwIfAborted();
  action = structuredClone(action);
  if (policy.status !== "ready") throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  if (input.archived) throw new Error("Reopen the archived package before repairing citations.");
  const record = structuredClone(input), revision = getPackageRevision(record);
  const metadata = packageCitationsSchema.parse(revision.citations);
  const sessions = new Map<string, SerializedSession>();
  const resolved = await resolvePackageCitations(revision);
  let explanation: string, before: string, after: string;
  let edited: { source: PackageCitationSource; replacement: string } | undefined;
  if (action.kind === "remove-target") {
    const target = resolved.targets.find(value => value.target.id === action.targetId);
    if (!target) throw new Error("Select an identified target from this revision.");
    if (metadata.links.some(link => link.targetId === action.targetId)) throw new Error("Repair or discard every linked citation before removing its target.");
    metadata.targets = metadata.targets.filter(value => value.id !== action.targetId);
    explanation = "Remove an unused citation identity. Document text and original files remain unchanged.";
    before = target.label; after = "Unused identity removed";
  } else {
    const oldLink = resolved.links.find(value => value.link.id === action.linkId);
    if (!oldLink) throw new Error("Select a linked citation from this revision.");
    before = `${packageCitationSourceLocation(revision, oldLink.link.source)} · ${oldLink.label} → ${oldLink.target.label}`;
    if (action.kind === "discard-link") {
      metadata.links = metadata.links.filter(value => value.id !== action.linkId);
      explanation = "Discard this link only. Its text stays literal and requires manual citation review; this does not verify or correct that text.";
      after = "Link discarded; literal text unchanged";
    } else {
      const occurrences = await packageCitationOccurrences(revision);
      const occurrence = occurrences.find(value => sameReviewStoredValue(value.source, action.source));
      const candidate = (await packageCitationCandidates(revision)).find(value => sameReviewStoredValue(value.target, action.target));
      if (!occurrence) throw new Error("Choose an exact supported occurrence from the current revision.");
      if (occurrence.source.kind !== oldLink.link.source.kind) throw new Error("Choose an occurrence of the same citation kind as the link being repaired.");
      if (!candidate || (candidate.target.kind === "reference") !== (occurrence.source.kind === "reference")) throw new Error("Choose a current target of the same citation kind.");
      if (candidate.target.kind !== "package-enclosure" && candidate.target.memberId !== occurrence.source.memberId)
        throw new Error("Choose a reference or native enclosure from the citing member’s own list.");
      if (metadata.links.some(link => link.id !== action.linkId && sameLocation(link.source, occurrence.source))) throw new Error("That occurrence already has a link. Repair it separately.");
      const member = revision.members.find(value => value.id === occurrence.source.memberId);
      if (!member || member.kind !== "native") throw new Error("The citing native member is unavailable.");
      const replacement = occurrence.source.kind === "reference" && occurrence.literal === occurrence.literal.toUpperCase()
        ? candidate.citationLabel.toUpperCase() : candidate.citationLabel;
      if (replacement !== occurrence.literal) {
        const session = structuredClone(member.session), paragraph = session.paragraphs.find(value => value.id === occurrence.source.paragraphId)!;
        const text = paragraph[occurrence.source.field]!;
        paragraph[occurrence.source.field] = text.slice(0, occurrence.source.start) + replacement + text.slice(occurrence.source.end);
        sessions.set(member.id, session);
        edited = { source: occurrence.source, replacement };
      }
      let target = metadata.targets.find(value => sameReviewStoredValue(withoutId(value), candidate.target));
      if (!target) { target = { ...candidate.target, id: newPackageId("citation-target") }; metadata.targets.push(target); }
      const selected = metadata.links.find(value => value.id === action.linkId)!;
      selected.source = structuredClone(occurrence.source); selected.targetId = target.id;
      explanation = "Attach this link to the selected current occurrence and target. Only the displayed citation label may change; saving creates a new package revision.";
      after = `${occurrence.label} → ${candidate.label}${replacement !== occurrence.literal ? ` · label ${occurrence.literal} → ${replacement}` : ""}`;
    }
  }
  signal?.throwIfAborted();
  const prepared = Object.freeze({ revisionId: revision.id, explanation, before, after,
    changesText: sessions.size > 0, discardsLink: action.kind === "discard-link" });
  captures.set(prepared, { record, policy, sessions, metadata: members => rebindMetadata(revision, members, metadata, resolved, edited) });
  return prepared;
}

async function rebindMetadata(
  revision: PackageRevision,
  members: PackageMember[],
  metadata: PackageCitations,
  resolved: Awaited<ReturnType<typeof resolvePackageCitations>>,
  edited?: { source: PackageCitationSource; replacement: string },
): Promise<PackageCitations> {
  if (!edited) return structuredClone(metadata);
  const next: PackageRevision = { ...revision, members, citations: metadata };
  const result = structuredClone(metadata), candidates = await packageCitationCandidates(next);
  const occurrences = await packageCitationOccurrences(next);
  for (const target of result.targets) {
    if (target.memberId !== edited.source.memberId) continue;
    const old = resolved.targets.find(value => value.target.id === target.id);
    // Existing stale identities remain stale; a new target was explicitly chosen.
    if (old && old.state !== "current") continue;
    const candidate = candidates.find(value => candidateLocation(value.target, target));
    if (!candidate) throw new Error("The repair could not retain the target identity. No package changes were saved.");
    Object.assign(target, candidate.target);
  }
  const delta = edited.replacement.length - (edited.source.end - edited.source.start);
  for (const link of result.links) {
    if (link.source.memberId !== edited.source.memberId) continue;
    const old = resolved.links.find(value => value.link.id === link.id);
    const selected = sameLocation(link.source, edited.source);
    if (!selected && old?.sourceState !== "current") continue;
    let { start, end } = link.source;
    if (link.source.paragraphId === edited.source.paragraphId && link.source.field === edited.source.field) {
      if (selected) end = start + edited.replacement.length;
      else if (start >= edited.source.end) { start += delta; end += delta; }
      else if (end > edited.source.start) throw new Error("The repair overlaps another linked citation. Resolve it explicitly before saving.");
    }
    const occurrence = occurrences.find(value => sameLocation(value.source, { ...link.source, start, end }));
    if (!occurrence || occurrence.source.kind !== link.source.kind) throw new Error("The repair could not retain another citation’s exact location. No package changes were saved.");
    link.source = occurrence.source;
  }
  return packageCitationsSchema.parse(result);
}

/** The writer revalidates policy, ownership and package sequence at the final CAS. */
export async function applyPackageCitationRepair(prepared: PreparedPackageCitationRepair, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const captured = captures.get(prepared);
  if (!captured) throw new Error("Review this citation repair again before saving.");
  return commitPackageCitationRevision(captured.record, getPackageRevision(captured.record).members.map(member => member.id), captured.sessions,
    revision => captured.metadata(revision.members), captured.policy, signal, isCurrent);
}

/** Tracked broken links block assembly; unrelated unlinked text remains a manual check. */
export async function packageCitationReadiness(revision: PackageRevision): Promise<Array<{ memberId?: string; message: string; severity: "error" | "warning" }>> {
  if (!revision.citations) return [];
  const resolved = await resolvePackageCitations(revision);
  const findings: Awaited<ReturnType<typeof packageCitationReadiness>> = [];
  for (const value of resolved.links) {
    if (value.state === "current") continue;
    const location = packageCitationSourceLocation(revision, value.link.source);
    const reason = value.sourceState !== "current" ? "the cited text changed or is missing"
      : value.target.state !== "current" ? "the target changed or is missing" : "the visible label no longer matches its target";
    findings.push({ memberId: value.link.source.memberId, severity: "error", message: `${location}: repair linked citation because ${reason}. Open citation repair before assembling.` });
  }
  findings.push({ severity: "warning", message: "Linked citation checks cover only explicitly linked occurrences. Unlinked literal citations still require manual review." });
  return findings;
}
