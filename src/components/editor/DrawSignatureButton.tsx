import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { beginDocumentTask, isCurrentDocumentTask, type DocumentTask } from '@/lib/documentTask';
import { captureDocumentScope, isCurrentDocumentScope, useDocumentsStore, type DocumentScope } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { SignatureDrawingDialog } from './SignatureDrawingDialog';

interface DrawingSession {
  owner: unknown;
  resource: string | object;
  scope: DocumentScope;
  docType: string;
  task: DocumentTask | null;
  isCurrent: () => boolean;
}
interface DrawSignatureButtonProps {
  owner: unknown;
  resource: string | object;
  isCurrent: () => boolean;
  onFile: (file: File) => Promise<boolean>;
  disabled?: boolean;
}

/** Drawing uses the same import and asset ownership rules as image uploads. */
export function DrawSignatureButton({ owner, resource, isCurrent, onFile, disabled }: DrawSignatureButtonProps) {
  const documentId = useDocumentsStore(state => state.currentId);
  const epoch = useDocumentsStore(state => state.activationEpoch);
  const docType = useDocumentStore(state => state.docType);
  const [session, setSession] = useState<DrawingSession | null>(null);
  const latestSession = useRef<DrawingSession | null>(null);
  useLayoutEffect(() => { latestSession.current = session; }, [session]);
  useLayoutEffect(() => useDocumentStore.subscribe(() => {
    const current = latestSession.current;
    // Observe every transition, including a batched change away and back.
    if (current && isCurrentDocumentScope(current.scope) && !current.isCurrent()) {
      beginDocumentTask(current.resource);
      latestSession.current = null; setSession(null);
    }
  }), []);
  useEffect(() => () => {
    const current = latestSession.current;
    if (current && isCurrentDocumentScope(current.scope) && current.isCurrent()) beginDocumentTask(current.resource);
  }, []);
  if (session && (session.owner !== owner || session.scope.documentId !== documentId || session.scope.epoch !== epoch || session.docType !== docType)) {
    setSession(null);
  }
  function close() {
    const current = latestSession.current;
    if (current && isCurrentDocumentScope(current.scope) && current.isCurrent()) beginDocumentTask(current.resource);
    latestSession.current = null; setSession(null);
  }
  return <>
    <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={disabled || !documentId}
      onClick={() => {
        const scope = captureDocumentScope();
        if (!scope) return;
        const next = { owner, resource, scope, docType, task: beginDocumentTask(resource), isCurrent };
        latestSession.current = next; setSession(next);
      }}><PenLine className="mr-1.5 size-4" />Draw signature</Button>
    {session && session.owner === owner && session.scope.documentId === documentId && session.scope.epoch === epoch && session.docType === docType
      && <SignatureDrawingDialog open onOpenChange={value => { if (!value) close(); }} onUse={async file => {
        if (latestSession.current !== session || !isCurrentDocumentScope(session.scope) || !session.isCurrent() || !isCurrentDocumentTask(session.task)) {
          throw new Error('The signature target changed. Close this drawing and start again.');
        }
        try {
          if (!await onFile(file)) throw new Error('The signature was not saved. Check the message and retry, or cancel to keep the existing signature.');
        } catch (cause) {
          if (latestSession.current === session && isCurrentDocumentScope(session.scope) && session.isCurrent()) {
            const next = { ...session, task: beginDocumentTask(session.resource) };
            latestSession.current = next; setSession(next);
          }
          throw cause;
        }
      }} />}
  </>;
}
