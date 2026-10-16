import { useState, useRef } from 'react';
import { Copy, History, Link2, List, MoreHorizontal, PanelRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDocumentsStore, deriveTitle } from '@/stores/documentsStore';
import { getSerializedSession } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from './editorSections';
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
    : <button type="button" className="max-w-full truncate rounded text-left text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" title="Rename draft (does not change the printed subject)" onClick={() => { setName(title); setEditing(true); }}>{title}</button>;
}

export function WorkspaceBar() {
  const id = useDocumentsStore((s) => s.currentId);
  const entry = useDocumentsStore((s) => id ? s.docs[id] : undefined);
  const { sections } = useEditorSections();
  const pendingSection = useRef<string | null>(null);
  const active = useEditorOutlineStore((s) => s.activeId);
  const preview = useUIStore((s) => s.previewVisible);
  const mobile = useUIStore((s) => s.isMobile);
  const title = entry?.meta.title ?? deriveTitle(getSerializedSession());
  const checkpoint = () => { useDocumentsStore.getState().saveCurrent(); return useDocumentsStore.getState().currentId; };
  return <div className="border-b border-border px-3 sm:px-4 py-3 space-y-2 shrink-0">
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex-1 min-w-0"><DraftName key={id} title={title} /><div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>Draft name</span><SaveStatus /></div></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Document actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => useDocumentsStore.getState().newDocument()}><Plus />New correspondence</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useDocumentsStore.getState().newDocument('navmc_10274')}><Plus />New NAVMC 10274</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useDocumentsStore.getState().newDocument('navmc_118_11')}><Plus />New NAVMC 118 (11)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { const current = checkpoint(); if (current) useDocumentsStore.getState().duplicateDocument(current); }}><Copy />Duplicate draft</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { const current = checkpoint(); if (current) useUIStore.getState().setHistoryDocId(current); }}><History />Version history</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><List className="mr-1.5 h-4 w-4" />Contents</Button></DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[60vh] overflow-y-auto" onCloseAutoFocus={(e) => { if (pendingSection.current) { e.preventDefault(); useEditorOutlineStore.getState().jump(pendingSection.current); pendingSection.current = null; } }}>{sections.map((s) => <DropdownMenuItem key={s.id} onSelect={() => { pendingSection.current = s.id; }} aria-current={active === s.id ? 'location' : undefined}>{s.label}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={() => useUIStore.getState().setShareModal('share')}><Link2 className="mr-1.5 h-4 w-4" />Share</Button>
      <Button variant="ghost" size="sm" aria-pressed={!mobile && preview} onClick={() => mobile ? useUIStore.getState().setMobilePreviewOpen(true) : useUIStore.getState().togglePreview()}><PanelRight className="mr-1.5 h-4 w-4" />{!mobile && preview ? 'Hide preview' : 'Preview'}</Button>
    </div>
  </div>;
}
