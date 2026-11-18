import type { PackageRevision } from './actionPackages';
import type { PackageSigningHandoff } from './packageSigningModel';
import { packageAssemblyInputs, packageReviewContext } from './packageChangeImpactModel';
import { portableResourceDigest } from './portableResources';

/** Stable captures precede assembly profiles; omitted profiles keep their original digest projection. */
export async function packageSigningContextFingerprint(revision: PackageRevision): Promise<string> {
  const captured: unknown = packageAssemblyInputs(revision);
  const wrapped = captured && typeof captured === 'object' && !Array.isArray(captured) && 'members' in captured ? captured : undefined;
  const inputs = wrapped ? wrapped.members : captured;
  const assembly = wrapped && 'assembly' in wrapped ? wrapped.assembly : undefined;
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify({ inputs, context: packageReviewContext(revision),
    ...(assembly === undefined ? {} : { assembly }) })).buffer);
}
export interface PackageSigningDependency {
  targetState: 'matches' | 'changed' | 'missing';
  packageContextChanged: boolean;
  contextSha256: string;
  targetSha256?: string;
}
/** Compare recorded dependencies only. A file's signer authenticity is never inferred from a matching checksum. */
export async function inspectPackageSigningDependency(entry: PackageSigningHandoff, revision: PackageRevision): Promise<PackageSigningDependency> {
  const contextSha256 = await packageSigningContextFingerprint(revision), packageContextChanged = contextSha256 !== entry.contextSha256;
  if (entry.target.kind === 'output') return { targetState: packageContextChanged ? 'changed' : 'matches', packageContextChanged, contextSha256, targetSha256: contextSha256 };
  const member = revision.members.find(item => item.id === entry.target.id);
  return { targetState: !member ? 'missing' : member.kind === 'original' && member.original.sha256 === entry.sourceSha256 ? 'matches' : 'changed',
    packageContextChanged, contextSha256, targetSha256: member?.kind === 'original' ? member.original.sha256 : undefined };
}
