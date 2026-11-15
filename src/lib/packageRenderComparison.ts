import { capturePreparedPackageComparison, preparePackageAssembly, type PreparedPackageAssembly } from "./actionPackageAssembly";
import type { ActionPackage } from "./actionPackages";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import { packageInputFingerprint } from "./packageRenderProvenance";
import { portableResourceDigest } from "./portableResources";
import { inspectPackagePdf, reviewBoundedPackagePdf } from "./packagePdfEvidence";

export const MAX_PACKAGE_COMPARISON_BYTES = 25 * 1024 * 1024;
export { MAX_PACKAGE_PDF_PAGES as MAX_PACKAGE_COMPARISON_PAGES, inspectPackagePdf } from "./packagePdfEvidence";
export type { PackagePdfEvidence } from "./packagePdfEvidence";

export type ComparisonFinding = "matches" | "differs" | "unavailable";
export interface PackageRenderComparison {
  revisionId: string;
  beforeId: string;
  afterId: string;
  beforeCreatedAt: number;
  afterCreatedAt: number;
  beforeVersion: string | null;
  afterVersion: string | null;
  beforeSha256: string;
  afterSha256: string;
  identicalBytes: boolean;
  extractedText: ComparisonFinding;
  textLayout: ComparisonFinding;
  pageGeometry: ComparisonFinding;
  memberBoundaries: ComparisonFinding;
  recordedResources: ComparisonFinding;
  recordedInputs: "matches" | "unavailable";
  beforePages: number;
  afterPages: number;
  pagesWithoutText: number[];
}

/** Reuse package review, with the same extraction bounds before acknowledgement. */
export async function preparePackageRenderComparison(
  record: ActionPackage,
  revisionId: string,
  policy: PolicyResolution,
  signal: AbortSignal,
): Promise<PreparedPackageAssembly> {
  return preparePackageAssembly(record, revisionId, policy, {
    signal,
    reviewOriginal: (bytes, label, currentPolicy) => reviewBoundedPackagePdf(bytes, label, currentPolicy, signal),
  });
}

/** Compare only retained bytes privately bound to one acknowledged capture. */
export async function comparePreparedPackageOutputs(
  prepared: PreparedPackageAssembly,
  beforeId: string,
  afterId: string,
  signal: AbortSignal,
  inspect: typeof inspectPackagePdf = inspectPackagePdf,
): Promise<PackageRenderComparison> {
  signal.throwIfAborted();
  const { revision, before, after, beforeBytes, afterBytes } = capturePreparedPackageComparison(prepared, beforeId, afterId);
  if (beforeBytes.byteLength + afterBytes.byteLength > MAX_PACKAGE_COMPARISON_BYTES)
    throw new Error("The two PDFs exceed the 25 MB comparison limit. Their saved downloads remain available.");
  const fingerprint = await packageInputFingerprint(revision);
  for (const output of [before, after])
    if (output.provenance && output.provenance.inputSha256 !== fingerprint)
      throw new Error("A retained output's recorded inputs do not match this package revision. Restore a valid saved package before comparing.");
  const beforeSha256 = await portableResourceDigest(beforeBytes), afterSha256 = await portableResourceDigest(afterBytes);
  if (beforeSha256 !== before.asset.sha256 || afterSha256 !== after.asset.sha256)
    throw new Error("A retained output failed its saved checksum. The package was not changed.");
  signal.throwIfAborted();
  const a = await inspect(beforeBytes, signal);
  signal.throwIfAborted();
  const b = await inspect(afterBytes, signal);
  signal.throwIfAborted();
  const compare = (left: unknown, right: unknown): ComparisonFinding => JSON.stringify(left) === JSON.stringify(right) ? "matches" : "differs";
  const hasText = [...a.pages, ...b.pages].some(page => page.hasText);
  const left = before.provenance, right = after.provenance;
  const resourcesKnown = left?.runtimeRevision && right?.runtimeRevision
    && /^[a-f0-9]{64}$/.test(left.templatesRevision) && /^[a-f0-9]{64}$/.test(right.templatesRevision);
  return {
    revisionId: revision.id, beforeId, afterId,
    beforeCreatedAt: before.createdAt, afterCreatedAt: after.createdAt,
    beforeVersion: left?.applicationVersion ?? null, afterVersion: right?.applicationVersion ?? null,
    beforeSha256, afterSha256, identicalBytes: beforeSha256 === afterSha256,
    extractedText: hasText ? compare(a.pages.map(page => page.textSha256), b.pages.map(page => page.textSha256)) : "unavailable",
    textLayout: hasText ? compare(a.pages.map(page => page.layoutSha256), b.pages.map(page => page.layoutSha256)) : "unavailable",
    pageGeometry: compare(a.pages.map(page => page.geometry), b.pages.map(page => page.geometry)),
    memberBoundaries: compare(before.boundaries, after.boundaries),
    recordedInputs: left && right ? "matches" : "unavailable",
    recordedResources: resourcesKnown ? compare(
      [left.runtimeRevision, left.templatesRevision, left.assembly, left.exportContract, left.pdfLibrary],
      [right.runtimeRevision, right.templatesRevision, right.assembly, right.exportContract, right.pdfLibrary],
    ) : "unavailable",
    beforePages: a.pages.length, afterPages: b.pages.length,
    pagesWithoutText: Array.from({ length: Math.max(a.pages.length, b.pages.length) }, (_, index) => index)
      .filter(index => !a.pages[index]?.hasText || !b.pages[index]?.hasText).map(index => index + 1),
  };
}
