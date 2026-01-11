import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '@/types/document';

// Example profiles for common units
const DEFAULT_PROFILES: Record<string, Profile> = {
  '1st Bn, 6th Marines': {
    unitLine1: '1ST BATTALION, 6TH MARINES',
    unitLine2: '2D MARINE DIVISION, II MEF',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
    ssic: '5216',
    from: 'Commanding Officer, 1st Battalion, 6th Marines',
    sigFirst: 'John',
    sigMiddle: 'M',
    sigLast: 'DOE',
    sigRank: 'Lieutenant Colonel',
    sigTitle: 'Commanding Officer',
    pocEmail: 'john.doe@usmc.mil',
  },
  '2d Marine Division': {
    unitLine1: '2D MARINE DIVISION',
    unitLine2: 'II MARINE EXPEDITIONARY FORCE',
    unitAddress: 'PSC BOX 20004, CAMP LEJEUNE, NC 28542-0004',
    ssic: '5216',
    from: 'Commanding General, 2d Marine Division',
    sigFirst: 'Jane',
    sigMiddle: 'A',
    sigLast: 'SMITH',
    sigRank: 'Major General',
    sigTitle: 'Commanding General',
    pocEmail: 'jane.smith@usmc.mil',
  },
  'HQMC Manpower': {
    unitLine1: 'HEADQUARTERS MARINE CORPS',
    unitLine2: 'MANPOWER AND RESERVE AFFAIRS',
    unitAddress: '3280 RUSSELL ROAD, QUANTICO, VA 22134-5103',
    ssic: '1000',
    from: 'Deputy Commandant for Manpower and Reserve Affairs',
    sigFirst: 'Robert',
    sigMiddle: 'J',
    sigLast: 'JONES',
    sigRank: 'Lieutenant General',
    sigTitle: 'Deputy Commandant',
    pocEmail: 'robert.jones@usmc.mil',
  },
  'MCRD San Diego': {
    unitLine1: 'MARINE CORPS RECRUIT DEPOT',
    unitLine2: 'SAN DIEGO, CALIFORNIA',
    unitAddress: '1600 HENDERSON AVENUE, SAN DIEGO, CA 92140',
    ssic: '5216',
    from: 'Commanding General, Marine Corps Recruit Depot San Diego',
    sigFirst: 'Michael',
    sigMiddle: 'T',
    sigLast: 'WILSON',
    sigRank: 'Brigadier General',
    sigTitle: 'Commanding General',
    pocEmail: 'michael.wilson@usmc.mil',
  },
  'Marine Corps University': {
    unitLine1: 'MARINE CORPS UNIVERSITY',
    unitLine2: 'TRAINING AND EDUCATION COMMAND',
    unitAddress: '2076 SOUTH STREET, QUANTICO, VA 22134',
    ssic: '1500',
    from: 'President, Marine Corps University',
    sigFirst: 'Sarah',
    sigMiddle: 'E',
    sigLast: 'BROWN',
    sigRank: 'Brigadier General',
    sigTitle: 'President',
    pocEmail: 'sarah.brown@usmc.mil',
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
