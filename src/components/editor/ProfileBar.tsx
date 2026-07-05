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
import { useDocumentStore } from '@/stores/documentStore';
import { SaveStatus } from '@/components/SaveStatus';
import { useUIStore } from '@/stores/uiStore';
import { showAppAlert, showAppConfirm } from '@/stores/alertStore';
import { debug } from '@/lib/debug';
import { profileFormPatch } from '@/stores/documentsStore';
import { readFileAsText, triggerDownload } from '@/lib/encoding';

// Example form data for one-time mode (no profile)
const EXAMPLE_FORM_DATA = {
  department: 'usmc',
  unitLine1: '1ST BATTALION, 6TH MARINES',
  unitLine2: '2D MARINE DIVISION, II MEF',
  unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
  ssic: '1000',
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  sigFirst: 'John',
  sigMiddle: 'A',
  sigLast: 'DOE',
  sigRank: 'Lieutenant Colonel',
  sigTitle: 'Commanding Officer',
  byDirection: false,
  byDirectionAuthority: '',
  cuiControlledBy: '',
  pocEmail: 'john.doe@usmc.mil',
};

export function ProfileBar() {
  const { profiles, selectedProfile, selectProfile, deleteProfile, importProfiles } = useProfileStore();
  const { setFormData } = useDocumentStore();
  const setProfileModalOpen = useUIStore((s) => s.setProfileModalOpen);

  const profileNames = Object.keys(profiles).sort();

  const handleProfileChange = (name: string) => {
    // selectProfile persists the whole profile blob via compressedLocalStorage,
    // which rethrows on quota — guard so switching profiles under storage
    // pressure degrades (logs) instead of throwing out of the event handler.
    try {
      if (name === '__none__') {
        selectProfile(null);
        // Only seed the example letterhead when the document is still pristine,
        // so picking "No Profile" mid-edit never overwrites work already typed.
        const ds = useDocumentStore.getState();
        const subject = (ds.formData.subject ?? '').trim();
        const pristine =
          (!subject || /^\[.*\]$/.test(subject)) &&
          ds.paragraphs.every((p) => !(p.text ?? '').trim());
        if (pristine) setFormData(EXAMPLE_FORM_DATA);
        return;
      }
      selectProfile(name);
      const profile = profiles[name];
      if (profile) {
        // Shared mapper — applies the signature block only when the profile has
        // a signer, so picking the signer-less default profile from this
        // dropdown no longer blanks an existing signature (matches the New-doc
        // path in applySelectedProfile).
        setFormData(profileFormPatch(profile));
      }
    } catch (err) {
      debug.error('Profile', 'Failed to switch profile (storage may be full)', err);
    }
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
    <div data-tour="profiles" className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-secondary/20">
      <Select value={selectedProfile || '__none__'} onValueChange={handleProfileChange}>
        <SelectTrigger size="sm" className="w-[200px] text-xs">
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

      <SaveStatus />
    </div>
  );
}
