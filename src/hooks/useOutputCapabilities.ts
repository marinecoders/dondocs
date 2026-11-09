import { useMemo } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { documentCapabilities } from '@/lib/documentCapabilities';

export function useOutputCapabilities() {
  const documentMode = useDocumentStore(s => s.documentMode);
  const documentCategory = useDocumentStore(s => s.documentCategory);
  const docType = useDocumentStore(s => s.docType);
  const formType = useDocumentStore(s => s.formType);
  const definition = useDocumentStore(s => s.genericForm?.definition);
  return useMemo(() => {
    const document = { documentMode, documentCategory, docType, formType,
      ...(definition ? { genericForm: { definition } } : {}) };
    return {
      pdf: documentCapabilities(document, { operation: 'export', target: 'pdf' }),
      word: documentCapabilities(document, { operation: 'export', target: 'docx' }),
      configuration: documentCapabilities(document, { operation: 'export', target: 'tex', texMode: 'configuration' }),
      flat: documentCapabilities(document, { operation: 'export', target: 'tex', texMode: 'flat' }),
      preview: documentCapabilities(document, { operation: 'preview', target: 'pdf' }),
      batch: documentCapabilities(document, { operation: 'batch', target: 'pdf' }),
      share: documentCapabilities(document, { operation: 'share', target: 'link' }),
    };
  }, [documentMode, documentCategory, docType, formType, definition]);
}
