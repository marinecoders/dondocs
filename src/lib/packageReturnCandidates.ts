import type { PackageRevision } from './actionPackages';
import { type OfficialSigningRecord } from './officialSigning';
import { packageFormSigningAction } from './packageOfficialForms';
import { signingMemberKey } from './packageFormReturn';
import { portableResourceDigest } from './portableResources';

/** A byte prefix can route the return to an exact saved handoff. Signature verification happens separately. */
export async function packageReturnCandidates(packageId: string, revision: PackageRevision, bytes: ArrayBuffer,
  records: readonly OfficialSigningRecord[], signal: AbortSignal) {
  const members = new Map(await Promise.all(revision.members.filter(packageFormSigningAction).map(async member =>
    [await signingMemberKey(packageId, member), member] as const)));
  const hashes = new Map<number, string>();
  const matches = [];
  for (const record of records) {
    signal.throwIfAborted();
    const member = members.get(record.sourceRevision?.documentId ?? '');
    const base = record.revisions.at(-1);
    if (!member || !base || bytes.byteLength <= base.length) continue;
    let digest = hashes.get(base.length);
    if (!digest) {
      digest = await portableResourceDigest(bytes.slice(0, base.length));
      hashes.set(base.length, digest);
    }
    if (digest === base.sha256) matches.push({ member, recordId: record.id });
  }
  signal.throwIfAborted();
  return matches;
}

/** Generic signing handoffs preserve a separate PDF per handoff, including whole-package outputs. */
export async function capturedReturnHandoffs(revision: PackageRevision, bytes: ArrayBuffer, signal: AbortSignal) {
  const hashes = new Map<number, string>();
  const matches = [];
  for (const handoff of revision.signing?.handoffs ?? []) {
    signal.throwIfAborted();
    const { size, sha256 } = handoff.pdfs.handoff;
    if (size > bytes.byteLength) continue;
    let digest = hashes.get(size);
    if (!digest) {
      digest = await portableResourceDigest(bytes.slice(0, size));
      hashes.set(size, digest);
    }
    if (digest === sha256) matches.push(handoff);
  }
  signal.throwIfAborted();
  return matches;
}
