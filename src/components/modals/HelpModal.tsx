import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { formatShortcut, isMac } from '@/lib/platform';

const shortcuts = [
  ['Search workspace', 'mod K'], ['Save a checkpoint', 'mod S'],
  ['Download PDF', 'mod D'], ['Find and replace', 'mod H'],
  ['Toggle preview', 'mod E'], ['Undo', 'mod Z'], ['Redo', isMac ? 'mod shift Z' : 'mod Y'],
];

export function HelpModal() {
  const open = useUIStore((s) => s.helpOpen);
  const navigate = (action: () => void) => { useUIStore.getState().setHelpOpen(false); action(); };
  return <Dialog open={open} onOpenChange={(value) => useUIStore.getState().setHelpOpen(value)}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader className="pr-8"><DialogTitle>Help</DialogTitle><DialogDescription>Document guidance, keyboard shortcuts, and recovery.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setDocumentGuideOpen(true))}>Document type guide</Button>
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setSettingsOpen(true, 'backup'))}>Backup & restore</Button>
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setTrashOpen(true))}>Recover deleted drafts</Button>
      </div>
      <p className="text-sm text-muted-foreground">Use Contents to reach document sections. Required-field checks identify incomplete sections; review the generated output before sharing or downloading.</p>
      <section aria-labelledby="help-shortcuts" className="space-y-3">
        <h3 id="help-shortcuts" className="font-medium">Keyboard shortcuts</h3>
        <dl className="space-y-2 text-sm">{shortcuts.map(([label, keys]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="font-mono text-muted-foreground">{formatShortcut(keys)}</dd></div>)}</dl>
      </section>
      <p className="text-xs text-muted-foreground">Saved drafts live in this browser. A share link is a password-protected snapshot; attached files and images are excluded.</p>
      <Button variant="ghost" className="justify-self-start" onClick={() => navigate(() => useUIStore.getState().setAboutModalOpen(true))}>About DonDocs</Button>
    </DialogContent>
  </Dialog>;
}
