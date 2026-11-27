import { formTemplateFiles } from '@/services/forms/model';
import { checkOfficialPdfSource, officialPdfProfile, PAGE11_PRINTABLE_SHA256 } from "@/services/forms/officialPdfProfiles";
import { PDFDocument } from "pdf-lib";
import { retainTemplateAttachment, validatePackagePage } from "@/services/forms/packages";
import { retainPortableFormTemplates } from "@/services/forms/portableTemplates";
import type { NativePackageMember, PackageAsset } from "./actionPackages";

/** Built-in templates are pinned to the existing shipped renderer geometry. */
const builtinTemplateHashes: Record<string, Record<string, string>> = {
  navmc_10274: {
    page1: "5f5e661d628378ae56d575740cc78fc2d6369d2ab49edc01a1f0722f7905c5d1",
    page2: "8ef605884fd1f221b03390a7ba8bb0a55c2eb4e64d1e1164cadd1a718d6d5e91",
    page3: "d07faffc16a0c6cbefe824da530573989987622e0db85f3b60fd4e01238443d1",
  },
  navmc_118_11: {
    page1: PAGE11_PRINTABLE_SHA256,
  },
};
export async function validatePackageMemberTemplates(
  member: NativePackageMember,
  read: (asset: PackageAsset) => Promise<ArrayBuffer>,
): Promise<void> {
  if (member.session.documentCategory !== "forms") {
    if (member.templates && Object.keys(member.templates).length)
      throw new Error("A correspondence member cannot carry form templates.");
    return;
  }
  const definition = member.session.genericForm?.definition;
  const templates = member.templates ?? {};
  const edition = member.session.forms?.officialPdfEdition;
  const profile = edition ? officialPdfProfile(member.session.formType, edition) : undefined;
  const required = definition
    ? Object.fromEntries(
        formTemplateFiles(definition).map((page) => [page.file, page.sha256]),
      )
    : profile ? { ...(profile.formId === 'navmc_118_11' ? builtinTemplateHashes[profile.formId] : {}), official: profile.sha256 }
      : builtinTemplateHashes[member.session.formType];
  if (
    !required ||
    Object.keys(required).length !== Object.keys(templates).length
  )
    throw new Error(
      `The exact form templates for ${member.label} are missing or unsupported.`,
    );
  for (const [file, hash] of Object.entries(required)) {
    const asset = templates[file];
    if (
      !hash ||
      !asset ||
      asset.sha256 !== hash ||
      asset.type !== "application/pdf"
    )
      throw new Error(
        `The pinned template does not match ${member.label}: ${file}.`,
      );
    const data = await read(asset);
    if (profile && file === "official") {
      await checkOfficialPdfSource(profile, data);
      continue;
    }
    const bytes = new Uint8Array(data);
    if (definition) await validatePackagePage(definition, file, bytes);
    else if ((await PDFDocument.load(bytes)).getPageCount() !== 1)
      throw new Error(
        "A built-in form template must contain its exact single page.",
      );
  }
}

export async function retainPackageMemberTemplates(
  member: NativePackageMember,
  read: (asset: PackageAsset) => Promise<ArrayBuffer>,
): Promise<void> {
  const definition = member.session.genericForm?.definition;
  if (!definition) {
    if (member.session.forms?.officialPdfEdition) {
      await validatePackageMemberTemplates(member, read);
      for (const [file, asset] of Object.entries(member.templates ?? {}))
        await retainTemplateAttachment(asset.sha256, file, new Uint8Array(await read(asset)));
    }
    return;
  }
  const pages: Record<string, Uint8Array> = {};
  for (const [file, asset] of Object.entries(member.templates ?? {}))
    pages[file] = new Uint8Array(await read(asset));
  if (!(await retainPortableFormTemplates([{ definition, pages }])))
    throw new Error(
      `The exact templates for ${member.label} could not be retained.`,
    );
}
