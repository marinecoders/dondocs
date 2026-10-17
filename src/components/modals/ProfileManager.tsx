import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, Download, MoreHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SessionChanges } from '@/components/SessionChanges';
import { useProfileStore } from '@/stores/profileStore';
import { useDocumentStore, getSerializedSession, type SerializedSession } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { showAppAlert, showAppConfirm } from '@/stores/alertStore';
import { debug } from '@/lib/debug';
import { profileFormPatch, useDocumentsStore } from '@/stores/documentsStore';
import { readFileAsText, triggerDownload } from '@/lib/encoding';
import { parseProfileImport } from '@/lib/profileImport';

export function ProfileManager() {
  const open = useUIStore((s) => s.profileManagerOpen);
  // Unmount transient list/review state on close; keep it while editing a profile.
  return open ? <ProfileManagerContent /> : null;
}

function ProfileManagerContent() {
  const { profiles, selectedProfile, selectProfile, deleteProfile, importProfiles } = useProfileStore();
  const editing = useUIStore((s) => s.profileModalOpen);
  const isCorrespondence = useDocumentStore((s) => s.documentCategory === 'correspondence');
  const [pending, setPending] = useState<{ name: string; before: SerializedSession; after: SerializedSession } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const profileNames = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  const visibleNames = profileNames.filter((name) => `${name} ${profiles[name].unitLine1}`.toLowerCase().includes(query.toLowerCase()));
  const setDefault = (name: string | null) => {
    try { selectProfile(name); setStatus(name ? `New correspondence will use ${name}.` : 'New correspondence will start without a profile.'); }
    catch { showAppAlert({ title: 'Could not save profile preference', message: 'Check browser storage and try again.' }); }
  };
  const handleProfileChange = (name: string) => {
    setApplyError('');
    const profile = profiles[name];
    if (!profile) return;
    const before = getSerializedSession();
    setPending({ name, before, after: { ...before, formData: { ...before.formData, ...profileFormPatch(profile) } } });
  };
  const applyProfile = async () => {
    if (!pending) return;
    setApplying(true);
    try {
      const restored = await useDocumentsStore.getState().restoreSnapshot(pending.after);
      if (!restored) { setApplyError('Could not save a recovery version. Your document has not changed.'); return; }
      selectProfile(pending.name);
      setPending(null);
      setStatus(`Applied ${pending.name}.`);
    } catch {
      setApplyError('Could not save the profile preference. Check browser storage and try again.');
    } finally { setApplying(false); }
  };

  const handleDelete = async (name: string) => {
    const confirmed = await showAppConfirm({
      title: 'Delete profile?',
      message: `"${name}" will be removed. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (confirmed) {
      try {
        deleteProfile(name);
      } catch (err) {
        showAppAlert({ title: "Couldn't delete profile", message: err instanceof Error ? err.message : 'Check browser storage and try again.' });
      }
    }
  };

  const handleExport = () => {
    try {
      const data = JSON.stringify({ version: '1.0', profiles }, null, 2);
      triggerDownload(new TextEncoder().encode(data), `dondocs-profiles-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    } catch {
      showAppAlert({ title: "Couldn't export profiles", message: 'Please try downloading again.' });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    debug.log('Profile', 'Importing profiles', { filename: file.name, size: file.size });

    try {
      const text = await readFileAsText(file);
      const imported = parseProfileImport(JSON.parse(text));
      const duplicates = Object.keys(imported).filter((name) => Object.hasOwn(profiles, name));
      if (duplicates.length && !await showAppConfirm({
        title: 'Replace existing profiles?',
        message: `This file replaces ${duplicates.length} saved profile(s) with matching names. Your current document stays unchanged.`,
        confirmLabel: 'Replace profiles',
      })) return;
      importProfiles(imported);
      setStatus(`Imported ${Object.keys(imported).length} profile(s).`);
    } catch (err) {
      debug.error('Profile', 'Failed to import profiles', err);
      showAppAlert({
        title: "Couldn't import profiles",
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      e.target.value = '';
    }
  };


  return <Dialog open={!editing} onOpenChange={(open) => {
    if (!open && !applying) {
      if (pending) setPending(null);
      else useUIStore.getState().setProfileManagerOpen(false);
    }
  }}>
    <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col gap-0 overflow-hidden p-0" onCloseAutoFocus={(event) => { event.preventDefault(); if (!editing && opener?.isConnected) opener.focus(); }}>
      <DialogHeader className="border-b px-5 py-5 pr-14 text-left">
        <DialogTitle>{pending ? `Apply ${pending.name}` : 'Profiles'}</DialogTitle>
        <DialogDescription>{pending
          ? 'Review the changes below. A recovery version is saved first; your document text stays intact. This also becomes your default for new correspondence.'
          : 'Saved letterhead and sender details for your correspondence.'}</DialogDescription>
      </DialogHeader>
      {pending ? <>
        <div className="min-h-0 overflow-y-auto p-5"><SessionChanges before={pending.before} after={pending.after} /></div>
        {applyError && <p role="alert" className="px-5 pb-3 text-sm text-destructive">{applyError}</p>}
        <DialogFooter className="border-t p-4"><Button variant="outline" disabled={applying} onClick={() => setPending(null)}>Back to profiles</Button><Button disabled={applying} onClick={() => void applyProfile()}>{applying ? 'Applying…' : 'Apply profile'}</Button></DialogFooter>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-xs text-muted-foreground">{profileNames.length} saved {profileNames.length === 1 ? 'profile' : 'profiles'}</p>
          <Button size="sm" data-tour="profile-create" onClick={() => useUIStore.getState().openProfileEditor(null)}><Plus className="h-4 w-4" />New profile</Button>
        </div>
        {profileNames.length > 5 && <div className="px-5 pb-3"><Input aria-label="Search profiles" placeholder="Search profiles…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>}
        {!isCorrespondence && <p className="px-5 pb-3 text-sm text-muted-foreground">Profiles apply to correspondence. You can manage them here while working on a form.</p>}
        <div data-tour="profiles" className="min-h-0 overflow-y-auto px-5">
          {!visibleNames.length && <p className="py-8 text-center text-sm text-muted-foreground">{profileNames.length ? 'No matching profiles.' : 'No profiles yet. Save your letterhead once and reuse it.'}</p>}
          <ul className="divide-y divide-border">
            {visibleNames.map((name) => <li key={name} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <p className="break-words text-sm font-medium">{name}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{profiles[name].from || profiles[name].unitAddress || 'No sender details yet'}</p>
                {selectedProfile === name && <p className="mt-1 text-xs text-primary">Default for new correspondence</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isCorrespondence && <Button size="sm" variant="outline" aria-label={`Apply ${name}`} onClick={() => handleProfileChange(name)}>Apply</Button>}
                <Button size="sm" variant="ghost" aria-label={`Edit ${name}`} onClick={() => useUIStore.getState().openProfileEditor(name)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More options for ${name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={selectedProfile === name} onSelect={() => setDefault(name)}>Use for new correspondence</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void handleDelete(name)}><Trash2 className="h-4 w-4" />Delete profile</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>)}
          </ul>
        </div>
        <div className="space-y-2 border-t bg-muted/20 px-5 py-3">
          <p className="text-xs text-muted-foreground">{selectedProfile ? 'Your default fills in new correspondence only.' : 'New correspondence starts without a profile.'} {selectedProfile && <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setDefault(null)}>Start blank instead</button>}</p>
          <p role="status" className="text-xs text-muted-foreground">{status}</p>
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5" />Import</Button>
            <Button variant="ghost" size="sm" onClick={handleExport} disabled={!profileNames.length}><Download className="h-3.5 w-3.5" />Export all</Button>
            <input ref={inputRef} type="file" accept=".json" aria-label="Import profiles" onChange={handleImport} className="hidden" />
          </div>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
