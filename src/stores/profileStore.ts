import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '@/types/document';

// Default profile for demonstration
const DEFAULT_PROFILES: Record<string, Profile> = {
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

interface ProfileState {
  profiles: Record<string, Profile>;
  selectedProfile: string | null;

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
      selectedProfile: null,

      addProfile: (name, profile) => set((state) => ({
        profiles: { ...state.profiles, [name]: profile },
      })),

      updateProfile: (name, profile) => set((state) => ({
        profiles: { ...state.profiles, [name]: profile },
      })),

      deleteProfile: (name) => set((state) => {
        const { [name]: _, ...rest } = state.profiles;
        return {
          profiles: rest,
          selectedProfile: state.selectedProfile === name ? null : state.selectedProfile,
        };
      }),

      renameProfile: (oldName, newName) => set((state) => {
        if (oldName === newName) return state;
        const profile = state.profiles[oldName];
        if (!profile) return state;
        const { [oldName]: _, ...rest } = state.profiles;
        return {
          profiles: { ...rest, [newName]: profile },
          selectedProfile: state.selectedProfile === oldName ? newName : state.selectedProfile,
        };
      }),

      selectProfile: (name) => set({ selectedProfile: name }),

      importProfiles: (profiles) => set((state) => ({
        profiles: { ...state.profiles, ...profiles },
      })),

      getProfile: (name) => get().profiles[name],
    }),
    {
      name: 'libo_profiles',
      // Merge persisted profiles with default profiles (defaults can be overwritten by user)
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<ProfileState>),
        // Ensure default profiles are always available (user profiles take precedence)
        profiles: {
          ...DEFAULT_PROFILES,
          ...((persistedState as Partial<ProfileState>)?.profiles || {}),
        },
      }),
    }
  )
);
