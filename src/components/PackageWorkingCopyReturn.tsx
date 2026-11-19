import { useEffect, useRef, useState } from 'react';
import { getPackageRevision, listActionPackages, type ActionPackage, type NativePackageMember } from '@/lib/actionPackages';
import { savePackageWorkingCopy } from '@/lib/actionPackageWorkingCopy';
import { rememberPackageWorkspaceContext } from '@/lib/packageWorkspaceContext';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from './ui/button';

/** Keep package editing attached to its owning package while using a native editor. */
export function PackageWorkingCopyReturn() {
  const currentId = useDocumentsStore(state => state.currentId), opened = useUIStore(state => state.actionPackagesOpen);
  const [selected, setSelected] = useState<{ documentId: string; record: ActionPackage; member: NativePackageMember; current: boolean }>();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) { setPending(false); setError(''); } });
    if (!currentId || opened) return;
    void listActionPackages().then(records => {
      if (!current) return;
      const record = records.find(item => item.workingCopies?.some(copy => copy.documentId === currentId));
      const copy = record?.workingCopies?.find(item => item.documentId === currentId);
      const revision = record && getPackageRevision(record, copy?.revisionId);
      const member = revision?.members.find(item => item.id === copy?.memberId);
      setSelected(record && copy && member?.kind === 'native' ? { documentId: currentId, record, member, current: copy.revisionId === record.currentRevisionId } : undefined);
    }).catch(() => { if (current) setSelected(undefined); });
    return () => { current = false; operation.current?.abort(); };
  }, [currentId, opened]);
  if (!selected || selected.documentId !== currentId || opened) return null;
  const { record, member } = selected;
  function returnToPackage(value: ActionPackage) {
    rememberPackageWorkspaceContext({ version: 1, packageId: value.id, revisionId: value.currentRevisionId, memberId: member.id, section: 'documents' });
    useUIStore.getState().openActionPackage(value.id, value.currentRevisionId);
  }
  return <section aria-label="Package document editing" className="shrink-0 border-b bg-muted px-5 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{record.name} / {member.label}</p><p className="mt-1 text-xs text-muted-foreground">{selected.current ? 'Working copy · Save to update the package' : 'Working copy of an earlier package version'}</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => returnToPackage(record)}>Return to package</Button>
        <Button size="sm" disabled={pending || !selected.current || record.archived} onClick={() => {
          const controller = new AbortController(); operation.current = controller; setPending(true); setError('');
          void savePackageWorkingCopy(record, member, controller.signal).then(next => { if (!controller.signal.aborted) returnToPackage(next); })
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The document could not be saved to its package.'); })
            .finally(() => { if (!controller.signal.aborted) setPending(false); });
        }}>{pending ? 'Saving…' : 'Save to package'}</Button></div>
    </div>
    {error && <p role="alert" className="mt-2 break-words text-destructive">{error}</p>}
  </section>;
}
