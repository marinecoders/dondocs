import type { PackageRevision, PackageReviewRound } from './actionPackages';
import { packageInputFingerprint } from './packageRenderProvenance';
import { reviewPayloadDigest } from './reviewRounds';
import { compareImpactMembers, packageAssemblyInputs, packageReviewContext, sameImpactValue,
  type PackageImpactItem } from './packageChangeImpactModel';

/** Exact retained outputs remain associated with their captured revision, even when inputs match. */
export async function inspectImpactOutputs(before: PackageRevision, after: PackageRevision, signal?: AbortSignal): Promise<PackageImpactItem[]> {
  const items: PackageImpactItem[] = [];
  const sourceFingerprint = await packageInputFingerprint(before);
  signal?.throwIfAborted();
  const destinationFingerprint = after.id === before.id ? sourceFingerprint : await packageInputFingerprint(after);
  const members = compareImpactMembers(before, after);
  const inputsMatch = sameImpactValue(packageAssemblyInputs(before), packageAssemblyInputs(after));
  const contextMatches = sameImpactValue(packageReviewContext(before), packageReviewContext(after));
  const unknownMembers = members.some(member => member.state === 'unknown');
  const outputs = [...before.outputs.map(output => ({ output, revision: before, fingerprint: sourceFingerprint })),
    ...after.outputs.filter(output => !before.outputs.some(previous => previous.id === output.id)).map(output => ({ output, revision: after, fingerprint: destinationFingerprint }))];
  for (const [index, { output, revision, fingerprint }] of outputs.entries()) {
    signal?.throwIfAborted();
    const common = { id: output.id, label: `Retained PDF ${index + 1}`, capturedRevisionId: revision.id,
      association: revision.id === after.id ? 'exact' as const : 'historical' as const,
      availability: 'not-checked' as const, destinations: [{ outputId: output.id }],
      affectedMemberIds: members.filter(item => ['changed', 'added', 'removed', 'metadata-only', 'unknown'].includes(item.state)).map(item => item.id),
      movedMemberIds: members.filter(item => item.state === 'moved').map(item => item.id) };
    const repeated = revision === before && after.outputs.find(candidate => candidate.id === output.id);
    if (repeated && (before.id !== after.id || !sameImpactValue(repeated, output))) {
      items.push({ ...common, association: 'unknown', state: 'unknown', message: 'A retained PDF identity was reused with a different revision or record. Verify its saved association before relying on it.' }); continue;
    }
    if (!output.provenance) {
      items.push({ ...common, state: 'unavailable', message: 'This legacy PDF has no recorded input fingerprint. Its applicability cannot be established from package metadata.' }); continue;
    }
    if (output.provenance.inputSha256 !== fingerprint) {
      items.push({ ...common, association: 'unknown', state: 'unknown', message: 'The recorded PDF inputs do not match its captured revision. Inspect the retained file and source before using it.' }); continue;
    }
    if (unknownMembers) {
      items.push({ ...common, state: 'unknown', message: 'Document input metadata is inconsistent, so PDF applicability needs inspection.' }); continue;
    }
    if (revision.id === after.id) {
      items.push({ ...common, state: 'unchanged', message: 'The PDF remains associated with this exact saved revision. This report has not opened or verified its file bytes.' }); continue;
    }
    if (!inputsMatch) {
      items.push({ ...common, state: 'changed', message: 'Document content, order or assembly settings changed. The saved PDF remains historical; prepare a new output for the compared revision.' }); continue;
    }
    items.push({ ...common, state: contextMatches ? 'unchanged' : 'metadata-only',
      message: contextMatches ? 'Recorded document and assembly inputs match. The PDF remains attached to its earlier exact revision.'
        : 'Recorded document and assembly inputs match, but package context changed. Recheck readiness; the saved PDF remains historical.' });
  }
  return items;
}

/** Review content can remain useful without transferring approval or an exact-revision association. */
export async function inspectImpactReviews(rounds: readonly PackageReviewRound[], after: PackageRevision, signal?: AbortSignal): Promise<PackageImpactItem[]> {
  const items: PackageImpactItem[] = [];
  for (const round of rounds) {
    signal?.throwIfAborted();
    const members = compareImpactMembers(round.baseline, after);
    const common = { id: round.id, label: round.label, capturedRevisionId: round.revisionId,
      association: round.revisionId === after.id ? 'exact' as const : 'historical' as const,
      availability: 'not-checked' as const, destinations: [{ reviewRoundId: round.id }],
      affectedMemberIds: members.filter(member => ['added', 'removed', 'changed', 'metadata-only', 'unknown'].includes(member.state)).map(member => member.id),
      movedMemberIds: members.filter(member => member.state === 'moved').map(member => member.id) };
    const status = round.lifecycle?.events.at(-1)?.state ?? 'active';
    if (await reviewPayloadDigest(round.baseline) !== round.baselineDigest) {
      items.push({ ...common, association: 'unknown', state: 'unknown', message: 'The recorded review baseline checksum does not match. Its applicability is unknown.' }); continue;
    }
    const unknown = members.some(member => member.state === 'unknown');
    const inputMatch = sameImpactValue(packageAssemblyInputs(round.baseline), packageAssemblyInputs(after));
    const contextMatch = sameImpactValue(packageReviewContext(round.baseline), packageReviewContext(after));
    if (round.revisionId === after.id && (!inputMatch || !contextMatch)) {
      items.push({ ...common, association: 'unknown', state: 'unknown', message: 'The same revision identity has different reviewed input records. Inspect the exact baseline before using this review.' }); continue;
    }
    const state = unknown ? 'unknown' : inputMatch && contextMatch ? 'unchanged' : 'changed';
    const reason = unknown ? 'A saved document snapshot is inconsistent; inspect the reviewed source.'
      : inputMatch && contextMatch ? 'Compared document and package-context inputs match.'
        : common.affectedMemberIds.length ? `${common.affectedMemberIds.length} document input${common.affectedMemberIds.length === 1 ? '' : 's'} changed or became unavailable.`
          : common.movedMemberIds.length ? 'Document order changed; captured per-document inputs match.' : 'Package facts, requirements, citations, intake or consistency context changed.';
    items.push({ ...common, state, message: `${reason} The ${status} review stays tied to its exact reviewed revision; its status is unchanged.` });
  }
  signal?.throwIfAborted();
  return items;
}
