import { PDFDocument } from "pdf-lib";
import { inspectRasterImage } from "@/services/docx/imageAssets";
import { parseDraftFile } from "./draftFile";
import { validateBackup } from "./backupValidation";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./encoding";

/** Native draft transfer remains the model owner; package imports additionally require complete readable resources. */
export async function validatePackageDraft(value: unknown) {
  validateBackup({ documents: [{ session: value }] });
  const reviewed = parseDraftFile(value, false, true);
  const raw = value as Record<string, unknown>;
  if ("portableResources" in raw || "portableFormTemplates" in raw)
    throw new Error(
      "Package templates require a single explicit resource binding.",
    );
  const verifyBinary = async (
    encoded: string,
    type: "pdf" | "image/png" | "image/jpeg",
    declaredSize?: number,
  ) => {
    const data = encoded.replace(/^data:image\/(png|jpeg);base64,/, "");
    const bytes = base64ToUint8Array(data);
    if (
      !bytes.byteLength ||
      uint8ArrayToBase64(bytes) !== data ||
      (declaredSize !== undefined && declaredSize !== bytes.byteLength)
    )
      throw new Error("A saved native attachment has invalid bytes or size.");
    if (type === "pdf") {
      if (!(await PDFDocument.load(bytes)).getPageCount())
        throw new Error("A saved PDF has no pages.");
    } else await inspectRasterImage(bytes, type);
  };
  const form = raw.formData as Record<string, unknown>;
  if (
    form.basicLetterFileRef ||
    (form.signatureImage as { fileRef?: unknown } | undefined)?.fileRef
  )
    throw new Error(
      "A package draft cannot resolve device-local attachment handles.",
    );
  const basic = form.basicLetterFile as
    | { data: string; size: number }
    | undefined;
  if (basic) await verifyBinary(basic.data, "pdf", basic.size);
  const signature = form.signatureImage as
    | { data: string; size: number }
    | undefined;
  if (signature)
    await verifyBinary(signature.data, "image/png", signature.size);
  if (form.signatureType === "image" && !signature)
    throw new Error("A required signature image is missing.");
  for (const enclosure of raw.enclosures as Array<{
    fileRef?: unknown;
    file?: { data: string; size: number };
  }>) {
    if (enclosure.fileRef)
      throw new Error(
        "A package enclosure cannot resolve a device-local handle.",
      );
    if (enclosure.file)
      await verifyBinary(enclosure.file.data, "pdf", enclosure.file.size);
  }
  for (const paragraph of raw.paragraphs as Array<{
    figure?: { fileRef?: unknown; data: string; type: string };
  }>)
    if (paragraph.figure) {
      if (paragraph.figure.fileRef)
        throw new Error(
          "A package figure cannot resolve a device-local handle.",
        );
      if (!["image/png", "image/jpeg"].includes(paragraph.figure.type))
        throw new Error("Package figure images support PNG and JPEG files.");
      await verifyBinary(
        paragraph.figure.data,
        paragraph.figure.type as "image/png" | "image/jpeg",
      );
    }
  for (const form of [
    reviewed.session.forms?.navmc10274,
    reviewed.session.forms?.navmc11811,
  ])
    for (const block of form?.signatureBlocks ?? []) {
      if (block.imageRef)
        throw new Error(
          "A package form signature cannot resolve a device-local handle.",
        );
      if (block.style === "image" && !block.image)
        throw new Error("A required form signature image is missing.");
      if (block.image) await verifyBinary(block.image, "image/png");
    }
  return reviewed;
}
