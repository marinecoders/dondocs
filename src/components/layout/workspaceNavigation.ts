import { HelpCircle, Settings, Trash2, UserRound } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

/** Shared workspace destinations for the sidebar and mobile Documents menu. */
export const WORKSPACE_DESTINATIONS = [
  { label: 'Profiles', icon: UserRound, run: () => useUIStore.getState().setProfileManagerOpen(true) },
  { label: 'Trash', icon: Trash2, run: () => useUIStore.getState().setTrashOpen(true) },
  { label: 'Settings', icon: Settings, run: () => useUIStore.getState().setSettingsOpen(true) },
  { label: 'Help', icon: HelpCircle, run: () => useUIStore.getState().setHelpOpen(true) },
];
