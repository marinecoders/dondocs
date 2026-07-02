import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { ReferenceLibraryPicker } from './ReferenceLibraryPicker';

/**
 * Top-bar "Reference Library" picker for general documents. Thin wrapper over
 * the shared ReferenceLibraryPicker: opens from the uiStore flag and appends
 * the picked citation to the document's references.
 */
export function ReferenceLibraryModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const referenceLibraryOpen = useUIStore((s) => s.referenceLibraryOpen);
  const setReferenceLibraryOpen = useUIStore((s) => s.setReferenceLibraryOpen);
  const { addReference } = useDocumentStore();

  return (
    <ReferenceLibraryPicker
      open={referenceLibraryOpen}
      onOpenChange={setReferenceLibraryOpen}
      onSelect={addReference}
      description="Common Marine Corps directives and orders"
    />
  );
}
