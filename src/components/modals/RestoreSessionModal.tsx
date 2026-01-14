/**
 * Restore Session Modal
 *
 * Prompts the user to restore their previous work session if one exists.
 * Shows when the app loads and a saved session is detected.
 */

import { useState, useEffect } from 'react';
import { History, FileText, Trash2, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  hasSavedSession,
  getSavedSession,
  restoreSession,
  clearSavedSession,
  getSessionAge,
} from '@/stores/documentStore';
import { getDeviceInfo } from '@/utils/device';
import { SW_AUTO_RESTORE_KEY } from '@/hooks/useServiceWorker';

// Storage key to prevent showing modal in same session
const RESTORE_SHOWN_KEY = 'libo-restore-shown-session';

export function RestoreSessionModal() {
  const [open, setOpen] = useState(false);
  const [sessionAge, setSessionAge] = useState('');
  const [sessionPreview, setSessionPreview] = useState<{
    subject?: string;
    paragraphCount: number;
    referenceCount: number;
    docType?: string;
  } | null>(null);

  useEffect(() => {
    // Don't show on incompatible browsers
    const device = getDeviceInfo();
    if (device.isInAppBrowser) {
      return;
    }

    // Check if this is an auto-restore after app update
    const autoRestore = localStorage.getItem(SW_AUTO_RESTORE_KEY);
    if (autoRestore && hasSavedSession()) {
      console.log('[RestoreSession] Auto-restoring after app update');
      localStorage.removeItem(SW_AUTO_RESTORE_KEY);
      restoreSession();
      // Mark as shown so we don't prompt again
      sessionStorage.setItem(RESTORE_SHOWN_KEY, 'true');
      return;
    }
    // Clean up the flag if no session to restore
    if (autoRestore) {
      localStorage.removeItem(SW_AUTO_RESTORE_KEY);
    }

    // Check if we already showed the modal in this session
    const alreadyShown = sessionStorage.getItem(RESTORE_SHOWN_KEY);
    if (alreadyShown) {
      return;
    }

    // Check if there's a saved session
    if (hasSavedSession()) {
      const session = getSavedSession();
      if (session) {
        setSessionAge(getSessionAge());
        setSessionPreview({
          subject: session.formData?.subject,
          paragraphCount: session.paragraphs?.length || 0,
          referenceCount: session.references?.length || 0,
          docType: session.docType,
        });
        setOpen(true);
        // Mark that we've shown the modal in this session
        sessionStorage.setItem(RESTORE_SHOWN_KEY, 'true');
      }
    }
  }, []);

  const handleRestore = () => {
    restoreSession();
    setOpen(false);
  };

  const handleStartFresh = () => {
    clearSavedSession();
    setOpen(false);
  };

  const formatDocType = (docType?: string) => {
    if (!docType) return 'Document';
    return docType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden">
        <div className="flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <History className="h-5 w-5 text-primary flex-shrink-0" />
              <span className="truncate">Restore Previous Session?</span>
            </DialogTitle>
            <DialogDescription className="break-words">
              You have unsaved work from a previous session ({sessionAge}).
              Would you like to restore it?
            </DialogDescription>
          </DialogHeader>

          {sessionPreview && (
            <div className="bg-muted/50 border rounded-lg p-4 space-y-2 min-w-0 overflow-hidden">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="font-medium truncate">{formatDocType(sessionPreview.docType)}</span>
              </div>
              {sessionPreview.subject && (
                <div className="text-sm text-muted-foreground pl-6 truncate">
                  Subject: {sessionPreview.subject}
                </div>
              )}
              <div className="text-xs text-muted-foreground pl-6 flex gap-4 flex-wrap">
                <span>{sessionPreview.paragraphCount} paragraph{sessionPreview.paragraphCount !== 1 ? 's' : ''}</span>
                <span>{sessionPreview.referenceCount} reference{sessionPreview.referenceCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 break-words">
            <strong>Note:</strong> PDF enclosure files and signature images are not preserved
            and will need to be re-attached.
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              onClick={handleStartFresh}
              className="flex items-center justify-center gap-2 w-full sm:w-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 flex-shrink-0" />
              <span>Start Fresh</span>
            </Button>
            <Button
              onClick={handleRestore}
              className="flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <RotateCcw className="h-4 w-4 flex-shrink-0" />
              <span>Restore Session</span>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
