import { Plus, Trash2, Undo2, Pin, PinOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

  if (!isMobile) return null;

  // Pinned docs float to the top; the rest follow most-recent order.
  const metas = Object.values(docs)
    .map((d) => d.meta)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
            <DialogTitle className="text-base">Documents</DialogTitle>
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
              { label: 'Search', run: () => useUIStore.getState().setCommandPaletteOpen(true) },
              { label: 'Templates', run: () => useUIStore.getState().setTemplateLoaderOpen(true) },
              { label: 'Profiles', run: () => useUIStore.getState().setProfileModalOpen(true) },
              { label: 'Settings', run: () => useUIStore.getState().setSettingsOpen(true) },
              { label: 'Help', run: () => useUIStore.getState().setHelpOpen(true) },
            ].map(({ label, run }) => <button key={label} type="button" className="min-h-11 rounded px-2 text-sm hover:bg-muted" onClick={() => { setOpen(false); run(); }}>{label}</button>)}
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

          <button type="button" className="mx-4 mt-2 min-h-10 text-sm text-left" onClick={() => { setOpen(false); useUIStore.getState().setTrashOpen(true); }}>Open Trash</button>
          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {metas.length === 0 ? (
              <li className="px-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">Nothing here yet — start your first document.</p>
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
                    <button
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
                          className={`block truncate text-sm ${active ? 'text-primary' : 'text-foreground'}`}
                        >
                          {m.title}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground tnum">
                          {relTime(m.updatedAt)}
                        </span>
                      </span>
                      {m.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-label="Pinned" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(m.id)}
                      aria-label={m.pinned ? `Unpin ${m.title}` : `Pin ${m.title}`}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      aria-label={`Remove ${m.title}`}
                      className="ml-0.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
