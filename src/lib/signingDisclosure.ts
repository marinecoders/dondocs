import { reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { base64ToUint8Array } from './encoding';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import { mergePIIResults } from '@/services/pii/detector';
import { MAX_SIGNING_PDF_BYTES } from './manualSignatureFields';

export interface SigningDisclosureInput {
  readonly pdfs: readonly { readonly bytes: Uint8Array; readonly label: string }[];
  readonly metadata?: unknown;
}

/** Review exactly the retained bytes and metadata included in one delivery. */
export async function reviewSigningDisclosure(input: SigningDisclosureInput, policy: PolicyResolution,
  isCurrent: () => boolean = () => true): Promise<ExportReview> {
  if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
  const metadata = JSON.stringify(input.metadata ?? null);
  if (metadata.length > 2 * 1024 * 1024 || input.pdfs.length > 31) throw new Error('The signing delivery exceeds its review limits.');
  const strings: string[] = [];let nodes = 0;
  function collect(value: unknown, depth: number) {
    if (++nodes > 50_000 || depth > 30) throw new Error('The signing metadata exceeds its review limits.');
    if (typeof value === 'string' || typeof value === 'number') strings.push(String(value));
    else if (Array.isArray(value)) value.forEach(item => collect(item, depth + 1));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { strings.push(key);collect(child, depth + 1); }
  }
  collect(input.metadata, 0);
  const reviews = [reviewPackageText(strings.join('\n'), 'Signing delivery metadata', policy)];
  let total = 0;
  for (const pdf of input.pdfs) {
    total += pdf.bytes.length;
    if (pdf.bytes.length > MAX_SIGNING_PDF_BYTES || total > 80 * 1024 * 1024) throw new Error('The signing PDFs exceed their review limits.');
    if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
    reviews.push(await reviewPackageOriginal(new Uint8Array(pdf.bytes).buffer, pdf.label, policy));
  }
  if (!isCurrent()) throw new Error('The signing delivery was cancelled.');
  return { privacy: mergePIIResults(reviews.map(review => review.privacy)), notices: reviews.flatMap(review => review.notices),
    markingReview: reviews.some(review => review.markingReview), structure: [] };
}

/** Also works for a recovery record whose PDF digest or identity is damaged. */
export function signingRecordDisclosure(input: unknown, validatedRecord = false): SigningDisclosureInput {
  const pdfs: Array<{ bytes: Uint8Array; label: string }> = [];let nodes = 0;
  function metadata(value: unknown, path: string, depth: number): unknown {
    if (++nodes > 50_000 || depth > 30) throw new Error('The signing record exceeds its review limits.');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item, index) => metadata(item, `${path}[${index}]`, depth + 1));
    const object = value as Record<string, unknown>, result = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      // Validated handwritten graphics contain only the image samples used in
      // the retained PDF, which is reviewed below. Recovery blobs stay opaque.
      if (validatedRecord && key === 'graphic' && /^Signing record\.handwritten\[\d+\]$/.test(path)) {
        result[key] = 'Handwritten signature PNG, included with the retained PDF.'; continue;
      }
      if (key === 'data' && typeof child === 'string' && (child.startsWith('JVBERi0') || Array.isArray(object.pages) && typeof object.filename === 'string')) {
        try {
          pdfs.push({ bytes: base64ToUint8Array(child), label: typeof object.filename === 'string' ? object.filename : path });
          result[key] = '[PDF bytes reviewed separately]';continue;
        } catch { /* Keep undecodable data in the metadata review and recovery download. */ }
      }
      result[key] = metadata(child, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  return { pdfs, metadata: metadata(input, 'Signing record', 0) };
}
