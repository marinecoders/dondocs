import { useEffect, useState } from 'react';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { derivePackageNextActions, type PackageNextActions as Findings } from '@/lib/packageNextActions';
export function usePackageChecks(record: ActionPackage | undefined, revision: PackageRevision | null, reviewBaseline: boolean) {
  const owner = record && revision ? `${record.id}:${record.sequence}:${revision.id}:${reviewBaseline}` : undefined;
  const [inspection, setInspection] = useState<{ owner: string; result?: Findings; error?: string } | null>(null);
  const result = inspection && inspection.owner === owner ? inspection.result : undefined;
  const error = inspection && inspection.owner === owner ? inspection.error : undefined;
  useEffect(() => {
    if (!record || !revision || !owner) return;
    const controller = new AbortController();
    let current = true;
    void derivePackageNextActions(record, revision.id, { signal: controller.signal, reviewBaseline }).then(value => {
      if (current) setInspection({ owner, result: value });
    }).catch(cause => {
      if (current && !controller.signal.aborted) setInspection({ owner, error: cause instanceof Error ? cause.message : 'Package checks are unavailable.' });
    });
    return () => { current = false; controller.abort(); };
  }, [record, revision, reviewBaseline, owner]);
  return { result, error };
}
