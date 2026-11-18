import type { PackageRevision } from './actionPackages';
import type { PackageImpactItem } from './packageChangeImpactModel';
import { sameImpactValue } from './packageChangeImpactModel';
import { inspectPackageSigningDependency } from './packageSigningContext';

/** This report compares recorded dependencies. The signing inspector opens and validates the captured files separately. */
export async function comparePackageSigningImpact(before: PackageRevision, after: PackageRevision, signal?: AbortSignal): Promise<PackageImpactItem[]> {
  const previous = new Map(before.signing?.handoffs.map(item => [item.id, item]) ?? []), next = new Map(after.signing?.handoffs.map(item => [item.id, item]) ?? []);
  const rows: PackageImpactItem[] = [];
  for (const [index, id] of [...new Set([...previous.keys(), ...next.keys()])].entries()) {
    signal?.throwIfAborted();
    const a = previous.get(id), b = next.get(id), entry = b ?? a!, revision = b ? after : before;
    const base = { id, label: `Signing handoff ${index + 1}`, capturedRevisionId: entry.sourceRevisionId,
      association: entry.sourceRevisionId === revision.id ? 'exact' as const : 'historical' as const,
      availability: 'not-checked' as const, destinations: [{ signingId: entry.id, revisionId: revision.id }] };
    if (!a || !b) { rows.push({ ...base, state: !a ? 'added' : 'removed', message: !a
      ? 'An exact signing handoff was captured. Its original source and signer assignments remain preserved; this is not a verified approval.'
      : 'The handoff is absent from this compared revision. Its earlier captured files and association remain historical.' }); continue; }
    if (!sameImpactValue({ ...a, returns: undefined }, { ...b, returns: undefined })) {
      rows.push({ ...base, association: 'unknown', state: 'unknown', message: 'Signing source metadata changed under an existing handoff identity. Inspect its exact retained record before relying on the association.' }); continue;
    }
    const [left, right] = await Promise.all([inspectPackageSigningDependency(a, before), inspectPackageSigningDependency(b, after)]);
    signal?.throwIfAborted();
    const state = left.targetState !== right.targetState || left.targetSha256 !== right.targetSha256 ? 'changed'
      : left.contextSha256 !== right.contextSha256 || !sameImpactValue(a.returns, b.returns) ? 'metadata-only' : 'unchanged';
    rows.push({ ...base, state, message: state === 'unchanged'
      ? 'Recorded target inputs and signing context match the earlier comparison. The exact handoff and unverified return associations remain unchanged.'
      : right.targetState !== 'matches' ? 'The current signing target was changed or removed. The old handoff stays tied to its exact captured PDF; review its applicability before another handoff or delivery.'
        : !sameImpactValue(a.returns, b.returns) ? 'Captured return associations changed. Current document work is preserved and signer authenticity remains unverified.'
          : 'The handed original PDF bytes still match, but package context changed. Review the package context without relabeling the historical handoff as a new approval.' });
  }
  return rows;
}
