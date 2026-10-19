import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentsStore, searchableText } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { showAppConfirm } from '@/stores/alertStore';

export function TrashModal() {
  const open = useUIStore((s) => s.trashOpen);
  const setOpen = useUIStore((s) => s.setTrashOpen);
  const trash = useDocumentsStore((s) => s.trash);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const entries = Object.values(trash).filter((e) => searchableText(e).includes(query.toLowerCase()))
    .sort((a, b) => (b.meta.deletedAt ?? 0) - (a.meta.deletedAt ?? 0));
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>Trash</DialogTitle><DialogDescription>
        Deleted documents and their versions stay on this device until you restore or permanently delete them. Backups include Trash. Clearing browser storage can remove them.
      </DialogDescription></DialogHeader>
      <Input aria-label="Search Trash" placeholder="Search deleted documents…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="max-h-[55vh] overflow-y-auto space-y-2">
        {!entries.length && <li className="py-8 text-sm text-center text-muted-foreground">{query ? 'No deleted documents match.' : 'Trash is empty.'}</li>}
        {entries.map((e) => <li key={e.meta.id} className="rounded-md border border-border p-3 space-y-2">
          <p className="font-medium break-words">{e.meta.title}</p>
          <p className="text-xs text-muted-foreground">Deleted {new Date(e.meta.deletedAt!).toLocaleString()}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => useDocumentsStore.getState().restoreFromTrash(e.meta.id)}>Restore</Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={async () => {
              if (!await showAppConfirm({ title: 'Permanently delete this document?', message: `“${e.meta.title}” and its version history will be removed from this browser. This cannot be undone. Existing backup files are not erased.`, confirmLabel: 'Delete permanently', destructive: true })) return;
              if (!await useDocumentsStore.getState().permanentlyDelete(e.meta.id)) setError('Could not delete the document. It remains in Trash; try again.');
            }}>Delete permanently</Button>
          </div>
        </li>)}
      </ul>
    </DialogContent>
  </Dialog>;
}
