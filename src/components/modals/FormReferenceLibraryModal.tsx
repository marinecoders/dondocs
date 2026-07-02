import { Library } from 'lucide-react';
import { ReferenceLibraryPicker } from './ReferenceLibraryPicker';

interface FormReferenceLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (reference: string) => void;
}

/**
 * Reference picker for NAVMC counseling forms (Form 6105). Thin wrapper over
 * the shared ReferenceLibraryPicker with counseling-oriented copy; the caller
 * owns open state and receives the picked citation via onSelect.
 */
export function FormReferenceLibraryModal({ open, onOpenChange, onSelect }: FormReferenceLibraryModalProps) {
  return (
    <ReferenceLibraryPicker
      open={open}
      onOpenChange={onOpenChange}
      onSelect={onSelect}
      title={
        <>
          <Library className="h-5 w-5" />
          Reference Library
        </>
      }
      showResultCount
      autoFocus
      footer='Click "Add" to append a reference to your form. References will be automatically lettered.'
    />
  );
}
