import { useState } from 'react';
import { useDocumentsStore, deriveTitle } from '@/stores/documentsStore';
import { getSerializedSession } from '@/stores/documentStore';
import { SaveStatus } from '@/components/SaveStatus';

function DraftName({ title }: { title: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const save = () => {
    const docs = useDocumentsStore.getState();
    docs.saveCurrent();
    if (docs.currentId) docs.renameDocument(docs.currentId, name);
    setEditing(false);
  };
  return editing ? <input autoFocus aria-label="Draft name" value={name} maxLength={160}
    className="min-w-0 w-full rounded border border-input bg-background px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ring"
    onChange={(e) => setName(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(title); setEditing(false); } }} />
    : <button type="button" className="max-w-full truncate rounded text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" title="Rename draft (does not change the printed subject)" onClick={() => { setName(title); setEditing(true); }}>{title}</button>;
}

export function DraftIdentity() {
  const id = useDocumentsStore((s) => s.currentId);
  const entry = useDocumentsStore((s) => id ? s.docs[id] : undefined);
  const title = entry?.meta.title ?? deriveTitle(getSerializedSession());
  return <div className="flex-1 min-w-0">
    <DraftName key={id} title={title} />
    <div className="mt-0.5 text-[11px] text-muted-foreground"><SaveStatus />{!entry && <span>New draft · Local workspace</span>}</div>
  </div>;
}
