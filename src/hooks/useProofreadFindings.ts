import { useMemo } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentCompleteness, useEditorSections } from '@/components/layout/editorSections';
import { collectProofreadFindings, type ProofreadSource } from '@/lib/proofread';
import { additionalProofreadFindings } from '@/lib/correspondenceProofreadChecks';

/** Subscribe only to inputs used by the existing checks; UI changes cannot retrigger scans. */
export function useProofreadSource(): ProofreadSource {
  const documentCategory = useDocumentStore(s => s.documentCategory);
  const documentMode = useDocumentStore(s => s.documentMode);
  const docType = useDocumentStore(s => s.docType);
  const formData = useDocumentStore(s => s.formData);
  const paragraphs = useDocumentStore(s => s.paragraphs);
  const references = useDocumentStore(s => s.references);
  const enclosures = useDocumentStore(s => s.enclosures);
  const copyTos = useDocumentStore(s => s.copyTos);
  const distributions = useDocumentStore(s => s.distributions);
  const endItems = useDocumentStore(s => s.endItems);
  const publicationTables = useDocumentStore(s => s.publicationTables);
  return useMemo(() => ({ documentCategory, documentMode, docType, formData, paragraphs,
    references, enclosures, copyTos, distributions, endItems, publicationTables }),
  [documentCategory, documentMode, docType, formData, paragraphs, references, enclosures, copyTos, distributions, endItems, publicationTables]);
}

export function useProofreadReview(enabled = true) {
  const source = useProofreadSource();
  const { missing } = useDocumentCompleteness();
  const { sections } = useEditorSections();
  const findings = useMemo(() => enabled
    ? collectProofreadFindings(source, sections.filter(section => missing.includes(section.id)), additionalProofreadFindings(source))
    : [], [enabled, source, missing, sections]);
  return { source, findings };
}

export function useProofreadFindings() {
  return useProofreadReview().findings;
}
