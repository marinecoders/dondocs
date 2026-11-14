/** Exact template bytes share ownership by digest, never by mutable form ID. */
export function formTemplateAttachmentId(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid form template checksum.');
  return `form-template-${sha256}`;
}
