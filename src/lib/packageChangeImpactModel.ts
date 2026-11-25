import type { PackageMember, PackageRevision } from './actionPackages';
import { sameReviewStoredValue } from './documentsDb';

export type PackageImpactState = 'added' | 'removed' | 'changed' | 'moved' | 'metadata-only' | 'renumbered' | 'unchanged' | 'unknown' | 'unavailable';
export type PackageImpactKind = 'member' | 'fact' | 'participant' | 'binding' | 'requirement' | 'citation' | 'intake' | 'consistency' | 'workflow' | 'output' | 'review' | 'signing';
export interface PackageImpactDestination {
  revisionId?: string;
  memberId?: string; factId?: string; bindingId?: string; requirementId?: string;
  citationId?: string; outputId?: string; reviewRoundId?: string; signingId?: string;
}
export interface PackageImpactItem {
  id: string;
  label: string;
  state: PackageImpactState;
  message: string;
  destinations: PackageImpactDestination[];
  beforePosition?: number;
  afterPosition?: number;
  capturedRevisionId?: string;
  association?: 'exact' | 'historical' | 'unknown';
  availability?: 'not-checked' | 'verified' | 'unavailable';
  affectedMemberIds?: string[];
  movedMemberIds?: string[];
}
export interface PackageImpactSection { kind: PackageImpactKind; label: string; items: PackageImpactItem[] }
export interface PackageChangeImpact {
  version: 1;
  beforeRevisionId: string;
  afterRevisionId: string;
  changed: boolean;
  limited: boolean;
  sections: PackageImpactSection[];
  summary: { changedMembers: number; movedMembers: number; changedFacts: number; affectedOutputs: number; affectedReviews: number; unknownEvidence: number };
  notices: string[];
}

/** Newer revision metadata remains outside the rendering comparison. */
export type ImpactRevision = PackageRevision & { work?: unknown };
export const impactChanged = (item: PackageImpactItem): boolean => !['unchanged', 'unknown', 'unavailable'].includes(item.state);
export const sameImpactValue = sameReviewStoredValue;

/** Retained disclosure metadata matters without treating device-local handles as document edits. */
export function packageMemberInputs(member: PackageMember) {
  const asset = ({ name, type, size, sha256 }: { name: string; type: string; size: number; sha256: string }) => ({ name, type, size, sha256 });
  return { kind: member.kind, label: member.label, role: member.role, required: member.required,
    ...(member.kind !== 'native' ? { original: asset(member.original), signedOriginal: member.signedOriginal,
      ...(member.kind === 'original' && member.printableCopy && { printableCopy: asset(member.printableCopy.asset) }) }
      : { draft: asset(member.draft), source: member.source && { documentId: member.source.documentId, capturedAt: member.source.capturedAt, editSequence: member.source.editSequence },
        templates: Object.entries(member.templates ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([file, value]) => [file, asset(value)]) }) };
}
export function packageMemberContent(member: PackageMember) {
  return member.kind !== 'native' ? { kind: member.kind, sha256: member.original.sha256, ...(member.kind === 'original' && member.printableCopy && { printableSha256: member.printableCopy.asset.sha256 }) }
    : { kind: member.kind, sha256: member.draft.sha256, templates: Object.entries(member.templates ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([file, asset]) => [file, asset.sha256]) };
}
export function packageAssemblyInputs(revision: PackageRevision) {
  return { assembly: revision.assembly, members: revision.members.map(member => ({ id: member.id, role: member.role, boundaryLabel: !['basic-letter', 'endorsement', 'enclosure'].includes(member.role) ? member.label : undefined, ...packageMemberContent(member) })) };
}
/** Reviewers receive the package context too; task ownership does not change their captured documents. */
export function packageReviewContext(revision: ImpactRevision) {
  const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return { memberContext: sorted(revision.members).map(member => ({ id: member.id, ...packageMemberInputs(member) })), information: revision.information && { ...revision.information, facts: sorted(revision.information.facts), participants: sorted(revision.information.participants) },
    bindings: revision.bindings && { ...revision.bindings, items: sorted(revision.bindings.items) },
    requirements: revision.requirements && { ...revision.requirements, items: sorted(revision.requirements.items) },
    citations: revision.citations && { ...revision.citations, targets: sorted(revision.citations.targets), links: sorted(revision.citations.links) },
    templateState: revision.templateState, consistency: revision.consistency && { ...revision.consistency,
      rules: sorted(revision.consistency.rules), exceptions: [...revision.consistency.exceptions].sort((a, b) => a.ruleId.localeCompare(b.ruleId)) } };
}
export function freezePackageImpact<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezePackageImpact); Object.freeze(value); } return value;
}

/** Stop before cloning unexpectedly large or circular inputs. Limited reports never change a package. */
export function impactInputFits(input: unknown): boolean {
  const pending: Array<{ value: unknown; exit?: boolean }> = [{ value: input }], seen = new WeakSet<object>(), active = new WeakSet<object>(); let units = 0, nodes = 0;
  while (pending.length) {
    if (++nodes > 250_000 || pending.length > 250_000 || units > 64 * 1024 * 1024) return false;
    const { value, exit } = pending.pop()!;
    if (exit && value && typeof value === 'object') { active.delete(value); continue; }
    if (typeof value === 'string') units += value.length * 3;
    else if (value && typeof value === 'object') {
      if (active.has(value)) return false;
      if (seen.has(value)) continue;
      seen.add(value); active.add(value); pending.push({ value, exit: true });
      if (Array.isArray(value)) { if (value.length > 250_000) return false; for (const child of value) pending.push({ value: child }); }
      else for (const [key, child] of Object.entries(value)) { units += key.length * 3; pending.push({ value: child }); }
    }
  }
  return units <= 64 * 1024 * 1024;
}

export function limitedPackageImpact(beforeRevisionId: string, afterRevisionId: string): PackageChangeImpact {
  return freezePackageImpact({ version: 1, beforeRevisionId, afterRevisionId, changed: false, limited: true, sections: [],
    summary: { changedMembers: 0, movedMembers: 0, changedFacts: 0, affectedOutputs: 0, affectedReviews: 0, unknownEvidence: 1 },
    notices: ['Detailed impact is unavailable within the comparison limit. Inspect the existing field previews and saved documents before applying changes.'] });
}

export function compareImpactMembers(before: PackageRevision, after: PackageRevision): PackageImpactItem[] {
  const old = new Map(before.members.map((member, index) => [member.id, { member, index }]));
  const next = new Map(after.members.map((member, index) => [member.id, { member, index }]));
  return [...new Set([...old.keys(), ...next.keys()])].map(id => {
    const a = old.get(id), b = next.get(id), member = b?.member ?? a!.member;
    const common = { id, label: member.label, destinations: [{ revisionId: b ? after.id : before.id, memberId: id }],
      ...(a ? { beforePosition: a.index + 1 } : {}), ...(b ? { afterPosition: b.index + 1 } : {}) };
    if (!a) return { ...common, state: 'added', message: 'Added to the compared package.' };
    if (!b) return { ...common, state: 'removed', message: 'Removed from this revision. Earlier captured content remains in saved history.' };
    if (!sameImpactValue(packageMemberContent(a.member), packageMemberContent(b.member)))
      return { ...common, state: 'changed', message: 'Captured document or original-file inputs changed. Inspect its document preview for exact edits.' };
    if (a.member.kind === 'native' && b.member.kind === 'native' && !sameImpactValue(a.member.session, b.member.session))
      return { ...common, state: 'unknown', message: 'The saved document snapshots differ despite matching draft digests. Inspect the retained source before relying on this comparison.' };
    if (!sameImpactValue(packageMemberInputs(a.member), packageMemberInputs(b.member)))
      return { ...common, state: 'metadata-only', message: 'Retained names, provenance or package settings changed; captured content digests match.' };
    if (a.index !== b.index) return { ...common, state: 'moved', message: 'Document order changed; its captured content digests match. Assembly numbering and boundaries need a new check.' };
    return { ...common, state: 'unchanged', message: 'Captured document inputs and position match.' };
  });
}
