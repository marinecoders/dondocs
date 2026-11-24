import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { getSpellingDictionary, loadSpellingDictionary, spellingFindings, subscribeToSpellingDictionary, supportsLocalSpelling } from '@/lib/correspondenceSpelling';
import { loadAllSsicCodes } from '@/data/ssicCodes';
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
  const panelOpen = useUIStore(s => s.proofreadOpen);
  const dictionary = useSyncExternalStore(subscribeToSpellingDictionary, getSpellingDictionary);
  const checksSpelling = supportsLocalSpelling(source);
  useEffect(() => {
    if (panelOpen && checksSpelling) void loadSpellingDictionary();
  }, [panelOpen, checksSpelling]);
  const { missing } = useDocumentCompleteness();
  const { sections } = useEditorSections();
  const [ssicCatalog, setSsicCatalog] = useState<ReadonlySet<string>>();
  const shouldLoadCatalog = enabled && source.documentCategory === 'correspondence' && /^\d{4,5}$/.test(source.formData.ssic?.trim() ?? '');
  useEffect(() => {
    if (!shouldLoadCatalog || ssicCatalog) return;
    let active = true;
    void loadAllSsicCodes().then(codes => {
      if (active) setSsicCatalog(new Set(codes.map(entry => entry.code)));
    }).catch(() => { /* Format checks still work when the catalog asset is unavailable. */ });
    return () => { active = false; };
  }, [shouldLoadCatalog, ssicCatalog]);
  const findings = useMemo(() => enabled
    ? collectProofreadFindings(source, sections.filter(section => missing.includes(section.id)), [...additionalProofreadFindings(source, ssicCatalog), ...(dictionary.entries ? spellingFindings(source, dictionary.entries) : [])])
    : [], [enabled, source, missing, sections, dictionary, ssicCatalog]);
  return { source, findings, spellingStatus: checksSpelling ? dictionary.status : undefined };
}

export function useProofreadFindings() {
  return useProofreadReview().findings;
}
