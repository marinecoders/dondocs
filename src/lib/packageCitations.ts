import type { ActionPackage, PackageMember, PackageRevision } from "./actionPackages";
import { getPackageRevision, newPackageId, reviseActionPackage } from "./actionPackages";
import { packageCitationsSchema, type PackageCitations, type PackageCitationSource, type PackageCitationTarget, type PackageCitationLink } from "./packageCitationSchema";
import { portableResourceDigest } from "./portableResources";
import { canTrackReferenceCitations, scanReferenceCitations, citationProtectedRanges } from "./referenceCitations";
import { enclosureStartNumber } from "./endorsement";
import { sameReviewStoredValue } from "./documentsDb";

export type CitationBindingState = "current" | "missing" | "stale";
export interface ResolvedPackageCitationTarget { target: PackageCitationTarget; state: CitationBindingState; label: string; citationLabel: string | null }
export interface ResolvedPackageCitationLink { link: PackageCitationLink; state: CitationBindingState; sourceState: CitationBindingState; labelMatches: boolean; label: string; target: ResolvedPackageCitationTarget }
export interface PackageCitationOccurrence { source: PackageCitationSource; label: string; literal: string }
export interface PackageCitationCandidate { target: Omit<Extract<PackageCitationTarget, { kind: "reference" }>, "id"> | Omit<Extract<PackageCitationTarget, { kind: "native-enclosure" }>, "id"> | Omit<Extract<PackageCitationTarget, { kind: "package-enclosure" }>, "id">; label: string; citationLabel: string }

export const packageCitationDigest = (value: unknown): Promise<string> => portableResourceDigest(new TextEncoder().encode(JSON.stringify(value)).buffer);
const textDigest = (value: string) => portableResourceDigest(new TextEncoder().encode(value).buffer);
const memberFingerprint = (member: PackageMember) => packageCitationDigest({ label: member.label, role: member.role, required: member.required, asset: member.kind === "native" ? member.draft.sha256 : member.original.sha256 });
const sameTarget = (left: Omit<PackageCitationTarget, "id">, right: Omit<PackageCitationTarget, "id">) => sameReviewStoredValue(left, right);
const withoutId = ({ id: _id, ...value }: PackageCitationTarget) => value;

/** IDs belong to the saved package revision, never to a library source or text match. */
export async function packageCitationCandidates(revision: PackageRevision): Promise<PackageCitationCandidate[]> {
  const candidates: PackageCitationCandidate[] = [];
  let enclosureNumber = 0;
  for (const member of revision.members) {
    if (member.role === "enclosure") candidates.push({ target: { kind: "package-enclosure", memberId: member.id, memberRevisionId: member.revisionId, itemSha256: await memberFingerprint(member) }, citationLabel: String(++enclosureNumber), label: `${member.label} · package enclosure (${enclosureNumber})` });
    if (member.kind !== "native" || !canTrackReferenceCitations(member.session)) continue;
    for (const [index, item] of member.session.references.entries()) candidates.push({ target: { kind: "reference", memberId: member.id, memberRevisionId: member.revisionId, index, itemSha256: await packageCitationDigest(item) }, citationLabel: item.letter, label: `${member.label} · reference (${item.letter}): ${item.title}` });
    const enclosureStart = enclosureStartNumber(member.session.docType, member.session.formData.startingEnclosureNumber);
    for (const [index, item] of member.session.enclosures.entries()) candidates.push({ target: { kind: "native-enclosure", memberId: member.id, memberRevisionId: member.revisionId, index, itemSha256: await packageCitationDigest(item) }, citationLabel: String(index + enclosureStart), label: `${member.label} · native enclosure (${index + enclosureStart}): ${item.title}` });
  }
  if (candidates.length > 1000) throw new Error("This package exceeds the 1,000 citation-target limit.");
  return candidates;
}


/** Package-enclosure labels count enclosure-role members only, in package order. */
export async function packageCitationTargetLabel(revision: PackageRevision, target: PackageCitationTarget): Promise<string | null> {
  return (await packageCitationCandidates(revision)).find(value => sameTarget(value.target, withoutId(target)))?.citationLabel ?? null;
}

/** Never split a surrogate pair when interpreting UTF-16 editor offsets. */
export function validCitationBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  return !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

export async function packageCitationOccurrences(revision: PackageRevision): Promise<PackageCitationOccurrence[]> {
  const result: PackageCitationOccurrence[] = [];
  for (const member of revision.members) {
    if (member.kind !== "native" || !canTrackReferenceCitations(member.session)) continue;
    const paragraphs = member.session.paragraphs;
    for (const [index, paragraph] of paragraphs.entries()) {
      if (!paragraph.id || paragraphs.filter(value => value.id === paragraph.id).length !== 1) continue;
      for (const field of ["text", "header"] as const) {
        const text = paragraph[field];
        if (!text || text.length > 2_000_000) continue;
        const ranges: Array<{ start: number; end: number; kind: "reference" | "enclosure" }> = scanReferenceCitations(text).citations.map(citation => ({ ...citation, kind: "reference" }));
        const protectedRanges = citationProtectedRanges(text);
        for (const match of text.matchAll(/\b(?:enclosures?|encls?\.?)\s*\(\s*(\d+)\s*\)/gi)) {
          const start = match.index + match[0].indexOf(match[1]);
          if (!protectedRanges.some(([from, to]) => match.index >= from && match.index < to)) ranges.push({ start, end: start + match[1].length, kind: "enclosure" });
        }
        if (!ranges.length) continue;
        const textSha256 = await textDigest(text);
        for (const range of ranges) {
          if (range.end - range.start > 20 || !validCitationBoundary(text, range.start) || !validCitationBoundary(text, range.end)) continue;
          if (result.length >= 2000) throw new Error("This package exceeds the 2,000 supported citation-occurrence limit.");
          result.push({ literal: text.slice(range.start, range.end), source: { memberId: member.id, memberRevisionId: member.revisionId, paragraphId: paragraph.id, field, kind: range.kind, start: range.start, end: range.end, textSha256, selectionSha256: await textDigest(text.slice(range.start, range.end)) }, label: `${member.label} · paragraph ${index + 1}${field === "header" ? " heading" : ""}: ${text.slice(Math.max(0, range.start - 35), Math.min(text.length, range.end + 35))}` });
        }
      }
    }
  }
  return result;
}

/** Missing/stale records stay visible; resolution never searches by duplicate title or text. */
export async function resolvePackageCitations(revision: PackageRevision): Promise<{ targets: ResolvedPackageCitationTarget[]; links: ResolvedPackageCitationLink[] }> {
  const metadata = revision.citations;
  if (!metadata) return { targets: [], links: [] };
  const candidates = await packageCitationCandidates(revision), occurrences = await packageCitationOccurrences(revision);
  const targets = metadata.targets.map(target => {
    const current = candidates.find(candidate => sameTarget(candidate.target, withoutId(target)));
    const state: CitationBindingState = current ? "current" : revision.members.some(member => member.id === target.memberId) ? "stale" : "missing";
    return { target, state, citationLabel: current?.citationLabel ?? null, label: current?.label ?? `${target.kind === "reference" ? "Reference" : "Enclosure"} target · ${state}` };
  });
  const links = metadata.links.map(link => {
    const target = targets.find(target => target.target.id === link.targetId)!;
    const current = occurrences.find(occurrence => sameReviewStoredValue(occurrence.source, link.source));
    const sourceState: CitationBindingState = current ? "current" : revision.members.some(member => member.id === link.source.memberId) ? "stale" : "missing";
    const labelMatches = !!current && target.citationLabel !== null && current.literal.toLowerCase() === target.citationLabel.toLowerCase();
    return { link, target, sourceState, labelMatches, label: current?.label ?? `Citation occurrence · ${sourceState}`, state: sourceState !== "current" ? sourceState : target.state !== "current" ? target.state : labelMatches ? "current" as const : "stale" as const };
  });
  return { targets, links };
}

export async function savePackageCitations(record: ActionPackage, citations: PackageCitations, signal?: AbortSignal): Promise<ActionPackage> {
  signal?.throwIfAborted();
  return reviseActionPackage(record, getPackageRevision(record).members, signal, packageCitationsSchema.parse(citations));
}

/** Explicit initialization creates a new revision; captured native and original bytes are unchanged. */
export async function initializePackageCitationTargets(record: ActionPackage, signal?: AbortSignal): Promise<ActionPackage> {
  const revision = getPackageRevision(record), candidates = await packageCitationCandidates(revision);
  const metadata: PackageCitations = structuredClone(revision.citations ?? { version: 1 as const, targets: [], links: [] });
  for (const candidate of candidates) if (!metadata.targets.some(target => sameTarget(withoutId(target), candidate.target))) metadata.targets.push({ ...candidate.target, id: newPackageId("citation-target") });
  signal?.throwIfAborted();
  if (metadata.targets.length === (revision.citations?.targets.length ?? 0)) throw new Error("All current references and enclosures already have identities.");
  return savePackageCitations(record, metadata, signal);
}

/** The submitted occurrence must still be exactly one supported current citation. */
export async function linkPackageCitation(record: ActionPackage, source: PackageCitationSource, targetId: string, signal?: AbortSignal): Promise<ActionPackage> {
  const revision = getPackageRevision(record), metadata = structuredClone(revision.citations);
  if (!metadata) throw new Error("Identify the package references and enclosures first.");
  const resolved = await resolvePackageCitations(revision), target = resolved.targets.find(value => value.target.id === targetId && value.state === "current");
  if (!target || (target.target.kind === "reference") !== (source.kind === "reference")) throw new Error("Choose a current target of the same citation kind.");
  const occurrence = (await packageCitationOccurrences(revision)).find(value => sameReviewStoredValue(value.source, source));
  if (!occurrence) throw new Error("The citation text changed. Review the current occurrence again.");
  if (target.target.kind !== "package-enclosure" && target.target.memberId !== source.memberId) throw new Error("Choose a reference or native enclosure from the citing member’s own list.");
  const label = await packageCitationTargetLabel(revision, target.target);
  if (label === null || occurrence.literal.toLowerCase() !== label.toLowerCase()) throw new Error("The citation label does not match the selected target. Correct the native draft text before linking it.");
  metadata.links.push({ id: newPackageId("citation-link"), source: structuredClone(source), targetId });
  return savePackageCitations(record, metadata, signal);
}
