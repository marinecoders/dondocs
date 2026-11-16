import { downloadPdfBlob, preOpenWindowForIOS } from './downloadPdf';

/** Reserve a gesture-sensitive PDF tab before signing preparation awaits. */
export function reserveSigningPdfDownload() {
  let prepared = preOpenWindowForIOS(), released = false, used = false;
  return {
    async deliver(bytes: Uint8Array, filename: string, isCurrent: () => boolean = () => true): Promise<boolean> {
      if (released || used) throw new Error('This signing PDF download is no longer available.');
      used = true;
      const current = () => !released && isCurrent();
      if (!current()) return false;
      const delivered = await downloadPdfBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename, prepared, current);
      if (delivered) prepared = null;
      return delivered;
    },
    release() {
      released = true;
      if (prepared && !prepared.closed) prepared.close();
      prepared = null;
    },
  };
}
