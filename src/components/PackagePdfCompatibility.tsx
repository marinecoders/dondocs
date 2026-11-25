import { useEffect, useState } from 'react';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import type { PackageAsset } from '@/lib/actionPackages';
import { checkPackagePrintablePdf } from '@/lib/packagePrintableCopy';

/** Intake passes the selected file; saved members read their exact captured asset. */
export function PackagePdfCompatibility({ source }: { source: ArrayBuffer | PackageAsset }) {
  const [result, setResult] = useState<{ source: typeof source; problem: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let problem = '';
      try {
        const bytes = source instanceof ArrayBuffer ? source : await readPackageAsset(source);
        await checkPackagePrintablePdf(bytes, controller.signal);
      } catch (cause) { problem = cause instanceof Error ? cause.message : 'The PDF cannot be assembled.'; }
      if (!controller.signal.aborted) setResult({ source, problem });
    })();
    return () => controller.abort();
  }, [source]);
  return <p role="status" className="text-sm text-muted-foreground">{result?.source !== source ? 'Checking PDF for assembly…'
    : result.problem ? `A printable copy is needed for the combined PDF. ${result.problem} Keep the original and add its printable copy in Documents.`
    : 'Ready for the combined PDF.'}</p>;
}
