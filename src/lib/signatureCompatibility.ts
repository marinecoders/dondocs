import type { SerializedSession } from "@/stores/documentStore";
import type { SignatureImage } from "@/types/document";
import type { FormSignatureBlock } from "@/types/signature";
import { resolveSignature } from "./signatureAssets";
import { waitForStorage } from "./documentWrites";

/** Older supported clients read inline images and ignore the new asset handles. */
export async function materializeSignatureFallback(
  image: SignatureImage | undefined,
): Promise<SignatureImage | undefined> {
  const owned = image && structuredClone(image);
  if (!owned || owned.data || !owned.fileRef) return owned;
  try {
    return await waitForStorage(resolveSignature(owned));
  } catch {
    return owned;
  } // Keep an unreadable handle available for later recovery.
}

export async function materializeFormSignatureFallbacks<
  T extends { signatureBlocks?: FormSignatureBlock[] },
>(form: T): Promise<T> {
  const owned = structuredClone(form);
  if (Array.isArray(owned.signatureBlocks))
    owned.signatureBlocks = await Promise.all(
      owned.signatureBlocks.map(async (block) => {
        if (!block || block.image || !block.imageRef) return block;
        const image = await materializeSignatureFallback({
          name: block.imageRef.name,
          size: block.imageRef.size,
          data: "",
          fileRef: block.imageRef,
        });
        return image?.data ? { ...block, image: image.data } : block;
      }),
    );
  return owned;
}

export function needsSignatureFallbacks(session: SerializedSession): boolean {
  const image = session.formData?.signatureImage;
  return (
    !!(image?.fileRef && !image.data) ||
    [session.forms?.navmc10274, session.forms?.navmc11811].some(
      (form) =>
        Array.isArray(form?.signatureBlocks) &&
        form.signatureBlocks.some((block) => block?.imageRef && !block.image),
    )
  );
}

/** Capture before I/O and isolate missing images from independent readable ones. */
export async function materializeSignatureFallbacks(
  session: SerializedSession,
): Promise<SerializedSession> {
  const owned = structuredClone(session);
  const tasks: Promise<unknown>[] = [];
  if (owned.formData?.signatureImage)
    tasks.push(
      materializeSignatureFallback(owned.formData.signatureImage).then(
        (image) => {
          owned.formData.signatureImage = image;
        },
      ),
    );
  if (owned.forms?.navmc10274)
    tasks.push(
      materializeFormSignatureFallbacks(owned.forms.navmc10274).then((form) => {
        owned.forms!.navmc10274 = form;
      }),
    );
  if (owned.forms?.navmc11811)
    tasks.push(
      materializeFormSignatureFallbacks(owned.forms.navmc11811).then((form) => {
        owned.forms!.navmc11811 = form;
      }),
    );
  await Promise.all(tasks);
  return owned;
}
