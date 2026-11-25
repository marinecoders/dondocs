import { lazy, Suspense, useLayoutEffect, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ActionPackage, NativePackageMember } from '@/lib/actionPackages';
import { getPackageRevision } from '@/lib/actionPackages';
import { savePackageWorkingCopy } from '@/lib/actionPackageWorkingCopy';
import { readFormLocation, rememberFormLocation } from '@/lib/packageFormLocation';
import { captureDocumentTarget, isCurrentDocumentScope, useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));

export interface PackageEditorSurface {
  setEditorHost(host: HTMLDivElement | null): void;
  preview: { documentId: string | null; url: string | null; error?: string | null };
}

interface Props extends PackageEditorSurface {
  record: ActionPackage;
  member: NativePackageMember;
  documentId: string;
  disabled: boolean;
  navigationError: string;
  onSave(next: ActionPackage): void;
  onNavigate(memberId?: string): void;
}

export default function PackageCorrespondenceEditor({ record, member, documentId, disabled, navigationError, setEditorHost, preview, onSave, onNavigate }: Props) {
  const key = record.id + '/' + member.id;
  const latest = useRef({ record, member, onSave });
  useLayoutEffect(() => { latest.current.onSave = onSave; }, [onSave]);
  const [recovered] = useState(() => !!readFormLocation(key + '/unsaved'));
  const dirty = useRef(recovered);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>(recovered ? 'pending' : 'saved');
  const [error, setError] = useState('');
  const [navigating, setNavigating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveId = useDocumentsStore(s => s.currentId);
  const owned = documentId === liveId;
  const lastTarget = useRef(captureDocumentTarget());

  function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (running.current) return running.current;
    const controller = operation.current;
    if (!controller || controller.signal.aborted) return Promise.resolve(false);
    if (!dirty.current) return Promise.resolve(true);
    const { signal } = controller;
    async function save() {
      try {
        while (dirty.current) {
          const target = captureDocumentTarget();
          if (!target || target.scope.documentId !== documentId) throw new Error('Reopen the package working copy to save your edits.');
          const base = latest.current;
          setStatus('saving');
          let next: ActionPackage;
          try { next = await savePackageWorkingCopy(base.record, base.member, signal); }
          catch (cause) {
            if (!signal.aborted && isCurrentDocumentScope(target.scope) && target.editSequence !== captureDocumentTarget()?.editSequence) continue;
            throw cause;
          }
          signal.throwIfAborted();
          const saved = getPackageRevision(next).members.find(item => item.id === member.id);
          if (saved?.kind !== 'native') throw new Error('The saved package member is unavailable.');
          base.record = next;
          base.member = saved;
          base.onSave(next);
          if (isCurrentDocumentScope(target.scope) && target.editSequence === captureDocumentTarget()?.editSequence) {
            dirty.current = false;
            rememberFormLocation(key + '/unsaved', '');
          }
        }
        setStatus('saved'); setError('');
        return true;
      } catch (cause) {
        if (!signal.aborted) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : 'Could not save these package edits.');
        }
        return false;
      } finally { running.current = null; }
    }
    running.current = Promise.resolve().then(save);
    return running.current;
  }

  const saveLatest = useRef(flush);
  useLayoutEffect(() => { saveLatest.current = flush; });
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveLatest.current(), 1500);
    };
    if (dirty.current) schedule();
    const unsubscribe = useDocumentStore.subscribe(() => {
      const target = captureDocumentTarget();
      if (target?.scope.documentId !== documentId || target.editSequence === lastTarget.current?.editSequence) return;
      lastTarget.current = target;
      dirty.current = true;
      rememberFormLocation(key + '/unsaved', '1');
      setStatus('pending'); setError(''); schedule();
    });
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { unsubscribe(); clearTimeout(timer.current); controller.abort(); window.removeEventListener('beforeunload', warn); };
  }, [documentId, key]);

  async function navigate(id?: string) {
    if (disabled || navigating) return;
    setNavigating(true);
    // Commit a buffered native input before comparing the active revision.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (await flush()) {
      const section = useEditorOutlineStore.getState().activeId;
      if (section) rememberFormLocation(key + '/section', section);
      onNavigate(id);
    }
    setNavigating(false);
  }
  const activePreview = preview.documentId === documentId && preview.url;
  return <Dialog open onOpenChange={open => { if (!open) void navigate(); }}>
    <DialogContent fullscreen showCloseButton={false} className="flex min-w-0 flex-col gap-0">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="sm" disabled={disabled || navigating} onClick={() => void navigate()}><ArrowLeft />Back to package</Button>
        <div><DialogTitle>{record.name}</DialogTitle><DialogDescription>{member.label}</DialogDescription></div>
        <label className="text-sm">Package document<select aria-label="Package document" className="ml-2 max-w-full rounded-md border bg-background px-2 py-1.5" value={member.id} disabled={disabled || navigating} onChange={event => void navigate(event.target.value)}>
          {getPackageRevision(record).members.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.label}</option>)}
        </select></label>
        <span className="ml-auto text-sm text-muted-foreground" role="status">{{ saved: 'Saved to package', pending: 'Editing draft', saving: 'Saving…', error: 'Save needs attention' }[status]}</span>
        <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setShowPreview(!showPreview)}>{showPreview ? 'Show fields' : 'Show preview'}</Button>
        {status === 'error' && <Button size="sm" disabled={disabled || navigating} onClick={() => void flush()}>Retry save</Button>}
      </header>
      {(error || navigationError) && <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">{error || navigationError}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <div className={(showPreview ? 'hidden lg:block ' : '') + 'min-h-0 min-w-0'} inert={disabled || navigating || undefined} ref={owned ? setEditorHost : undefined} />
        <aside aria-label="Document preview" className={(showPreview ? '' : 'hidden lg:block ') + 'min-h-0 min-w-0 border-l'}>
          {activePreview ? <Suspense fallback={<p role="status">Opening preview…</p>}><PdfViewer documentId={'package-member:' + key} pdfUrl={activePreview} showFullscreen={false} /></Suspense>
            : <p role="status" className="p-4 text-sm">{preview.error || 'Preparing document preview…'}</p>}
        </aside>
      </div>
    </DialogContent>
  </Dialog>;
}
