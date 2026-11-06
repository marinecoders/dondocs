import { getSerializedSession } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, commitCurrentDocument } from '@/stores/documentsStore';
import { showAppAlert } from '@/stores/alertStore';
import { STORAGE_KEYS } from '@/lib/constants';

/** One manual checkpoint shared by the menu, Search, and keyboard shortcut. */
export async function saveCheckpoint(): Promise<boolean> {
  const scope = captureDocumentScope();
  try {
    localStorage.setItem(STORAGE_KEYS.DOCUMENT, JSON.stringify(getSerializedSession()));
    return !!await commitCurrentDocument();
  } catch {
    if (scope && !isCurrentDocumentScope(scope)) return false;
    showAppAlert({
      title: 'Could not save checkpoint',
      message: 'Browser storage could not finish saving this checkpoint. Your current work is still open. Export a draft file before reloading, then check available browser storage.',
    });
    return false;
  }
}
