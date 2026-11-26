import { PDFDocument } from 'pdf-lib';

/** Inspect originals without rewriting their preserved bytes or signatures. */
export async function inspectPackageOriginal(data: ArrayBuffer) {
  let count: number;
  let printable = true;
  try {
    const pdf = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    if (!pdf.isEncrypted) {
      count = pdf.getPageCount();
    } else {
      // pdf-lib cannot read encrypted object streams. Open with the normal empty
      // password before retaining an original; never save the parsed document.
      const [{ pdfjs }, { HARDENED_PDF_OPTIONS }] = await Promise.all([
        import('react-pdf'), import('@/components/pdf/pdfConfig'),
      ]);
      const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password: '', ...HARDENED_PDF_OPTIONS });
      try {
        const document = await task.promise;
        count = document.numPages;
        const permissions = await document.getPermissions();
        printable = permissions === null || permissions.includes(pdfjs.PermissionFlag.PRINT) || permissions.includes(pdfjs.PermissionFlag.PRINT_HIGH_QUALITY);
      } finally {
        await task.destroy();
      }
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'PasswordException')
      throw new Error('This PDF requires an opening password. Choose a copy that opens without one.', { cause });
    throw new Error('This PDF could not be read. Choose a readable PDF and try again.', { cause });
  }
  if (count < 1) throw new Error('An original PDF must contain at least one page.');
  return { pages: count, printable };
}

export async function validatePackageOriginalPdf(data: ArrayBuffer): Promise<void> {
  await inspectPackageOriginal(data);
}
