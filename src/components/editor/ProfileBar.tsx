import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SessionChanges } from '@/components/SessionChanges';
import { Plus, Pencil, Trash2, Upload, Download, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTip } from '@/components/ui/icon-tip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProfileStore } from '@/stores/profileStore';
import { getSerializedSession, type SerializedSession } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { showAppAlert, showAppConfirm } from '@/stores/alertStore';
import { debug } from '@/lib/debug';
import { profileFormPatch, useDocumentsStore } from '@/stores/documentsStore';
import { readFileAsText, triggerDownload } from '@/lib/encoding';

export function ProfileBar() {
  const { profiles, selectedProfile, selectProfile, deleteProfile, importProfiles } = useProfileStore();
  const [pending, setPending] = useState<{ name: string; before: SerializedSession; after: SerializedSession } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const setProfileModalOpen = useUIStore((s) => s.setProfileModalOpen);

  const profileNames = Object.keys(profiles).sort();

  const handleProfileChange = (name: string) => {
    setApplyError('');
    if (name === '__none__') {
      try { selectProfile(null); }
      catch { showAppAlert({ title: 'Could not save profile preference', message: 'Browser storage is full. Your document has not changed.' }); }
      return;
    }
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
    } catch {
      setApplyError('Could not save the profile preference. Check browser storage and try again.');
    } finally { setApplying(false); }
  };

  const handleDelete = async () => {
    if (!selectedProfile) return;
    const confirmed = await showAppConfirm({
      title: 'Delete profile?',
      message: `"${selectedProfile}" will be removed. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (confirmed) {
      try {
        deleteProfile(selectedProfile);
      } catch (err) {
        debug.error('Profile', 'Failed to delete profile (storage may be full)', err);
      }
    }
  };

  const handleExport = () => {
    debug.log('Profile', 'Exporting profiles', { count: Object.keys(profiles).length });
    const data = JSON.stringify({ version: '1.0', profiles }, null, 2);
    const filename = `dondocs-profiles-${new Date().toISOString().split('T')[0]}.json`;
    triggerDownload(new TextEncoder().encode(data), filename, 'application/json');
    debug.log('Profile', 'Export complete', { filename });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    debug.log('Profile', 'Importing profiles', { filename: file.name, size: file.size });

    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);

      if (!data.profiles || typeof data.profiles !== 'object') {
        throw new Error('Invalid profile file format: missing profiles object');
      }

      const profileCount = Object.keys(data.profiles).length;
      importProfiles(data.profiles);
      debug.log('Profile', 'Import successful', { count: profileCount });
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

  return (
    <>
    <div data-tour="profiles" className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-border bg-secondary/20">
      <Select value={selectedProfile || '__none__'} onValueChange={handleProfileChange}>
        <SelectTrigger size="sm" aria-label="Apply profile" className="w-[180px] max-w-full text-xs">
          <SelectValue placeholder="Select profile" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No profile</SelectItem>
          {profileNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <IconTip label="Create profile">
        <Button
          data-tour="profile-create"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            // selectProfile persists via compressedLocalStorage, which rethrows on
            // quota — guard so a near-full store degrades (logs) instead of throwing
            // out of the click handler into the ErrorBoundary. The modal still opens.
            try {
              selectProfile(null);
            } catch (err) {
              debug.error('Profile', 'Failed to clear profile selection (storage may be full)', err);
            }
            setProfileModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </IconTip>

      <IconTip label="Edit profile">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setProfileModalOpen(true)}
          disabled={!selectedProfile}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </IconTip>

      <DropdownMenu>
        <IconTip label="More options">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </IconTip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={handleDelete}
            disabled={!selectedProfile}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export profiles
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              Import profiles
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </label>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />


    </div>
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !applying) setPending(null); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader><DialogTitle>Apply {pending?.name}</DialogTitle><DialogDescription>Review the fields this profile changes. A recovery version is saved first; your document text stays intact.</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto">{pending && <SessionChanges before={pending.before} after={pending.after} />}</div>
        {applyError && <p role="alert" className="text-sm text-destructive">{applyError}</p>}
        <DialogFooter><Button variant="outline" disabled={applying} onClick={() => setPending(null)}>Cancel</Button><Button disabled={applying} onClick={() => void applyProfile()}>{applying ? 'Applying…' : 'Apply profile'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
