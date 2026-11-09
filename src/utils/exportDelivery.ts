import type { ExportDeliveryLease } from '@/lib/exportController';
import type { ExportArtifact } from '@/lib/exportExecution';
import type { ExportTarget } from '@/lib/preparedExport';
import { downloadPdfBlob, preOpenWindowForIOS } from './downloadPdf';

/** Reserve iOS's PDF tab in the initiating gesture. Each attempt owns its
 * unused tab; delivered URLs and tabs transfer to the browser download utility.
 */
export function openBrowserExportDelivery(target: ExportTarget): ExportDeliveryLease {
  let prepared = target === 'pdf' ? preOpenWindowForIOS() : null;
  let released = false;
  let used = false;
  const closeUnused = () => {
    const window = prepared;prepared = null;
    if (window && !window.closed) window.close();
  };
  return Object.freeze({
    deliver: async (artifact: ExportArtifact) => {
      if (released || used || artifact.job.target !== target) throw new Error('This delivery attempt is no longer available.');
      used = true;
      if (target === 'pdf') {
        try {
          const delivered = await downloadPdfBlob(artifact.blob, artifact.job.filename, prepared);
          if (delivered) prepared = null;
          return delivered;
        } finally { closeUnused(); }
      }
      const url = URL.createObjectURL(artifact.blob);
      const anchor = document.createElement('a');
      let handedOff = false;
      try {
        anchor.href = url;anchor.download = artifact.job.filename;
        document.body.appendChild(anchor);anchor.click();
        handedOff = true;
        // The browser needs time to consume a successful download URL.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return true;
      } finally { anchor.remove();if (!handedOff) URL.revokeObjectURL(url); }
    },
    release: () => { if (!released) { released = true;closeUnused(); } },
  });
}
