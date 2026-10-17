import { getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { showAppAlert } from '@/stores/alertStore';
import { STORAGE_KEYS } from '@/lib/constants';

/** One manual checkpoint shared by the menu, Search, and keyboard shortcut. */
export function saveCheckpoint(): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, JSON.stringify(getSerializedSession()));
    useDocumentsStore.getState().saveCurrent();
    return true;
  } catch {
    showAppAlert({
      title: 'Could not save checkpoint',
      message: 'Browser storage could not save this checkpoint. Your current work is still open. Export a draft file before reloading, then check available browser storage.',
    });
    return false;
  }
}
