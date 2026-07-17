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
import { Notice } from '@/components/ui/notice';
import type { EnclosureError } from '@/services/pdf/mergeEnclosures';

interface EnclosureErrorModalProps {
  errors: EnclosureError[];
  open: boolean;
  onClose: () => void;
}

export function EnclosureErrorModal({ errors, open, onClose }: EnclosureErrorModalProps) {
  if (errors.length === 0) return null;

  // A failed basic-letter assembly (endorsements) is not an enclosure: it gets
  // no placeholder page — the letter is simply absent from the export — so the
  // copy must not claim otherwise.
  const enclosureCount = errors.filter((e) => e.kind !== 'basicLetter').length;
  const hasBasicLetter = errors.some((e) => e.kind === 'basicLetter');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            {enclosureCount > 0 && hasBasicLetter
              ? 'Export Warnings'
              : hasBasicLetter
                ? 'Basic Letter Warning'
                : `Enclosure Warning${errors.length > 1 ? 's' : ''}`}
          </DialogTitle>
          <DialogDescription>
            {hasBasicLetter &&
              'The basic letter could not be read, so the PDF contains the endorsement alone — without the letter ahead of it. '}
            {enclosureCount > 0 &&
              `${enclosureCount === 1 ? 'One enclosure' : `${enclosureCount} enclosures`} could not be fully processed; the PDF was generated with placeholder pages for the affected enclosures.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {errors.map((error, index) => (
            <Notice key={index} variant="warning" className="flex gap-3">
              <FileWarning className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">
                  {error.kind === 'basicLetter'
                    ? 'Basic letter (not assembled)'
                    : `Enclosure (${error.enclosureNumber}): ${error.title}`}
                </div>
                <div className="text-xs text-muted-foreground mt-1 break-words">
                  {error.error}
                </div>
                {error.pagesSucceeded !== undefined && error.pagesSucceeded > 0 && (
                  <div className="text-xs text-success mt-1">
                    {error.pagesSucceeded} page(s) loaded successfully
                  </div>
                )}
              </div>
            </Notice>
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
