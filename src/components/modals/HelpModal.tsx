import { useTourStore } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { formatShortcut, isMac } from '@/lib/platform';

import { useLogStore } from '@/stores/logStore';
import { useInstallStore } from '@/stores/installStore';
import { promptInstall } from '@/hooks/useInstallPrompt';
import { buildBugReportUrl, buildFeatureRequestUrl, GITHUB_REPO_URL } from '@/lib/supportLinks';

const shortcuts = [
  ['Search workspace', 'mod K'], ['Save a checkpoint', 'mod S'],
  ['Download PDF', 'mod D'], ['Find and replace', 'mod H'],
  ['Toggle preview', 'mod E'], ['Undo', 'mod Z'], ['Redo', isMac ? 'mod shift Z' : 'mod Y'],
];

export function HelpModal() {
  const checklistCelebrated = useOnboardingStore((s) => s.checklistCelebrated);
  const installed = useInstallStore((s) => s.isInstalled);
  const open = useUIStore((s) => s.helpOpen);
  const navigate = (action: () => void) => { useUIStore.getState().setHelpOpen(false); action(); };
  return <Dialog open={open} onOpenChange={(value) => useUIStore.getState().setHelpOpen(value)}>
    <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
      <DialogHeader className="pr-8"><DialogTitle>Help</DialogTitle><DialogDescription>Document guidance, keyboard shortcuts, and recovery.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setDocumentGuideOpen(true))}>Document type guide</Button>
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setSettingsOpen(true, 'backup'))}>Backup & restore</Button>
        <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setTrashOpen(true))}>Recover deleted drafts</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate(() => useTourStore.getState().start())}>Take optional tour</Button>
        {!checklistCelebrated && <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setChecklistSheetOpen(true))}>Getting started</Button>}
      </div>
      <p className="text-sm text-muted-foreground">Use Contents to reach document sections. Scroll shows the full editor; Focused shows one section at a time. Required-field checks identify incomplete sections; review the generated output before sharing or downloading.</p>
      <section aria-labelledby="help-shortcuts" className="space-y-3">
        <h3 id="help-shortcuts" className="font-medium">Keyboard shortcuts</h3>
        <dl className="space-y-2 text-sm">{shortcuts.map(([label, keys]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="font-mono text-muted-foreground">{formatShortcut(keys)}</dd></div>)}</dl>
      </section>
      <p className="text-xs text-muted-foreground">Drafts autosave in this browser. Save checkpoint keeps one manual copy; Open saved checkpoint reviews it before opening a separate draft. A share link is a password-protected snapshot; attached files and images are excluded.</p>
      <section aria-labelledby="help-support" className="space-y-3">
        <h3 id="help-support" className="font-medium">Support & diagnostics</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate(() => useLogStore.getState().setOpen(true))}>View logs</Button>
          <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setConnectivityModalOpen(true))}>Endpoint check</Button>
          <Button variant="outline" onClick={() => navigate(() => useUIStore.getState().setNistModalOpen(true))}>NIST 800-171</Button>
          {!installed && <Button variant="outline" onClick={() => void promptInstall()}>Install app</Button>}
          <Button variant="outline" onClick={() => window.open(buildBugReportUrl(), '_blank', 'noopener,noreferrer')}>Report bug</Button>
          <Button variant="outline" onClick={() => window.open(buildFeatureRequestUrl(), '_blank', 'noopener,noreferrer')}>Suggest feature</Button>
          <Button variant="outline" onClick={() => window.open(GITHUB_REPO_URL, '_blank', 'noopener,noreferrer')}>GitHub project</Button>
        </div>
        <p className="text-xs text-muted-foreground">Reports open a draft on public GitHub for you to review and submit. Document text and logs are not attached automatically.</p>
      </section>
      <Button variant="ghost" className="justify-self-start" onClick={() => navigate(() => useUIStore.getState().setAboutModalOpen(true))}>About DonDocs</Button>
      <Button variant="ghost" className="justify-self-start" onClick={() => navigate(() => useUIStore.getState().setWelcomeOpen(true))}>Welcome letter</Button>
    </DialogContent>
  </Dialog>;
}
