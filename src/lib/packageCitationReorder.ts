import type { SerializedSession } from "@/stores/documentStore";
import { actionPackageSchema, getPackageRevision, type ActionPackage, type PackageRevision, type NativePackageMember } from "./actionPackages";
import { packageCitationCandidates, packageCitationOccurrences, resolvePackageCitations, type PackageCitationOccurrence } from "./packageCitations";
import { packageCitationsSchema, type PackageCitations, type PackageCitationLink, type PackageCitationTarget } from "./packageCitationSchema";
import { sameReviewStoredValue } from "./documentsDb";
import { planReferenceChange } from "./referenceCitations";
import { documentTextFields } from "./documentFields";
import { commitPackageCitationRevision, packageCitationPolicyIdentity } from "./packageCitationRevision";
import { reviewPackageNative, reviewPackageText } from "./actionPackageDisclosure";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import type { ExportReview } from "./preparedExport";
import { enclosureStartNumber } from "./endorsement";

export type PackageCitationReorder = { kind: "members"; order: readonly string[] }
  | { kind: "references" | "enclosures"; memberId: string; order: readonly number[] };
interface TextEdit { linkId: string; source: PackageCitationLink["source"]; before: string; after: string }
export interface PreparedPackageCitationReorder {
  readonly packageId: string;
  readonly sequence: number;
  readonly revisionId: string;
  readonly kind: PackageCitationReorder["kind"];
  readonly orderLabels: readonly string[];
  readonly changes: ReadonlyArray<{ label: string; before: string; after: string }>;
  readonly reviews: ReadonlyArray<ExportReview>;
}
interface Capture { record: ActionPackage; operation: PackageCitationReorder; sessions: Map<string, SerializedSession>; edits: TextEdit[]; policy: PolicyResolution }
const plans = new WeakMap<PreparedPackageCitationReorder, Capture>();
const sameSource = (left: PackageCitationLink["source"], right: PackageCitationLink["source"]) => sameReviewStoredValue(left, right);
const sameField = (left: PackageCitationLink["source"], right: PackageCitationLink["source"]) => left.memberId === right.memberId && left.paragraphId === right.paragraphId && left.field === right.field;
const numericLabel = (value: string) => value.replace(/^0+(?=\d)/, "");

function permuted<T>(values: readonly T[], order: readonly number[]): T[] {
  if (order.length !== values.length || new Set(order).size !== values.length || order.some(index => !Number.isInteger(index) || index < 0 || index >= values.length)) throw new Error("Choose a complete, unique current order.");
  if (order.every((value, index) => value === index)) throw new Error("The selected order has not changed.");
  return order.map(index => values[index]);
}
function orderedMembers(revision: PackageRevision, operation: PackageCitationReorder) {
  if (operation.kind !== "members") return structuredClone(revision.members);
  if (operation.order.some(id => typeof id !== "string")) throw new Error("Choose a valid member order.");
  return permuted(revision.members, operation.order.map(id => revision.members.findIndex(member => member.id === id))).map(member => structuredClone(member));
}
function mappedIndex(target: PackageCitationTarget, operation: PackageCitationReorder): number | undefined {
  if (target.kind === "package-enclosure") return undefined;
  const affected = operation.kind !== "members" && operation.memberId === target.memberId
    && (operation.kind === "references" ? target.kind === "reference" : target.kind === "native-enclosure");
  return affected ? operation.order.indexOf(target.index) : target.index;
}
async function rebindTargets(before: PackageRevision, after: PackageRevision, operation: PackageCitationReorder): Promise<PackageCitations> {
  const metadata = structuredClone(before.citations ?? { version: 1 as const, targets: [], links: [] });
  const prior = await resolvePackageCitations(before), candidates = await packageCitationCandidates(after);
  metadata.targets = metadata.targets.map(target => {
    if (prior.targets.find(value => value.target.id === target.id)?.state !== "current") return target;
    const index = mappedIndex(target, operation);
    const candidate = candidates.find(value => value.target.kind === target.kind && value.target.memberId === target.memberId
      && (value.target.kind === "package-enclosure" || value.target.index === index));
    if (!candidate) throw new Error("A citation target is unavailable in the proposed order.");
    return { ...candidate.target, id: target.id };
  });
  return metadata;
}

function assertLinkedCoverage(revision: PackageRevision, changedLabels: ReadonlyArray<{ memberId: string; kind: "reference" | "enclosure"; before: string; global: boolean }>, occurrences: PackageCitationOccurrence[]) {
  for (const member of revision.members) {
    if (member.kind !== "native") continue;
    for (const field of documentTextFields(member.session, "draft")) {
      if (!["text", "unknown"].includes(field.role) || ["references", "enclosures", "reviewComments"].includes(String(field.path[0]))) continue;
      const affectedEnclosures = new Set(changedLabels.filter(value => value.kind === "enclosure" && (value.global || value.memberId === member.id)).map(value => numericLabel(value.before)));
      if (affectedEnclosures.size) {
        let enclosureContext: string | undefined;
        // A later bare parenthesized number has no stable target, regardless of its separator or prose connector.
        // Known explicit paragraph/page/section labels are not enclosure citations and remain untouched.
        for (const token of field.text.matchAll(/(?:\b(enclosures?|encls?\.?|paragraphs?|paras?\.?|subparagraphs?|pages?|pp?\.?|sections?|secs?\.?|figures?|tables?|items?|appendices|attachments?)\s*)?\(\s*(\d+)\s*\)/gi)) {
          if (token[1]) {
            enclosureContext = /^encl/i.test(token[1]) ? numericLabel(token[2]) : undefined;
            continue;
          }
          if (enclosureContext !== undefined && (affectedEnclosures.has(enclosureContext) || affectedEnclosures.has(numericLabel(token[2]))))
            throw new Error(`${member.label}: expand enclosure lists or ranges into individual explicit citations and link them before reordering.`);
        }
      }
      for (const match of field.text.matchAll(/\b(references?|refs?\.?|enclosures?|encls?\.?)\s*\(\s*([a-z][a-z0-9]*|\d+)\s*\)/gi)) {
        const kind = /^ref/i.test(match[1]) ? "reference" : "enclosure";
        if (kind === "enclosure" && affectedEnclosures.size
          && /^\s*(?:(?:[,;&/＆+\-–—]|and\b|or\b|through\b|to\b)\s*)+\d/i.test(field.text.slice(match.index + match[0].length)))
          throw new Error(`${member.label}: expand enclosure lists or ranges into individual explicit citations and link them before reordering.`);
        const label = kind === "enclosure" ? numericLabel(match[2]) : match[2].toLowerCase();
        if (!changedLabels.some(value => value.kind === kind && (value.global || value.memberId === member.id) && value.before.toLowerCase() === label)) continue;
        const start = match.index + match[0].lastIndexOf(match[2]);
        const paragraph = field.path[0] === "paragraphs" && typeof field.path[1] === "number" ? member.session.paragraphs[field.path[1]] : undefined;
        const occurrence = occurrences.find(value => value.source.memberId === member.id && value.source.paragraphId === paragraph?.id && value.source.field === field.path[2] && value.source.start === start);
        if (!occurrence || !revision.citations?.links.some(link => sameSource(link.source, occurrence.source))) throw new Error(`${member.label}: an affected citation is unlinked or outside supported paragraph text. Link it or correct it manually before reordering.`);
      }
    }
  }
}

/** Prepare a private before/after plan; no files or package revisions are written by preview. */
export async function preparePackageCitationReorder(record: ActionPackage, operation: PackageCitationReorder, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageCitationReorder> {
  signal?.throwIfAborted();
  packageCitationPolicyIdentity(policy);
  const owned = actionPackageSchema.parse(structuredClone(record)), revision = getPackageRevision(owned);
  if (owned.archived) throw new Error("Reopen this archived package before reordering.");
  const members = orderedMembers(revision, operation), sessions = new Map<string, SerializedSession>();
  let referencePlan: ReturnType<typeof planReferenceChange> | undefined;
  let native: NativePackageMember | undefined;
  if (operation.kind !== "members") {
    const selected = members.find(member => member.id === operation.memberId);
    if (!selected || selected.kind !== "native") throw new Error("Choose an available native correspondence member.");
    native = selected;
    if (operation.kind === "references") {
      permuted(selected.session.references, operation.order);
      referencePlan = planReferenceChange(selected.session, operation.order);
      if (referencePlan.blockers.length) throw new Error(referencePlan.blockers.join("\n"));
      if (referencePlan.advisories.length) throw new Error("A bare or ambiguous reference label needs manual review. Use explicit linked citations before reordering.");
      selected.session.references = referencePlan.references;
    } else selected.session.enclosures = permuted(selected.session.enclosures, operation.order);
    sessions.set(selected.id, selected.session);
  }
  const resolved = await resolvePackageCitations(revision);
  if (resolved.links.some(value => value.state !== "current")) throw new Error("A linked citation is stale or missing. Repair it before reordering linked content.");
  const next = { ...revision, members }, metadata = await rebindTargets(revision, next, operation);
  const nextCandidates = await packageCitationCandidates(next), edits: TextEdit[] = [], changes: Array<{ label: string; before: string; after: string }> = [];
  const labels: Array<{ memberId: string; kind: "reference" | "enclosure"; before: string; global: boolean }> = [];
  // Coverage derives from the complete list, including items not identified in older metadata.
  if (operation.kind === "enclosures" && native) {
    const offset = enclosureStartNumber(native.session.docType, native.session.formData.startingEnclosureNumber);
    for (const [index] of native.session.enclosures.entries()) if (operation.order.indexOf(index) !== index)
      labels.push({ memberId: native.id, kind: "enclosure", before: String(index + offset), global: false });
  } else if (operation.kind === "members") {
    const priorEnclosures = revision.members.filter(member => member.role === "enclosure");
    const afterEnclosures = members.filter(member => member.role === "enclosure");
    for (const [index, member] of priorEnclosures.entries()) if (afterEnclosures.findIndex(value => value.id === member.id) !== index)
      labels.push({ memberId: member.id, kind: "enclosure", before: String(index + 1), global: true });
  }
  for (const target of metadata.targets) {
    const old = resolved.targets.find(value => value.target.id === target.id)!;
    const candidate = nextCandidates.find(value => value.target.kind === target.kind && value.target.memberId === target.memberId && (value.target.kind === "package-enclosure" || target.kind !== "package-enclosure" && value.target.index === target.index));
    if (old.state === "current" && candidate && old.citationLabel !== candidate.citationLabel) labels.push({ memberId: target.memberId, kind: target.kind === "reference" ? "reference" : "enclosure", before: old.citationLabel!, global: target.kind === "package-enclosure" });
  }
  const occurrences = await packageCitationOccurrences(revision);
  assertLinkedCoverage(revision, labels, occurrences);
  for (const value of resolved.links) {
    const target = metadata.targets.find(target => target.id === value.link.targetId)!;
    const candidate = nextCandidates.find(value => value.target.kind === target.kind && value.target.memberId === target.memberId && (value.target.kind === "package-enclosure" || target.kind !== "package-enclosure" && value.target.index === target.index));
    if (!candidate) throw new Error("A linked target is unavailable in the proposed order.");
    // The resolved source has already passed exact member, field and range checks.
    const sourceOccurrence = occurrences.find(item => sameSource(item.source, value.link.source))!;
    const before = sourceOccurrence.literal;
    const after = value.link.source.kind === "reference" && before === before.toUpperCase() ? candidate.citationLabel.toUpperCase() : candidate.citationLabel;
    if (before !== after) edits.push({ linkId: value.link.id, source: value.link.source, before, after });
  }
  for (const member of members) {
    if (member.kind !== "native") continue;
    const memberEdits = edits.filter(edit => edit.source.memberId === member.id);
    for (const paragraph of member.session.paragraphs) for (const field of ["text", "header"] as const) {
      const fieldEdits = memberEdits.filter(edit => edit.source.paragraphId === paragraph.id && edit.source.field === field).sort((a, b) => b.source.start - a.source.start);
      if (!fieldEdits.length) continue;
      const before = paragraph[field]!;
      let after = before, preceding = before.length;
      for (const edit of fieldEdits) {
        if (edit.source.end > preceding || before.slice(edit.source.start, edit.source.end) !== edit.before) throw new Error("Citation edits overlap or their expected text changed.");
        after = after.slice(0, edit.source.start) + edit.after + after.slice(edit.source.end);
        preceding = edit.source.start;
      }
      paragraph[field] = after;
      changes.push({ label: `${member.label} · ${field === "header" ? "paragraph heading" : "paragraph"}`, before, after });
      sessions.set(member.id, member.session);
    }
  }
  if (referencePlan && native) {
    const { references: _references, paragraphs, ...unsupported } = referencePlan.patch;
    if (Object.keys(unsupported).length || paragraphs && !sameReviewStoredValue(paragraphs, native.session.paragraphs)) throw new Error("Reference reordering would change an unlinked or unsupported citation. Link every affected paragraph citation first.");
  }
  signal?.throwIfAborted();
  if (changes.reduce((total, change) => total + change.before.length + change.after.length, 0) > 2_000_000)
    throw new Error("The citation reorder preview exceeds two million text characters. Reorder a smaller native list or correct the citations in a working copy.");
  const reviews = [...sessions.values()].map(session => reviewPackageNative(session, "Proposed citation changes", policy));
  reviews.push(reviewPackageText(owned.name, "Package name", policy));
  let enclosureNumber = 0;
  const orderLabels = operation.kind === "references" ? native!.session.references.map(value => `(${value.letter}) ${value.title}`)
    : operation.kind === "enclosures" ? native!.session.enclosures.map((value, index) => `(${index + enclosureStartNumber(native!.session.docType, native!.session.formData.startingEnclosureNumber)}) ${value.title}`)
    : members.map(member => member.role === "enclosure" ? `Enclosure (${++enclosureNumber}) · ${member.label}` : member.label);
  const publicPlan = Object.freeze({ packageId: owned.id, sequence: owned.sequence, revisionId: revision.id, kind: operation.kind, orderLabels, changes: changes.map(change => Object.freeze(change)), reviews });
  plans.set(publicPlan, { record: owned, operation: structuredClone(operation), sessions, edits, policy });
  return publicPlan;
}

/** Apply only the private reviewed transform and rebind known identities after native recapture. */
export async function applyPackageCitationReorder(prepared: PreparedPackageCitationReorder, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const captured = plans.get(prepared);
  if (!captured) throw new Error("Prepare and review this citation reorder again.");
  const before = getPackageRevision(captured.record), order = captured.operation.kind === "members" ? captured.operation.order : before.members.map(member => member.id);
  return commitPackageCitationRevision(captured.record, order, captured.sessions, async after => {
    const metadata = await rebindTargets(before, after, captured.operation), occurrences = await packageCitationOccurrences(after);
    metadata.links = metadata.links.map(link => {
      const relevant = captured.edits.filter(edit => sameField(edit.source, link.source));
      const shift = relevant.filter(edit => edit.source.end <= link.source.start).reduce((sum, edit) => sum + edit.after.length - edit.before.length, 0);
      const own = relevant.find(edit => edit.linkId === link.id);
      const start = link.source.start + shift, end = start + (own?.after.length ?? link.source.end - link.source.start);
      const source = occurrences.find(value => value.source.memberId === link.source.memberId && value.source.paragraphId === link.source.paragraphId && value.source.field === link.source.field && value.source.kind === link.source.kind && value.source.start === start && value.source.end === end)?.source;
      if (!source) throw new Error("A citation could not be rebound to its exact rewritten occurrence.");
      return { ...link, source };
    });
    const parsed = packageCitationsSchema.parse(metadata);
    if ((await resolvePackageCitations({ ...after, citations: parsed })).links.some(value => value.state !== "current")) throw new Error("The rewritten citations could not be validated. The previous package is preserved.");
    return parsed;
  }, captured.policy, signal, isCurrent,
  captured.operation.kind === "enclosures" ? new Map([[captured.operation.memberId, captured.operation.order]]) : undefined);
}
