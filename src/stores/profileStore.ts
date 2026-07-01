import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { compressedLocalStorage } from '@/lib/compressedStorage';
import type { Profile } from '@/types/document';

// The default profile every new user starts on. Signature fields are blank so
// each user fills in their own.
const DEFAULT_PROFILE_NAME = 'Marine Innovation Unit';

const DEFAULT_PROFILES: Record<string, Profile> = {
  [DEFAULT_PROFILE_NAME]: {
    department: 'usmc',
    unitLine1: 'MARINE INNOVATION UNIT',
    unitLine2: 'MARINE FORCES RESERVE',
    unitAddress: '10 MCDONALD STREET, NEWBURGH, NY 12550',
    ssic: '5216',
    from: 'Commanding Officer, Marine Innovation Unit',
    sigFirst: '',
    sigMiddle: '',
    sigLast: '',
    sigRank: '',
    sigTitle: 'Commanding Officer',
    pocEmail: '',
  },
};

// Defaults shipped by earlier builds and since removed. An upgrader who never
// touched one still has it in their persisted profiles (merge spreads them
// verbatim), so it would resurrect in the dropdown. We drop it on hydration ONLY
// when the persisted copy is byte-for-byte the retired seed and isn't the current
// selection — a user who edited it, reused the name, or has it selected keeps it.
const RETIRED_DEFAULTS: Record<string, Profile> = {
  '23d Marine Regiment': {
    department: 'usmc',
    unitLine1: '23D MARINE REGIMENT',
    unitLine2: '4TH MARINE DIVISION',
    unitAddress: '900 COMMODORE DRIVE, SAN BRUNO, CA 94066-0095',
    ssic: '5216',
    from: 'Commanding Officer, 23d Marine Regiment',
    sigFirst: 'James',
    sigMiddle: 'R',
    sigLast: 'THOMPSON',
    sigRank: 'Colonel',
    sigTitle: 'Commanding Officer',
    pocEmail: 'james.thompson@usmc.mil',
  },
};

function isUnmodifiedRetiredDefault(name: string, profile: Profile): boolean {
  const seed = RETIRED_DEFAULTS[name];
  if (!seed) return false;
  const keys = new Set([...Object.keys(seed), ...Object.keys(profile)]) as Set<keyof Profile>;
  for (const k of keys) {
    if ((seed[k] ?? '') !== (profile[k] ?? '')) return false;
  }
  return true;
}

interface ProfileState {
  profiles: Record<string, Profile>;
  selectedProfile: string | null;
  // DEFAULT_PROFILES the user deleted or renamed away. merge() re-seeds defaults
  // on every hydration, so without this a deleted default would reappear.
  hiddenDefaults: string[];

  // Actions
  addProfile: (name: string, profile: Profile) => void;
  updateProfile: (name: string, profile: Profile) => void;
  deleteProfile: (name: string) => void;
  renameProfile: (oldName: string, newName: string) => void;
  selectProfile: (name: string | null) => void;
  importProfiles: (profiles: Record<string, Profile>) => void;
  getProfile: (name: string) => Profile | undefined;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profiles: { ...DEFAULT_PROFILES },
      // New users start on the default profile (MIU), not "No Profile".
      selectedProfile: DEFAULT_PROFILE_NAME,
      hiddenDefaults: [],

      addProfile: (name, profile) => set((state) => ({
        profiles: { ...state.profiles, [name]: profile },
      })),

      updateProfile: (name, profile) => set((state) => ({
        profiles: { ...state.profiles, [name]: profile },
      })),

      deleteProfile: (name) => set((state) => {
        const { [name]: _deleted, ...rest } = state.profiles;
        return {
          profiles: rest,
          selectedProfile: state.selectedProfile === name ? null : state.selectedProfile,
          // Remember a deleted default so merge() doesn't resurrect it on reload.
          hiddenDefaults: name in DEFAULT_PROFILES && !state.hiddenDefaults.includes(name)
            ? [...state.hiddenDefaults, name]
            : state.hiddenDefaults,
        };
      }),

      renameProfile: (oldName, newName) => set((state) => {
        if (oldName === newName) return state;
        const profile = state.profiles[oldName];
        if (!profile) return state;
        const { [oldName]: _removed, ...rest } = state.profiles;
        return {
          profiles: { ...rest, [newName]: profile },
          selectedProfile: state.selectedProfile === oldName ? newName : state.selectedProfile,
          // Renaming a default deletes it under its old name; record it so the
          // original doesn't reappear alongside the new name.
          hiddenDefaults: oldName in DEFAULT_PROFILES && !state.hiddenDefaults.includes(oldName)
            ? [...state.hiddenDefaults, oldName]
            : state.hiddenDefaults,
        };
      }),

      selectProfile: (name) => set({ selectedProfile: name }),

      importProfiles: (profiles) => set((state) => ({
        profiles: { ...state.profiles, ...profiles },
      })),

      getProfile: (name) => get().profiles[name],
    }),
    {
      name: 'dondocs_profiles',
      // Profiles include base64 PNG signatures, so a few routinely exceed
      // several hundred KB; compress them. Legacy plain-JSON reads straight through.
      storage: createJSONStorage(() => compressedLocalStorage),
      // Merge persisted profiles over the defaults, re-seeding defaults on every
      // hydration except those in hiddenDefaults.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ProfileState>;
        const hidden = persisted?.hiddenDefaults ?? [];
        // Drop untouched, unselected retired demo profiles so they don't resurrect
        // on upgrade — but never one the user edited, reused, or has selected.
        const persistedProfiles = { ...(persisted?.profiles || {}) };
        for (const [name, profile] of Object.entries(persistedProfiles)) {
          if (name !== persisted?.selectedProfile && isUnmodifiedRetiredDefault(name, profile)) {
            delete persistedProfiles[name];
          }
        }
        return {
          ...currentState,
          ...persisted,
          hiddenDefaults: hidden,
          profiles: {
            ...Object.fromEntries(
              Object.entries(DEFAULT_PROFILES).filter(([name]) => !hidden.includes(name))
            ),
            ...persistedProfiles,
          },
        };
      },
    }
  )
);
