/**
 * Enclosure Error Modal
 *
 * Displays warnings about PDF enclosures that failed to load or had errors.
 * Shows which enclosures failed and why, allowing users to understand
 * the issue and take corrective action.
 */

import { AlertTriangle, FileWarning, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { EnclosureError } from '@/services/pdf/mergeEnclosures';

interface EnclosureErrorModalProps {
  errors: EnclosureError[];
  open: boolean;
  onClose: () => void;
}

export function EnclosureErrorModal({ errors, open, onClose }: EnclosureErrorModalProps) {
  if (errors.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-600">
            <AlertTriangle className="h-5 w-5" />
            Enclosure Warning{errors.length > 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            {errors.length === 1
              ? 'One enclosure could not be fully processed.'
              : `${errors.length} enclosures could not be fully processed.`}
            {' '}The PDF was generated with placeholder pages for the affected enclosures.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {errors.map((error, index) => (
            <div
              key={index}
              className="flex gap-3 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md"
            >
              <FileWarning className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">
                  Enclosure ({error.enclosureNumber}): {error.title}
                </div>
                <div className="text-xs text-muted-foreground mt-1 break-words">
                  {error.error}
                </div>
                {error.pagesSucceeded !== undefined && error.pagesSucceeded > 0 && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {error.pagesSucceeded} page(s) loaded successfully
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          <strong>Common causes:</strong>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Corrupted or damaged PDF file</li>
            <li>PDF created with incompatible software</li>
            <li>Scanned image saved incorrectly as PDF</li>
            <li>Password-protected or encrypted PDF</li>
          </ul>
          <p className="mt-2">
            Try re-saving the PDF using Adobe Acrobat or another PDF editor, or use a different source file.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
