import { useRef, useState } from 'react';
import { WORKSPACE_DESTINATIONS } from './workspaceNavigation';
import { Plus, Trash2, Undo2, Pin, PinOff, Search, FileDown, MoreHorizontal, Pencil, Copy, History } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { docTypeChip } from '@/types/document';

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Mobile workspace library, opened from the document header in place of the
 * desktop sidebar. Includes workspace tools and document recovery actions.
 */
export function MobileRecents() {
  const isMobile = useUIStore((s) => s.isMobile);
  const open = useUIStore((s) => s.mobileDocsOpen);
  const setOpen = useUIStore((s) => s.setMobileDocsOpen);
  const docs = useDocumentsStore((s) => s.docs);
  const currentId = useDocumentsStore((s) => s.currentId);
  const newDocument = useDocumentsStore((s) => s.newDocument);
  const switchTo = useDocumentsStore((s) => s.switchTo);
  const remove = useDocumentsStore((s) => s.remove);
  const togglePin = useDocumentsStore((s) => s.togglePin);
  const pendingDelete = useDocumentsStore((s) => s.pendingDelete);
  const restoreDeleted = useDocumentsStore((s) => s.restoreDeleted);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const pendingRename = useRef<{ id: string; name: string } | null>(null);
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const finishRename = (id: string, restoreFocus: boolean) => {
    setRenamingId(null);
    if (restoreFocus) requestAnimationFrame(() => actionButtons.current.get(id)?.focus());
  };
  const commitName = (id: string, restoreFocus = false) => {
    useDocumentsStore.getState().renameDocument(id, name);
    finishRename(id, restoreFocus);
  };

  if (!isMobile) return null;

  // Pinned docs float to the top; the rest follow most-recent order.
  const metas = Object.values(docs)
    .map((d) => d.meta)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0" onEscapeKeyDown={(event) => {
          if (renamingId) { event.preventDefault(); finishRename(renamingId, true); }
        }}>
          <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
            <DialogTitle className="text-base">Documents</DialogTitle>
            <DialogDescription className="sr-only">Recent drafts and workspace tools.</DialogDescription>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="mr-6 inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs hover:bg-muted">
                  <Plus className="h-3.5 w-3.5" /> New document
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { newDocument(); setOpen(false); }}>New correspondence</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { newDocument('navmc_10274'); setOpen(false); }}>New NAVMC 10274</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { newDocument('navmc_118_11'); setOpen(false); }}>New NAVMC 118 (11)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogHeader>

          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {[
              { label: 'Search', icon: Search, run: () => useUIStore.getState().setCommandPaletteOpen(true) },
              { label: 'Templates', icon: FileDown, run: () => useUIStore.getState().setTemplateLoaderOpen(true) },
              ...WORKSPACE_DESTINATIONS,
            ].map(({ label, icon: Icon, run }) => <button key={label} data-tour={label === 'Templates' ? 'templates' : undefined} type="button" className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-muted" onClick={() => { setOpen(false); run(); }}><Icon className="h-4 w-4" />{label}</button>)}
          </div>
          {pendingDelete && (
            <div className="mx-2 mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Removed <span className="text-foreground">{pendingDelete.title}</span>
              </span>
              <button
                type="button"
                onClick={() => restoreDeleted()}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            </div>
          )}

          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {metas.length === 0 ? (
              <li className="px-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">No recent documents yet.</p>
                <button
                  type="button"
                  onClick={() => {
                    newDocument();
                    setOpen(false);
                  }}
                  className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" /> Start a naval letter
                </button>
              </li>
            ) : (
              metas.map((m) => {
                const active = m.id === currentId;
                return (
                  <li
                    key={m.id}
                    className={`flex items-center rounded-md pr-1 ${active ? 'bg-primary/10' : ''}`}
                  >
                    {renamingId === m.id ? <input autoFocus aria-label="Draft name" value={name} maxLength={160}
                      className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-3 text-sm"
                      onChange={(e) => setName(e.target.value)} onBlur={() => commitName(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(m.id, true); } if (e.key === 'Escape') { e.stopPropagation(); finishRename(m.id, true); } }}
                    /> : <button
                      type="button"
                      onClick={() => {
                        switchTo(m.id);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-5 shrink-0 items-center justify-center rounded px-1 text-2xs font-semibold uppercase leading-none tracking-wide ${
                          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                        }`}
                        style={{ minWidth: '2.6rem' }}
                      >
                        {docTypeChip(m.docType)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          title={m.title}
                          className={`workspace-document-title text-sm leading-5 ${active ? 'text-primary' : 'text-foreground'}`}
                        >
                          {m.title}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground tnum">
                          {relTime(m.updatedAt)}
                        </span>
                      </span>
                      {m.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-label="Pinned" />}
                    </button>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button ref={(node) => { if (node) actionButtons.current.set(m.id, node); else actionButtons.current.delete(m.id); }} type="button" aria-label={`Actions for ${m.title}`} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64 [&_[role=menuitem]]:min-h-11" onCloseAutoFocus={(event) => {
                        const pending = pendingRename.current;
                        if (pending) {
                          event.preventDefault();
                          pendingRename.current = null;
                          setName(pending.name);
                          setRenamingId(pending.id);
                        }
                      }}>
                        <DropdownMenuLabel className="break-words whitespace-normal text-xs font-normal text-muted-foreground">{m.title}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => togglePin(m.id)}>{m.pinned ? <PinOff /> : <Pin />}{m.pinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { pendingRename.current = { id: m.id, name: m.name ?? m.title }; }}><Pencil />Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { useDocumentsStore.getState().duplicateDocument(m.id); setOpen(false); }}><Copy />Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { switchTo(m.id); setOpen(false); useUIStore.getState().setHistoryDocId(m.id); }}><History />Version history</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(m.id)}><Trash2 />Move to Trash</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
