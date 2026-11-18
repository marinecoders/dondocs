import { validatePackageScanSource } from './packageScans';
import { validatePackageAttachment } from './packageAttachmentCapabilities';
import { assertPackageRequirementsReady } from "./packageRequirements";
import { validatePackageDraft } from "./actionPackageDraft";
import {
  retainPackageMemberTemplates,
  validatePackageMemberTemplates,
} from "./actionPackageTemplates";
import { PDFDocument } from "pdf-lib";
import { portableResourceDigest } from "./portableResources";
import { z } from "zod";
import {
  actionPackageSchema,
  commitActionPackage,
  listActionPackages,
  packageAssets,
  getPackageRevision,
  type ActionPackage,
} from "./actionPackages";
import {
  buildPortableResources,
  parsePortableResources,
} from "./portableResources";
import {
  readPackageAsset,
  readPackageMemberDraft,
  validatePackageOriginalPdf,
} from "./actionPackageAssets";
import {
  idbGetAttachment,
  idbPutAttachment,
  sameReviewStoredValue,
} from "./documentsDb";
import { withAttachmentStaging } from "./attachments";

export const MAX_PACKAGE_FILE_BYTES = 100 * 1024 * 1024;
const envelopeSchema = z
  .object({
    kind: z.literal("dondocs-action-package"),
    version: z.literal(1),
    package: actionPackageSchema,
    portableResources: z.unknown(),
  })
  .strict();
export async function buildPortableActionPackage(
  record: ActionPackage,
  revisionId = record.currentRevisionId,
  readAsset: typeof readPackageAsset = readPackageAsset,
): Promise<string> {
  const selected = structuredClone(getPackageRevision(record, revisionId));
  const source = structuredClone(record);
  delete source.workingCopies;
  delete source.reviewRounds;
  delete source.reviewApplications;
  delete source.fieldReviewApplications;
  const owned = actionPackageSchema.parse({
    ...source,
    historyScope: "selected-revision",
    currentRevisionId: selected.id,
    revisions: [selected],
  });
  const capturedAssets = new Map<string, { identity: string; bytes: ArrayBuffer }>();
  const readCaptured: typeof readAsset = async asset => {
    const identity = JSON.stringify(asset), prior = capturedAssets.get(asset.id);
    if (prior) {
      if (prior.identity !== identity) throw new Error("Conflicting package asset identity.");
      return prior.bytes.slice(0);
    }
    const bytes = (await readAsset(asset)).slice(0);
    if (bytes.byteLength !== asset.size || await portableResourceDigest(bytes) !== asset.sha256) throw new Error(`Missing or corrupt package content: ${asset.name}.`);
    capturedAssets.set(asset.id, { identity, bytes }); return bytes.slice(0);
  };
  await validateActionPackageResources(owned, readCaptured);
  await assertPackageRequirementsReady(getPackageRevision(owned), "portable", { readAsset: readCaptured });
  for (const revision of owned.revisions)
    for (const member of revision.members)
      if (member.kind === "native" && member.source)
        member.source.local = false;
  delete owned.workingCopies;
  const assets = [
    ...new Map(packageAssets(owned).map((asset) => [asset.id, asset])).values(),
  ];
  const portableResources = await buildPortableResources(
    await Promise.all(
      assets.map(async (asset) => ({
        path: `assets/${asset.id}`,
        name: asset.name,
        mediaType: asset.type,
        data: await readCaptured(asset),
      })),
    ),
  );
  const json = JSON.stringify({
    kind: "dondocs-action-package",
    version: 1,
    package: owned,
    portableResources,
  });
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_FILE_BYTES)
    throw new Error("This editable package exceeds the 100 MB transfer limit.");
  return json;
}
export async function parsePortableActionPackage(json: string) {
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_FILE_BYTES)
    throw new Error("This editable package exceeds the 100 MB transfer limit.");
  const envelope = envelopeSchema.parse(JSON.parse(json));
  if (
    envelope.package.reviewRounds !== undefined ||
    envelope.package.reviewApplications !== undefined ||
    envelope.package.workingCopies?.length ||
    envelope.package.revisions.some((revision) =>
      revision.members.some(
        (member) => member.kind === "native" && member.source?.local,
      ),
    )
  )
    throw new Error(
      "Portable packages cannot bind to local source or working-copy identities.",
    );
  const resources = await parsePortableResources(envelope.portableResources);
  const assets = packageAssets(envelope.package),
    distinct = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    if (
      distinct.has(asset.id) &&
      JSON.stringify(distinct.get(asset.id)) !== JSON.stringify(asset)
    )
      throw new Error("Conflicting saved asset identity.");
    distinct.set(asset.id, asset);
    const resource = resources.get(`assets/${asset.id}`);
    const entry = (
      envelope.portableResources as {
        entries: Array<{ path: string; sha256: string }>;
      }
    ).entries.find((entry) => entry.path === `assets/${asset.id}`);
    if (
      !resource ||
      !entry ||
      entry.sha256 !== asset.sha256 ||
      resource.name !== asset.name ||
      resource.mediaType !== asset.type ||
      resource.data.byteLength !== asset.size
    )
      throw new Error(
        `The package is missing required content: ${asset.name}.`,
      );
  }
  if (resources.size !== distinct.size)
    throw new Error("The package contains unbound resources.");
  await validateActionPackageResources(
    envelope.package,
    async (asset) => resources.get(`assets/${asset.id}`)!.data,
  );
  return { record: envelope.package, resources };
}
export async function importPortableActionPackage(
  json: string,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<ActionPackage> {
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (!isCurrent()) throw new Error("This package import is no longer current. Reopen it and review again.");
  };
  assertCurrent();
  const { record, resources } = await parsePortableActionPackage(json);
  return withAttachmentStaging(async () => {
    const existing = (await listActionPackages()).find(
      (item) => item.id === record.id,
    );
    const comparable = (value: ActionPackage) => {
      const copy = structuredClone(value);
      delete copy.workingCopies;
      delete copy.reviewRounds;
      delete copy.reviewApplications;
      for (const revision of copy.revisions)
        for (const member of revision.members)
          if (member.kind === "native" && member.source)
            member.source.local = false;
      return copy;
    };
    const retained = existing && {
      ...existing,
      historyScope: record.historyScope,
      currentRevisionId: record.currentRevisionId,
      sequence: record.sequence,
      revisions: existing.revisions.filter((revision) =>
        record.revisions.some((incoming) => incoming.id === revision.id),
      ),
    };
    if (
      existing &&
      !sameReviewStoredValue(comparable(retained!), comparable(record))
    )
      throw new Error(
        "This package identity already exists with different revisions. Duplicate the local package before importing a different history.",
      );
    for (const asset of packageAssets(record)) {
      assertCurrent();
      const previous = await idbGetAttachment(asset.id),
        data = resources.get(`assets/${asset.id}`)!.data;
      if (previous) {
        await readPackageAsset(asset);
      } else if (!(await idbPutAttachment({ ...asset, data }, true)))
        throw new Error(
          `Could not retain ${asset.name}. The package was not installed.`,
        );
    }
    for (const revision of record.revisions)
      for (const member of revision.members)
        if (member.kind === "native") {
          await readPackageMemberDraft(member);
          await retainPackageMemberTemplates(member, readPackageAsset);
        }
    assertCurrent();
    return existing ?? commitActionPackage(null, record, signal, isCurrent);
  });
}

/** Shared package integrity boundary for local readiness, portable files and workspace recovery. */
export async function validateActionPackageResources(
  record: ActionPackage,
  read: (
    asset: import("./actionPackages").PackageAsset,
  ) => Promise<ArrayBuffer>,
) {
  const owned = actionPackageSchema.parse(record);
  const { validatePackageReviewBaselines } = await import("./packageReviewRounds");
  await validatePackageReviewBaselines(owned, read);
  const { validatePackageSigningResources } = await import('./packageSigning');
  const seenSigning = new Set<string>();
  for (const revision of [...owned.revisions, ...(owned.reviewRounds ?? []).map(round => round.baseline)])
    for (const entry of revision.signing?.handoffs ?? []) {
      const identity = JSON.stringify(entry);
      if (!seenSigning.has(identity)) { await validatePackageSigningResources({ version: 1, handoffs: [entry] }, read, owned.revisions); seenSigning.add(identity); }
    }
  const requirementTemplates = new Map<string, Promise<import('./packageTemplateSchema').PackageTemplateV2>>();
  for (const revision of [...owned.revisions, ...(owned.reviewRounds ?? []).map(round => round.baseline)])
    if (revision.templateState) {
      const { resolveConditionalPackageRequirements } = await import('./packageConditionalRequirements');
      await resolveConditionalPackageRequirements(revision, read, requirementTemplates);
    }
  const seen = new Map<string, string>();
  for (const asset of packageAssets(owned)) {
    const identity = JSON.stringify(asset);
    if (seen.has(asset.id)) {
      if (seen.get(asset.id) !== identity)
        throw new Error("Conflicting package asset identity.");
      continue;
    }
    seen.set(asset.id, identity);
    const data = await read(asset);
    if (
      data.byteLength !== asset.size ||
      (await portableResourceDigest(data)) !== asset.sha256
    )
      throw new Error(`Missing or corrupt package content: ${asset.name}.`);
  }
  const { validateConditionalPackageStates } = await import('./packageConditionalSources');
  await validateConditionalPackageStates(owned, read);
  const checkedEvidence = new Set<string>(), checkedScans = new Set<string>();
  for (const revision of [...owned.revisions, ...(owned.reviewRounds ?? []).map(round => round.baseline)]) {
    for (const scan of revision.scans?.items ?? []) {
      const identity = `${scan.source.id}:${scan.source.sha256}:${scan.pages.length}`;
      if (!checkedScans.has(identity)) { await validatePackageScanSource(scan, await read(scan.source)); checkedScans.add(identity); }
    }
    for (const member of revision.members) {
      if (member.kind === "attachment") {
        const identity = JSON.stringify(member.original);
        if (!checkedEvidence.has(identity)) { await validatePackageAttachment(member.original, await read(member.original)); checkedEvidence.add(identity); }
        continue;
      }
      if (member.kind === "original") {
        await validatePackageOriginalPdf(await read(member.original));
        continue;
      }
      const draft: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await read(member.draft),
        ),
      );
      if (
        draft &&
        typeof draft === "object" &&
        ("portableResources" in draft || "portableFormTemplates" in draft)
      )
        throw new Error(
          "Package templates must have a single explicit resource binding.",
        );
      const reviewed = await validatePackageDraft(draft);
      if (JSON.stringify(reviewed.session) !== JSON.stringify(member.session))
        throw new Error(
          `The saved model for ${member.label} does not match its native draft.`,
        );
      await validatePackageMemberTemplates(member, read);
    }
    for (const output of revision.outputs) {
      const pdf = await PDFDocument.load(await read(output.asset));
      const frontMatter = output.assembly?.frontMatterPages ?? 0;
      if (frontMatter > pdf.getPageCount()) throw new Error('Retained PDF front matter exceeds its physical pages.');
      const covered = new Set<number>();
      for (let number = 1; number <= frontMatter; number++) covered.add(number);
      for (const boundary of output.boundaries) {
        if (!revision.members.some(member => member.id === boundary.memberId) || boundary.startPage <= frontMatter
          || boundary.startPage + boundary.pageCount - 1 > pdf.getPageCount())
          throw new Error('A retained PDF boundary does not belong to its captured document.');
        for (let page = boundary.startPage; page < boundary.startPage + boundary.pageCount; page++) covered.add(page);
      }
      if (covered.size !== pdf.getPageCount() || [...covered].some(page => page < 1 || page > pdf.getPageCount()))
        throw new Error('The retained PDF does not match its member page boundaries.');
    }
  }
}
