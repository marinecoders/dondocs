import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Building2, BookOpen, Upload, FileImage } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { useDocumentStore } from '@/stores/documentStore';
import type { Profile, SignatureImage } from '@/types/document';
import type { UnitInfo } from '@/data/unitDirectory';
import { ALL_SERVICE_RANKS, formatRank } from '@/data/ranks';

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 to data URL for display
function base64ToDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

// Check if a rank value is a standard military rank
function isStandardMilitaryRank(rank: string): boolean {
  if (!rank) return true; // Empty is considered standard (will show dropdown)
  for (const service of ALL_SERVICE_RANKS) {
    for (const category of service.categories) {
      for (const r of category.ranks) {
        if (formatRank(r.abbrev, service.suffix) === rank) {
          return true;
        }
      }
    }
  }
  return false;
}

const EMPTY_PROFILE: Profile = {
  department: 'usmc',
  unitLine1: '',
  unitLine2: '',
  unitAddress: '',
  ssic: '',
  from: '',
  sigFirst: '',
  sigMiddle: '',
  sigLast: '',
  sigRank: '',
  sigTitle: '',
  byDirection: false,
  byDirectionAuthority: '',
  cuiControlledBy: '',
  pocEmail: '',
  signatureImage: undefined,
};

export function ProfileModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const profileModalOpen = useUIStore((s) => s.profileModalOpen);
  const setProfileModalOpen = useUIStore((s) => s.setProfileModalOpen);
  const { profiles, selectedProfile, addProfile, updateProfile, selectProfile } = useProfileStore();
  const { formData } = useDocumentStore();

  const [profileName, setProfileName] = useState('');
  const [formState, setFormState] = useState<Profile>(EMPTY_PROFILE);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showUnitLookup, setShowUnitLookup] = useState(false);
  const [showSSICLookup, setShowSSICLookup] = useState(false);
  const [useCustomRank, setUseCustomRank] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Store initial state to compare for changes
  const initialStateRef = useRef<{ name: string; profile: Profile }>({ name: '', profile: EMPTY_PROFILE });

  const isEditing = !!(selectedProfile && profiles[selectedProfile]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    const initial = initialStateRef.current;

    // Check profile name (only for new profiles)
    if (!isEditing && profileName !== initial.name) {
      return true;
    }

    // Check each field in formState
    const profileKeys = Object.keys(EMPTY_PROFILE) as (keyof Profile)[];
    for (const key of profileKeys) {
      const currentVal = formState[key];
      const initialVal = initial.profile[key];

      // Handle boolean comparison
      if (typeof currentVal === 'boolean' || typeof initialVal === 'boolean') {
        if (Boolean(currentVal) !== Boolean(initialVal)) {
          return true;
        }
      } else {
        // String comparison
        if ((currentVal || '') !== (initialVal || '')) {
          return true;
        }
      }
    }

    return false;
  }, [formState, profileName, isEditing]);

  // Populate form when modal opens (not on every formData change)
  useEffect(() => {
    if (profileModalOpen) {
      if (isEditing && selectedProfile) {
        const profile = profiles[selectedProfile];
        setProfileName(selectedProfile);
        setFormState({ ...EMPTY_PROFILE, ...profile });
        initialStateRef.current = { name: selectedProfile, profile: { ...EMPTY_PROFILE, ...profile } };
        // Detect if profile has a custom rank
        setUseCustomRank(!isStandardMilitaryRank(profile.sigRank || ''));
      } else {
        // Creating new - use current form data as defaults
        const newProfile: Profile = {
          department: formData.department || 'usmc',
          unitLine1: formData.unitLine1 || '',
          unitLine2: formData.unitLine2 || '',
          unitAddress: formData.unitAddress || '',
          ssic: formData.ssic || '',
          from: formData.from || '',
          sigFirst: formData.sigFirst || '',
          sigMiddle: formData.sigMiddle || '',
          sigLast: formData.sigLast || '',
          sigRank: formData.sigRank || '',
          sigTitle: formData.sigTitle || '',
          byDirection: formData.byDirection || false,
          byDirectionAuthority: formData.byDirectionAuthority || '',
          cuiControlledBy: formData.cuiControlledBy || '',
          pocEmail: formData.pocEmail || '',
          signatureImage: formData.signatureImage,
        };
        setProfileName('');
        setFormState(newProfile);
        initialStateRef.current = { name: '', profile: { ...newProfile } };
        // Detect if current form has a custom rank
        setUseCustomRank(!isStandardMilitaryRank(formData.sigRank || ''));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileModalOpen]);

  const handleSave = () => {
    if (!profileName.trim()) {
      alert('Please enter a profile name');
      return;
    }

    const trimmedName = profileName.trim();

    if (isEditing && selectedProfile) {
      updateProfile(selectedProfile, formState);
      // Also refresh the document form with the updated profile data
      useDocumentStore.getState().setFormData({
        department: formState.department,
        unitLine1: formState.unitLine1,
        unitLine2: formState.unitLine2,
        unitAddress: formState.unitAddress,
        ssic: formState.ssic,
        from: formState.from,
        sigFirst: formState.sigFirst,
        sigMiddle: formState.sigMiddle,
        sigLast: formState.sigLast,
        sigRank: formState.sigRank,
        sigTitle: formState.sigTitle,
        byDirection: formState.byDirection,
        byDirectionAuthority: formState.byDirectionAuthority,
        cuiControlledBy: formState.cuiControlledBy,
        pocEmail: formState.pocEmail,
        signatureImage: formState.signatureImage,
      });
    } else {
      addProfile(trimmedName, formState);
      // Auto-select the newly created profile and load its data
      selectProfile(trimmedName);
      // Load the profile data into the form
      useDocumentStore.getState().setFormData({
        department: formState.department,
        unitLine1: formState.unitLine1,
        unitLine2: formState.unitLine2,
        unitAddress: formState.unitAddress,
        ssic: formState.ssic,
        from: formState.from,
        sigFirst: formState.sigFirst,
        sigMiddle: formState.sigMiddle,
        sigLast: formState.sigLast,
        sigRank: formState.sigRank,
        sigTitle: formState.sigTitle,
        byDirection: formState.byDirection,
        byDirectionAuthority: formState.byDirectionAuthority,
        cuiControlledBy: formState.cuiControlledBy,
        pocEmail: formState.pocEmail,
        signatureImage: formState.signatureImage,
      });
    }

    setProfileModalOpen(false);
  };

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges()) {
      setShowDiscardDialog(true);
    } else {
      setProfileModalOpen(false);
    }
  }, [hasUnsavedChanges, setProfileModalOpen]);

  const handleDiscardConfirm = () => {
    setShowDiscardDialog(false);
    setProfileModalOpen(false);
  };

  const updateField = (field: keyof Profile, value: string | boolean | SignatureImage | undefined) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  // Generate preview URL from base64 signature
  const signaturePreviewUrl = useMemo(() => {
    if (!formState.signatureImage?.data) return null;
    return base64ToDataUrl(formState.signatureImage.data, 'image/png');
  }, [formState.signatureImage?.data]);

  // Handle signature image upload
  const handleSignatureUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      console.error('Only image files are supported');
      return;
    }

    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    const signatureImage: SignatureImage = {
      name: file.name,
      size: file.size,
      data: base64,
    };

    updateField('signatureImage', signatureImage);
  }, []);

  // Handle file input change for signature
  const handleSignatureFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSignatureUpload(file);
    }
    e.target.value = '';
  }, [handleSignatureUpload]);

  // Handle drag and drop for signature
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleSignatureUpload(file);
    }
  }, [handleSignatureUpload]);

  // Remove signature image
  const handleRemoveSignature = useCallback(() => {
    updateField('signatureImage', undefined);
  }, []);

  const handleUnitSelect = (unit: UnitInfo) => {
    setFormState((prev) => ({
      ...prev,
      unitLine1: unit.name.toUpperCase(),
      unitLine2: unit.parentUnit?.toUpperCase() || '',
      unitAddress: unit.address.replace(/\n/g, ', '),
    }));
  };

  return (
    <>
      <Dialog open={profileModalOpen} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
          showCloseButton={false}
        >
          {/* Sticky Header */}
          <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle>
                {isEditing ? 'Edit Profile' : 'Create New Profile'}
              </DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm opacity-70 hover:opacity-100"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </DialogHeader>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-4 px-6 py-4">
              <div className="space-y-2">
                <Label htmlFor="profileName">Profile Name</Label>
                <Input
                  id="profileName"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="e.g., My Command"
                  disabled={isEditing}
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium">Letterhead Information</h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUnitLookup(true)}
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    Browse Units
                  </Button>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Department / Service</Label>
                    <Select
                      value={formState.department || 'usmc'}
                      onValueChange={(v) => updateField('department', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usmc">United States Marine Corps</SelectItem>
                        <SelectItem value="navy">Department of the Navy</SelectItem>
                        <SelectItem value="dod">Department of Defense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unitLine1">Command Line 1</Label>
                    <Input
                      id="unitLine1"
                      value={formState.unitLine1}
                      onChange={(e) => updateField('unitLine1', e.target.value)}
                      placeholder="1ST BATTALION, 6TH MARINES"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unitLine2">Command Line 2</Label>
                    <Input
                      id="unitLine2"
                      value={formState.unitLine2}
                      onChange={(e) => updateField('unitLine2', e.target.value)}
                      placeholder="6TH MARINE REGIMENT"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unitAddress">Address</Label>
                    <Input
                      id="unitAddress"
                      value={formState.unitAddress}
                      onChange={(e) => updateField('unitAddress', e.target.value)}
                      placeholder="PSC BOX 20123, CAMP LEJEUNE, NC 28542"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Default Document Info</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ssic">Default SSIC</Label>
                    <div className="flex gap-2">
                      <Input
                        id="ssic"
                        value={formState.ssic}
                        onChange={(e) => updateField('ssic', e.target.value)}
                        placeholder="5216"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowSSICLookup(true)}
                        title="Browse SSIC Codes"
                      >
                        <BookOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="from">Default From</Label>
                    <Input
                      id="from"
                      value={formState.from}
                      onChange={(e) => updateField('from', e.target.value)}
                      placeholder="Commanding Officer, 1st Battalion, 6th Marines"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Signature Block</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="sigFirst">First Name</Label>
                    <Input
                      id="sigFirst"
                      value={formState.sigFirst}
                      onChange={(e) => updateField('sigFirst', e.target.value)}
                      placeholder="John"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigMiddle">Middle</Label>
                    <Input
                      id="sigMiddle"
                      value={formState.sigMiddle}
                      onChange={(e) => updateField('sigMiddle', e.target.value)}
                      placeholder="Q."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sigLast">Last Name</Label>
                    <Input
                      id="sigLast"
                      value={formState.sigLast}
                      onChange={(e) => updateField('sigLast', e.target.value)}
                      placeholder="SMITH"
                    />
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Button
                      type="button"
                      variant={!useCustomRank ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        if (useCustomRank) {
                          setUseCustomRank(false);
                          updateField('sigRank', '');
                        }
                      }}
                    >
                      Military
                    </Button>
                    <Button
                      type="button"
                      variant={useCustomRank ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        if (!useCustomRank) {
                          setUseCustomRank(true);
                          updateField('sigRank', '');
                        }
                      }}
                    >
                      Civilian / Other
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="sigRank">Rank / Title</Label>
                      {useCustomRank ? (
                        <Input
                          id="sigRank"
                          value={formState.sigRank || ''}
                          onChange={(e) => updateField('sigRank', e.target.value)}
                          placeholder="e.g., Mr., Ms., Dr., Contractor"
                        />
                      ) : (
                        <Select
                          value={formState.sigRank || ''}
                        onValueChange={(v) => updateField('sigRank', v)}
                      >
                        <SelectTrigger id="sigRank">
                          <SelectValue placeholder="Select rank..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {ALL_SERVICE_RANKS.map((service) => (
                            <SelectGroup key={service.suffix}>
                              <SelectLabel className="font-bold text-primary">
                                {service.service}
                              </SelectLabel>
                              {service.categories.map((category) => (
                                <SelectGroup key={`${service.suffix}-${category.name}`}>
                                  <SelectLabel className="text-muted-foreground pl-2">
                                    {category.name}
                                  </SelectLabel>
                                  {category.ranks.map((rank) => (
                                    <SelectItem
                                      key={`${service.suffix}-${rank.abbrev}`}
                                      value={formatRank(rank.abbrev, service.suffix)}
                                    >
                                      <span className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-muted-foreground w-10">
                                          {rank.grade}
                                        </span>
                                        <span>{rank.abbrev}</span>
                                        <span className="text-muted-foreground">- {rank.title}</span>
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sigTitle">Position</Label>
                      <Input
                        id="sigTitle"
                        value={formState.sigTitle}
                        onChange={(e) => updateField('sigTitle', e.target.value)}
                        placeholder="Commanding Officer"
                      />
                    </div>
                  </div>
                </div>

                {/* By Direction */}
                <div className="space-y-3 mt-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="byDirection"
                      checked={formState.byDirection || false}
                      onCheckedChange={(checked) => updateField('byDirection', !!checked)}
                    />
                    <Label htmlFor="byDirection" className="font-normal">
                      By direction of...
                    </Label>
                  </div>

                  {formState.byDirection && (
                    <div className="space-y-2 ml-6">
                      <Label htmlFor="byDirectionAuthority">Authority</Label>
                      <Input
                        id="byDirectionAuthority"
                        value={formState.byDirectionAuthority || ''}
                        onChange={(e) => updateField('byDirectionAuthority', e.target.value)}
                        placeholder="the Commanding Officer"
                      />
                    </div>
                  )}
                </div>

                {/* Signature Image Upload */}
                <div className="space-y-2 mt-4">
                  <Label>Signature Image (Optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Upload a PNG image of your signature to appear above the typed name.
                  </p>

                  {formState.signatureImage ? (
                    <div className="space-y-2">
                      <div className="relative border rounded-lg p-4 bg-secondary/30">
                        <img
                          src={signaturePreviewUrl || ''}
                          alt="Signature preview"
                          className="max-h-16 mx-auto"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleRemoveSignature}
                          className="absolute top-2 right-2 h-6 w-6"
                          title="Remove signature"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileImage className="h-3 w-3" />
                        <span>{formState.signatureImage.name}</span>
                        <span>({(formState.signatureImage.size / 1024).toFixed(1)} KB)</span>
                      </div>
                    </div>
                  ) : (
                    <label
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                        isDragging
                          ? 'border-primary bg-primary/10'
                          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-secondary/30'
                      }`}
                    >
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Drag & drop or click to upload
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif"
                        onChange={handleSignatureFileChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">CUI Information</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="cuiControlledBy">Controlled By</Label>
                    <Input
                      id="cuiControlledBy"
                      value={formState.cuiControlledBy || ''}
                      onChange={(e) => updateField('cuiControlledBy', e.target.value)}
                      placeholder="DoD"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pocEmail">POC Email</Label>
                    <Input
                      id="pocEmail"
                      type="email"
                      value={formState.pocEmail || ''}
                      onChange={(e) => updateField('pocEmail', e.target.value)}
                      placeholder="john.smith@usmc.mil"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Footer */}
          <DialogFooter className="bg-background px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {isEditing ? 'Save Changes' : 'Create Profile'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this profile. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnitLookupModal
        open={showUnitLookup}
        onOpenChange={setShowUnitLookup}
        onSelect={handleUnitSelect}
      />

      <SSICLookupModal
        open={showSSICLookup}
        onOpenChange={setShowSSICLookup}
        onSelect={(code) => updateField('ssic', code)}
      />
    </>
  );
}
