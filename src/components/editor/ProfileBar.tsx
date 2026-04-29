import { Plus, Pencil, Trash2, Upload, Download, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useUIStore } from '@/stores/uiStore';
import { debug } from '@/lib/debug';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
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
  // Individual selectors so we only re-render when autoSaveStatus string
  // actually changes, not on every unrelated UI store field update.
  const setProfileModalOpen = useUIStore((s) => s.setProfileModalOpen);
  const autoSaveStatus = useUIStore((s) => s.autoSaveStatus);

  const profileNames = Object.keys(profiles).sort();

  const handleProfileChange = (name: string) => {
    if (name === '__none__') {
      selectProfile(null);
      // Load example data for one-time mode
      setFormData(EXAMPLE_FORM_DATA);
      return;
    }
    selectProfile(name);
    const profile = profiles[name];
    if (profile) {
      setFormData({
        department: profile.department,
        unitLine1: profile.unitLine1,
        unitLine2: profile.unitLine2,
        // Canonicalize on read (see App.tsx for rationale).
        unitAddress: canonicalizeUnitAddress(profile.unitAddress),
        ssic: profile.ssic,
        from: profile.from,
        sigFirst: profile.sigFirst,
        sigMiddle: profile.sigMiddle,
        sigLast: profile.sigLast,
        sigRank: profile.sigRank,
        sigTitle: profile.sigTitle,
        byDirection: profile.byDirection,
        byDirectionAuthority: profile.byDirectionAuthority,
        cuiControlledBy: profile.cuiControlledBy,
        pocEmail: profile.pocEmail,
        signatureImage: profile.signatureImage,
      });
    }
  };

  const handleDelete = () => {
    if (!selectedProfile) return;
    if (confirm(`Delete profile "${selectedProfile}"?`)) {
      deleteProfile(selectedProfile);
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
      alert(`Failed to import profiles: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-secondary/20">
      <Select value={selectedProfile || '__none__'} onValueChange={handleProfileChange}>
        <SelectTrigger className="w-40 h-7 text-xs">
          <SelectValue placeholder="Select Profile" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No Profile</SelectItem>
          {profileNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => {
          selectProfile(null);
          setProfileModalOpen(true);
        }}
        title="Create New Profile"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setProfileModalOpen(true)}
        disabled={!selectedProfile}
        title="Edit Profile"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="More profile options">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={handleDelete}
            disabled={!selectedProfile}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export Profiles
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              Import Profiles
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

      {autoSaveStatus && (
        <span className="text-xs text-muted-foreground">{autoSaveStatus}</span>
      )}
    </div>
  );
}
