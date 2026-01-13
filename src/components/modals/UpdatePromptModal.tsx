/**
 * Update Prompt Modal
 *
 * Prompts the user when a new app version is available.
 * Allows them to update now or later, preserving their work.
 */

import { RefreshCw, Clock, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface UpdatePromptModalProps {
  open: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function UpdatePromptModal({ open, onConfirm, onDismiss }: UpdatePromptModalProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md w-[calc(100vw-2rem)] overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        {/* Custom close button that calls onDismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
        <div className="flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <RefreshCw className="h-5 w-5 text-primary flex-shrink-0" />
              <span>Update Available</span>
            </DialogTitle>
            <DialogDescription className="break-words">
              A new version of the app is available. Your work will be automatically
              restored after the update.
            </DialogDescription>
          </DialogHeader>

          <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3 break-words">
            <strong>Note:</strong> PDF enclosure files and signature images will need
            to be re-attached after the update.
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              onClick={onDismiss}
              className="flex items-center justify-center gap-2 w-full sm:w-auto text-muted-foreground"
            >
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>Later</span>
            </Button>
            <Button
              onClick={onConfirm}
              className="flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4 flex-shrink-0" />
              <span>Update Now</span>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
