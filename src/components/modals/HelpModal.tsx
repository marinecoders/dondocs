import { useId } from 'react';
import { BookOpen, FolderSync, Trash2, Compass, ListChecks, Bug, MessageSquare, Code, FileText, Activity, ShieldCheck, Download, ChevronRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

function HelpRow({ icon: Icon, label, description, onClick, href }: {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick?: () => void;
  href?: string;
}) {
  const descriptionId = useId();
  const className = 'group flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const content = <>
    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium">{label}</span>
      {description && <span id={descriptionId} className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>}
    </span>
    {href ? <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
  </>;
  return href
    ? <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} aria-describedby={description ? descriptionId : undefined}>{content}</a>
    : <button type="button" className={className} onClick={onClick} aria-label={label} aria-describedby={description ? descriptionId : undefined}>{content}</button>;
}

export function HelpModal() {
  const checklistCelebrated = useOnboardingStore((s) => s.checklistCelebrated);
  const installed = useInstallStore((s) => s.isInstalled);
  const open = useUIStore((s) => s.helpOpen);
  const navigate = (action: () => void) => { useUIStore.getState().setHelpOpen(false); action(); };
  return <Dialog open={open} onOpenChange={(value) => useUIStore.getState().setHelpOpen(value)}>
    <DialogContent className="flex h-[min(40rem,85dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
      <DialogHeader className="shrink-0 px-5 pt-5 pb-4 pr-14 text-left sm:px-6 sm:pr-14">
        <DialogTitle>Help</DialogTitle>
        <DialogDescription>Guidance and support for your workspace.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="resources" className="min-h-0 flex-1 gap-0 overflow-hidden">
        <TabsList aria-label="Help topics" className="mx-5 mb-3 grid h-12 w-auto shrink-0 grid-cols-3 rounded-md sm:mx-6">
          <TabsTrigger value="resources" className="min-h-11 border-transparent">Resources</TabsTrigger>
          <TabsTrigger value="shortcuts" className="min-h-11 border-transparent">Shortcuts</TabsTrigger>
          <TabsTrigger value="support" className="min-h-11 border-transparent">Support</TabsTrigger>
        </TabsList>
        <TabsContent value="resources" className="min-h-0 overflow-y-auto px-3 pb-4 sm:px-4">
          <HelpRow icon={BookOpen} label="Document type guide" description="Find the right format and its requirements." onClick={() => navigate(() => useUIStore.getState().setDocumentGuideOpen(true))} />
          <HelpRow icon={FolderSync} label="Backup & restore" description="Keep an external copy of your workspace." onClick={() => navigate(() => useUIStore.getState().setSettingsOpen(true, 'backup'))} />
          <HelpRow icon={Trash2} label="Recover deleted drafts" description="Find and restore documents in Trash." onClick={() => navigate(() => useUIStore.getState().setTrashOpen(true))} />
          <div className="mx-3 my-2 border-t border-border" />
          {!checklistCelebrated && <HelpRow icon={ListChecks} label="Getting started" onClick={() => navigate(() => useUIStore.getState().setChecklistSheetOpen(true))} />}
          <HelpRow icon={Compass} label="Take optional tour" onClick={() => navigate(() => useTourStore.getState().start())} />
          <div className="mx-3 mt-3 space-y-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            <p><span className="font-medium text-foreground">Editing views.</span> Use View to choose Full document or One section. In Full document, Contents jumps to a section.</p>
            <p>Required-field checks identify incomplete sections. Review the generated output before sharing or downloading.</p>
          </div>
        </TabsContent>
        <TabsContent value="shortcuts" className="min-h-0 overflow-y-auto px-6 pb-5">
          <h3 className="mb-2 text-sm font-medium">Keyboard shortcuts</h3>
          <dl className="divide-y divide-border text-sm">
            {shortcuts.map(([label, keys]) => <div key={label} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <dt>{label}</dt><dd className="shrink-0"><kbd className="inline-flex min-w-12 justify-center rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{formatShortcut(keys)}</kbd></dd>
            </div>)}
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Drafts autosave in this browser. Save checkpoint keeps one manual copy; Open saved checkpoint reviews it before opening a separate draft.</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">A share link is a password-protected snapshot. Attached files and images are excluded.</p>
        </TabsContent>
        <TabsContent value="support" className="min-h-0 overflow-y-auto px-3 pb-4 sm:px-4">
          <HelpRow icon={Bug} label="Report bug" description="Describe a problem with DonDocs." href={buildBugReportUrl()} />
          <HelpRow icon={MessageSquare} label="Suggest feature" description="Share an idea for improving the workspace." href={buildFeatureRequestUrl()} />
          <HelpRow icon={Code} label="GitHub project" href={GITHUB_REPO_URL} />
          <p className="mx-3 mt-1 mb-4 text-xs leading-relaxed text-muted-foreground">Reports open a draft on public GitHub for you to review and submit. Document text and logs are not attached automatically.</p>
          {!installed && <HelpRow icon={Download} label="Install app" onClick={() => void promptInstall()} />}
          <section aria-labelledby="help-diagnostics" className="mt-2 border-t border-border pt-3">
            <h3 id="help-diagnostics" className="px-3 pb-1 text-xs font-medium text-muted-foreground">Diagnostics</h3>
            <HelpRow icon={FileText} label="View logs" onClick={() => navigate(() => useLogStore.getState().setOpen(true))} />
            <HelpRow icon={Activity} label="Endpoint check" onClick={() => navigate(() => useUIStore.getState().setConnectivityModalOpen(true))} />
            <HelpRow icon={ShieldCheck} label="NIST 800-171" onClick={() => navigate(() => useUIStore.getState().setNistModalOpen(true))} />
          </section>
        </TabsContent>
      </Tabs>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 border-t border-border px-3 py-1.5 sm:px-4">
        <Button variant="ghost" className="min-h-11 px-3 text-xs text-muted-foreground" onClick={() => navigate(() => useUIStore.getState().setAboutModalOpen(true))}>About DonDocs</Button>
        <Button variant="ghost" className="min-h-11 px-3 text-xs text-muted-foreground" onClick={() => navigate(() => useUIStore.getState().setWelcomeOpen(true))}>Welcome letter</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
