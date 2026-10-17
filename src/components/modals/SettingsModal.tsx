import { useRef, useState, type ChangeEvent } from 'react';
import { Settings } from 'lucide-react';
import { THEMES } from '@/lib/appearance';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore, type DensityMode } from '@/stores/uiStore';
import { backupAction, useBackupStore } from '@/stores/backupStore';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
import { restoreBackup, summarizeRestore } from '@/lib/backup';

function BackupPreferences() {
  const backup = useBackupStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const action = backupAction(backup.status, backup.fileMissing);
  const run = async (operation: () => Promise<void>, success?: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try { await operation(); if (success) setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The backup operation failed. Try again.'); }
    finally { setBusy(false); }
  };
  const restore = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void run(async () => setMessage(summarizeRestore(await restoreBackup(await file.text()))));
  };
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">
      {backup.status === 'connected' ? `Auto-backup file: ${backup.fileName ?? 'Connected'}.`
        : backup.status === 'needs-permission' ? 'Auto-backup needs permission to write to your file again.'
        : backup.status === 'error' ? 'Auto-backup could not write your latest changes. Your backup may be out of date.'
        : backup.status === 'unsupported' ? 'This browser supports manual backup downloads. Automatic file backup is unavailable.'
        : 'Your work is stored in this browser. Keep an external backup to recover it if browser storage is cleared.'}
    </p>
    <div className="flex flex-wrap gap-2">
      {action && <Button variant="outline" disabled={busy} onClick={() => void run(action === 'reconnect' ? backup.reconnect : action === 'setup' ? backup.setupBackup : backup.writeNow)}>
        {action === 'reconnect' ? 'Reconnect auto-backup' : action === 'setup' ? 'Choose auto-backup file' : 'Retry auto-backup'}
      </Button>}
      {backup.status === 'connected' && <>
        <Button variant="outline" disabled={busy} onClick={() => void run(backup.writeNow)}>Back up now</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(backup.disable)}>Turn off auto-backup</Button>
      </>}
      <Button variant="outline" disabled={busy} onClick={() => void run(downloadWorkspaceBackup, 'Backup download started. Keep the downloaded file in a safe location.')}>Back up everything</Button>
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>Restore from backup</Button>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Backup file" onChange={restore} />
    </div>
    <p className="text-xs text-muted-foreground">Backups include documents, Trash, history, profiles, templates, and attached files. Download batch results separately. Restore keeps newer local document versions.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const theme = useUIStore((s) => s.theme);
  const editorLayout = useUIStore((s) => s.editorLayout);
  const density = useUIStore((s) => s.density);
  const fullQualityPreview = useUIStore((s) => s.fullQualityPreview);
  const selectedAppearance = useRef<HTMLInputElement>(null);
  const backupHeading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  return <Dialog open={open} onOpenChange={(value) => useUIStore.getState().setSettingsOpen(value)}>
    <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(event) => {
      const target = section === 'backup' ? backupHeading.current : section === 'preview' ? previewHeading.current : selectedAppearance.current;
      if (target) { event.preventDefault(); target.focus(); }
    }}>
      <DialogHeader className="pr-8">
        <DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Settings</DialogTitle>
        <DialogDescription>Workspace preferences are saved on this device.</DialogDescription>
      </DialogHeader>
      <section className="space-y-3" aria-label="Appearance">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Appearance</legend>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, description }) => <label key={value} className="relative cursor-pointer">
              <input ref={theme === value ? selectedAppearance : undefined} type="radio" name="appearance" value={value} aria-label={label} checked={theme === value}
                onChange={() => useUIStore.getState().setTheme(value)} className="peer sr-only" />
              <span className="block rounded-md border border-border p-2 peer-checked:border-ring peer-checked:ring-1 peer-checked:ring-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
                <span aria-hidden="true" className={`appearance-swatch appearance-swatch-${value}`}>
                  <span className="appearance-swatch-sidebar" />
                  <span className="appearance-swatch-page"><span /><span /><span /></span>
                </span>
                <span className="mt-2 block text-center text-sm font-medium">{label}</span>
              </span>
              <span className="sr-only">{description}</span>
            </label>)}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Classic restores the original navy-tinted surfaces and red accents. Appearance never changes your exported documents.</p>
        </fieldset>
        <label className="block space-y-2 text-sm"><span className="block font-medium">Density</span><select className="h-11 w-full rounded-md border border-input bg-background px-3" value={density} onChange={(e) => useUIStore.getState().setDensity(e.target.value as DensityMode)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
        <p className="text-xs text-muted-foreground">Density adjusts spacing between editor sections and field groups. Text and button sizes stay the same.</p>
        <label className="block space-y-2 text-sm"><span className="block font-medium">Editor layout</span><select className="h-11 w-full rounded-md border border-input bg-background px-3" value={editorLayout} onChange={(e) => useUIStore.getState().setEditorLayout(e.target.value === 'scroll' ? 'scroll' : 'focused')}><option value="focused">One section — edit a section at a time</option><option value="scroll">Full document — scroll through all sections</option></select></label>
        <p className="text-xs text-muted-foreground">Switch layouts anytime beside Contents. Your document and export stay the same.</p>
        <p className="text-xs text-muted-foreground">Animations follow your device’s reduced-motion preference.</p>
      </section>
      <section className="border-t pt-4 space-y-3" aria-labelledby="settings-preview">
        <h3 ref={previewHeading} id="settings-preview" tabIndex={-1} className="font-medium scroll-mt-4">Preview</h3>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={fullQualityPreview} onChange={(e) => useUIStore.getState().setFullQualityPreview(e.target.checked)} /><span><span className="block font-medium">Full-quality preview</span><span className="text-muted-foreground">Include enclosures, hyperlinks and signatures. Larger documents take longer to render.</span></span></label>
      </section>
      <section className="border-t pt-4 space-y-3" aria-labelledby="settings-backup">
        <h3 ref={backupHeading} id="settings-backup" tabIndex={-1} className="font-medium scroll-mt-4">Backup & restore</h3>
        <BackupPreferences />
      </section>
    </DialogContent>
  </Dialog>;
}
