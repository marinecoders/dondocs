import { buildBackup } from './backup';
import { triggerDownload } from './encoding';
import { useOnboardingStore } from '@/stores/onboardingStore';

/** Prepare a complete backup before starting its browser download. */
export async function downloadWorkspaceBackup(): Promise<void> {
  const json = await buildBackup();
  triggerDownload(new Blob([json], { type: 'application/json' }), `dondocs-backup-${new Date().toISOString().slice(0, 10)}.json`);
  useOnboardingStore.getState().markComplete('first_backup');
}
