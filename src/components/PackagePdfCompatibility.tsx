import { useEffect, useState } from 'react';
import { readPackageAsset, validatePackageOriginalPdf } from '@/lib/actionPackageAssets';
import type { PackageAsset } from '@/lib/actionPackages';
import { checkPackagePrintablePdf } from '@/lib/packagePrintableCopy';

/** Intake passes the selected file; saved members read their exact captured asset. */
export function PackagePdfCompatibility({ source }: { source: ArrayBuffer | PackageAsset }) {
  const [result, setResult] = useState<{ source: typeof source; message: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let message: string;
      try {
        const bytes = source instanceof ArrayBuffer ? source : await readPackageAsset(source);
        await validatePackageOriginalPdf(bytes);
        try {
          await checkPackagePrintablePdf(bytes, controller.signal);
          message = 'Ready for the combined PDF.';
        } catch {
          message = 'A printable copy is needed for the combined PDF. Keep the original and add its printable copy in Documents.';
        }
      } catch (cause) { message = cause instanceof Error ? cause.message : 'Choose a readable PDF.'; }
      if (!controller.signal.aborted) setResult({ source, message });
    })();
    return () => controller.abort();
  }, [source]);
  return <p role="status" className="text-sm text-muted-foreground">{result?.source !== source ? 'Checking PDF for assembly…'
    : result.message}</p>;
}
