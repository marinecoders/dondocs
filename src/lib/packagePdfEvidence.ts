import { portableResourceDigest } from "./portableResources";
import { reviewPackageText } from "./actionPackageDisclosure";
import type { PolicyResolution } from "./exportDeploymentPolicy";

export const MAX_PACKAGE_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PACKAGE_PDF_PAGES = 500;
const MAX_TEXT_ITEMS = 200_000;
const MAX_TEXT_CHARACTERS = 2_000_000;

export interface PackagePdfEvidence {
  pages: Array<{ geometry: number[]; textSha256: string; layoutSha256: string; hasText: boolean }>;
}
const hash = (value: unknown) => portableResourceDigest(new TextEncoder().encode(JSON.stringify(value)).buffer);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const rounded = (value: number) => Math.round(value * 1000) / 1000;

/** Stream bounded text-layer evidence; image appearance is deliberately not assessed. */
export async function inspectPackagePdf(
  bytes: ArrayBuffer,
  signal: AbortSignal,
  onPageText?: (text: string) => void,
): Promise<PackagePdfEvidence> {
  signal.throwIfAborted();
  if (bytes.byteLength > MAX_PACKAGE_PDF_BYTES)
    throw new Error("Package PDF inspection supports at most 25 MB per file.");
  const [{ pdfjs }, { HARDENED_PDF_OPTIONS }, { itemsToLines }] = await Promise.all([
    import("react-pdf"), import("@/components/pdf/pdfConfig"), import("./pdfText"),
  ]);
  signal.throwIfAborted();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), ...HARDENED_PDF_OPTIONS });
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  const stop = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  controller.signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("PDF inspection took too long. The saved package is unchanged.")), 45_000);
  let itemCount = 0, characters = 0;
  try {
    const document = await task.promise;
    controller.signal.throwIfAborted();
    if (document.numPages > MAX_PACKAGE_PDF_PAGES)
      throw new Error(`PDF inspection supports at most ${MAX_PACKAGE_PDF_PAGES} pages per output. The saved PDFs remain available.`);
    const pages: PackagePdfEvidence["pages"] = [];
    for (let number = 1; number <= document.numPages; number++) {
      controller.signal.throwIfAborted();
      const page = await document.getPage(number);
      const reader = page.streamTextContent({ disableNormalization: true }).getReader();
      const positioned: Array<{ str: string; x: number; y: number; height: number }> = [];
      const layout: unknown[] = [];
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const chunk: { done: boolean; value?: unknown } = await reader.read();
          if (chunk.done) break;
          const value = chunk.value as { items?: unknown };
          if (!value || !Array.isArray(value.items)) throw new Error("The PDF text layer could not be inspected.");
          for (const raw of value.items as unknown[]) {
            if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
            const item = raw as { str: unknown; transform?: unknown; width?: unknown; height?: unknown; hasEOL?: unknown };
            if (typeof item.str !== "string" || !Array.isArray(item.transform) || item.transform.length !== 6
              || !item.transform.every(finite) || !finite(item.width) || !finite(item.height))
              throw new Error("The PDF text positioning is invalid.");
            itemCount++; characters += item.str.length;
            if (itemCount > MAX_TEXT_ITEMS || characters > MAX_TEXT_CHARACTERS)
              throw new Error("The PDF text layer exceeds the comparison limit. The saved PDFs remain available.");
            const transform = item.transform as number[];
            positioned.push({ str: item.str, x: transform[4], y: transform[5], height: Math.abs(transform[3]) || item.height || 10 });
            layout.push([item.str, transform.map(rounded), rounded(item.width), rounded(item.height), item.hasEOL === true]);
          }
        }
        controller.signal.throwIfAborted();
        const text = itemsToLines(positioned).join("\n");
        onPageText?.(text);
        const geometry = [...page.view, page.rotate, page.userUnit];
        if (!geometry.every(finite)) throw new Error("The PDF page geometry is invalid.");
        pages.push({ geometry, textSha256: await hash(text), layoutSha256: await hash(layout), hasText: !!text.trim() });
      } finally {
        await reader.cancel().catch(() => {});
        page.cleanup();
      }
    }
    controller.signal.throwIfAborted();
    return { pages };
  } catch (cause) {
    controller.signal.throwIfAborted();
    throw cause;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", stop);
    await task.destroy();
  }
}

/** Strict PDF review: extraction failures/limits cannot become an empty review. */
export async function reviewBoundedPackagePdf(
  bytes: ArrayBuffer,
  label: string,
  policy: PolicyResolution,
  signal: AbortSignal,
) {
  const text: string[] = [];
  const evidence = await inspectPackagePdf(bytes, signal, page => text.push(page));
  signal.throwIfAborted();
  const review = reviewPackageText(`${label}\n${text.join("\n\n")}`, label, policy);
  review.notices.push(evidence.pages.some(page => !page.hasText)
    ? "Some pages have no readable text layer. Review their images for markings and personal information."
    : "Text-layer inspection cannot read text inside scanned images. Review the PDF pages.");
  return review;
}
