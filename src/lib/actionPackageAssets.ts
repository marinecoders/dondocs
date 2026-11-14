import { supportsReviewComments } from "./reviewCommentTargets";
import { validatePackageDraft } from "./actionPackageDraft";
import { formTemplateAttachmentId } from "./formTemplateAssets";
import { retainPortableFormTemplates } from "@/services/forms/portableTemplates";
import {
  retainPackageMemberTemplates,
  validatePackageMemberTemplates,
} from "./actionPackageTemplates";
import { PDFDocument } from "pdf-lib";
import type { CapturedDocument } from "./capturedDocument";
import { copyCapturedDocument } from "./capturedDocument";
import { buildDraftFileFromSnapshot } from "./draftFile";
import {
  loadAttachment,
  persistAttachment,
  withAttachmentStaging,
} from "./attachments";
import { portableResourceDigest } from "./portableResources";
import { captureExportFormTemplates } from "@/services/exports/formTemplates";
import { copyFormExportTemplates } from "./formExportTemplates";
import {
  newPackageId,
  type NativePackageMember,
  type PackageAsset,
  type PackageMember,
} from "./actionPackages";
import {
  copyPreparedDocument,
  prepareReviewedDocument,
} from "@/stores/documentsStore";

export async function retainPackageAsset(
  name: string,
  type: string,
  input: ArrayBuffer,
): Promise<PackageAsset> {
  if (!input.byteLength || input.byteLength > 25 * 1024 * 1024)
    throw new Error(
      "A package file must contain bytes and be no larger than 25 MB. Native draft files include their original embedded attachments.",
    );
  const data = input.slice(0),
    sha256 = await portableResourceDigest(data);
  const ref = await persistAttachment(
    { name, type, size: data.byteLength },
    data,
  );
  return { ...ref, sha256 };
}
export async function readPackageAsset(
  asset: PackageAsset,
): Promise<ArrayBuffer> {
  const data = await loadAttachment(asset.id);
  if (
    !data ||
    data.byteLength !== asset.size ||
    (await portableResourceDigest(data)) !== asset.sha256
  )
    throw new Error(
      `Missing or corrupt saved file: ${asset.name}. Restore an intact package or workspace backup.`,
    );
  return data.slice(0);
}
export async function readPackageMemberDraft(member: NativePackageMember) {
  const bytes = await readPackageAsset(member.draft);
  const draft: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const reviewed = await validatePackageDraft(draft);
  if (JSON.stringify(reviewed.session) !== JSON.stringify(member.session))
    throw new Error(
      `The saved model for ${member.label} does not match its captured native draft.`,
    );
  await validatePackageMemberTemplates(member, readPackageAsset);
  return { draft, reviewed };
}
/** Reuse native draft staging without installing or mutating the active editor. */
export async function preparePackageMember(member: NativePackageMember) {
  const { reviewed } = await readPackageMemberDraft(member);
  await retainPackageMemberTemplates(member, readPackageAsset);
  const prepared = await prepareReviewedDocument(
    reviewed,
    () => true,
    supportsReviewComments(reviewed.session),
  );
  if (!prepared) throw new Error(`Could not stage ${member.label}.`);
  return { prepared, snapshot: copyPreparedDocument(prepared) };
}
export async function capturePackageMember(
  captured: CapturedDocument,
  label: string,
  role: PackageMember["role"],
  previous?: NativePackageMember,
): Promise<NativePackageMember> {
  const snapshot = copyCapturedDocument(captured).document;
  return withAttachmentStaging(async () => {
    for (const enclosure of snapshot.enclosures)
      if (
        (enclosure as { hasFile?: boolean }).hasFile &&
        !enclosure.file &&
        !enclosure.fileRef
      )
        throw new Error(
          `The attached enclosure ${enclosure.title} is missing.`,
        );
    const draft = await buildDraftFileFromSnapshot(
      snapshot,
      captured.source.capturedAt,
    );
    // Templates have one package-owned copy rather than nested draft/resource copies.
    if (draft && typeof draft === "object") {
      delete (draft as Record<string, unknown>).portableFormTemplates;
      delete (draft as Record<string, unknown>).portableResources;
      if (
        "kind" in draft &&
        draft.kind === "dondocs-draft" &&
        "version" in draft &&
        draft.version === 3
      )
        draft.version = 2;
    }
    const reviewed = await validatePackageDraft(draft);
    const templates = await captureExportFormTemplates(captured);
    const retained: Record<string, PackageAsset> = {};
    if (templates) {
      const pages = copyFormExportTemplates(templates);
      const definition = reviewed.session.genericForm?.definition;
      if (
        definition &&
        !(await retainPortableFormTemplates([{ definition, pages }]))
      )
        throw new Error(
          "The exact configured templates could not be retained.",
        );
      for (const [file, bytes] of Object.entries(pages)) {
        const data = new Uint8Array(bytes).buffer,
          sha256 = await portableResourceDigest(data);
        retained[file] = definition
          ? {
              id: formTemplateAttachmentId(sha256),
              name: file,
              type: "application/pdf",
              size: data.byteLength,
              sha256,
            }
          : await retainPackageAsset(
              file.split("/").at(-1) || "template.pdf",
              "application/pdf",
              data,
            );
      }
    }
    return {
      id: previous?.id ?? newPackageId("member"),
      revisionId: newPackageId("member-revision"),
      kind: "native",
      label,
      role,
      required: previous?.required ?? true,
      source: {
        documentId: captured.source.documentId,
        capturedAt: captured.source.capturedAt,
        editSequence: captured.source.editSequence,
        local: true,
      },
      session: reviewed.session,
      draft: await retainPackageAsset(
        `${label}.dondocs.json`,
        "application/json",
        new TextEncoder().encode(JSON.stringify(draft)).buffer,
      ),
      ...(templates ? { templates: retained } : {}),
    };
  });
}
export async function captureOriginalPackageMember(
  file: { name: string; data: ArrayBuffer },
  role: PackageMember["role"],
  signedOriginal: boolean,
): Promise<PackageMember> {
  if (!/\.pdf$/i.test(file.name))
    throw new Error(
      "Original package members currently support PDF files. Add other editable formats through their native DonDocs draft.",
    );
  await PDFDocument.load(file.data);
  return {
    id: newPackageId("member"),
    revisionId: newPackageId("member-revision"),
    kind: "original",
    label: file.name,
    role,
    required: true,
    signedOriginal,
    original: await retainPackageAsset(file.name, "application/pdf", file.data),
  };
}
