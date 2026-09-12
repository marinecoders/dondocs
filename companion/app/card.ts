/**
 * What the card shows, worked out from the render result: pure functions,
 * so the page's script is wiring and this can be tested without a host.
 */

export interface RenderedFile {
  format: 'pdf' | 'docx';
  path: string;
  out: string;
  bytes: number;
}

/** The render result's structured content, or undefined when it is not one. */
export function fileOf(result: { structuredContent?: unknown; isError?: boolean }): RenderedFile | undefined {
  if (result.isError) { return undefined; }
  const s = result.structuredContent as Partial<RenderedFile> | undefined;
  if (!s || (s.format !== 'pdf' && s.format !== 'docx') || typeof s.out !== 'string' || typeof s.path !== 'string') { return undefined; }
  return { format: s.format, path: s.path, out: s.out, bytes: typeof s.bytes === 'number' ? s.bytes : 0 };
}

/** The resource the page reads the file back from; a nested name is one segment once encoded. */
export const fileUri = (out: string): string => `dondocs://files/${encodeURIComponent(out)}`;

export const MIME: Record<RenderedFile['format'], string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** The file's own name, for the card and the download. */
export const nameOf = (out: string): string => out.split('/').pop() ?? out;

/** A title a person reads: the name without its extension, dashes as spaces, first letter up. */
export function titleOf(out: string): string {
  const stem = nameOf(out).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return stem ? stem[0].toUpperCase() + stem.slice(1) : nameOf(out);
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Base64 to bytes, for a blob resource. */
export function bytesOf(blob: string): Uint8Array {
  const binary = atob(blob);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

/** Bytes to base64, for the download request. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
