import { useCallback, useEffect, useMemo, useState } from 'react';
import { STARTER_EXAMPLE_SECTIONS, starterExampleText, starterExampleValues, type StarterExampleSection, type StarterExamplesControl } from '@/lib/previewHints';
import { isApplyingAssets, isApplyingSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { parseStarterExampleEdits, starterExampleEditsKey, useUIStore } from '@/stores/uiStore';
import type { CopyTo, DocumentData } from '@/types/document';

type Override = { epoch: number; restored: readonly StarterExampleSection[] | 'hide' };

/** Remember which categories this draft's author has edited, outside the document payload. */
export function useStarterExamples(workspaceReady: boolean, docType: string, formData: Partial<DocumentData>, copyTos: CopyTo[]): StarterExamplesControl & {
  onCategoryInput: (section: StarterExampleSection) => void;
} {
  const id = useDocumentsStore(state => state.currentId);
  const epoch = useDocumentsStore(state => state.activationEpoch);
  const edits = useUIStore(state => id ? state.starterExampleEdits[id] : undefined);
  const [override, setOverride] = useState<Override>();
  const restored = override?.epoch === epoch ? override.restored : undefined;
  const hiddenByDefault = useMemo(() => STARTER_EXAMPLE_SECTIONS.filter(section =>
    edits?.includes(section) || starterExampleText({ docType, formData, copyTos }, section).some(text => text.trim())
  ), [edits, docType, formData, copyTos]);
  const hiddenSections = useMemo(() => restored === 'hide'
    ? STARTER_EXAMPLE_SECTIONS
    : hiddenByDefault.filter(section => !restored?.includes(section)), [hiddenByDefault, restored]);

  const markEdited = useCallback((sections: StarterExampleSection[]) => {
    if (!workspaceReady || !id || useDocumentsStore.getState().activationEpoch !== epoch) return;
    useUIStore.getState().rememberStarterExampleEdits(id, sections);
    setOverride(active => {
      if (active?.epoch !== epoch || active.restored === 'hide' || !active.restored.some(section => sections.includes(section))) return active;
      return { epoch, restored: active.restored.filter(section => !sections.includes(section)) };
    });
  }, [workspaceReady, id, epoch]);

  useEffect(() => {
    if (!workspaceReady || !id) return;
    useUIStore.getState().rememberStarterExampleEdits(id, []);
    const storageKey = starterExampleEditsKey(id);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null) {
        useUIStore.getState().rememberStarterExampleEdits(id, parseStarterExampleEdits(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    const unsubscribe = useDocumentStore.subscribe((current, previous) => {
      if (isApplyingSession() || isApplyingAssets() || current.documentCategory === 'forms'
          || useDocumentsStore.getState().activationEpoch !== epoch
          || current.docType !== previous.docType || current.documentMode !== previous.documentMode
          || (current.formData === previous.formData && current.copyTos === previous.copyTos)) return;
      const changed = STARTER_EXAMPLE_SECTIONS.filter(section => {
        const before = starterExampleValues(previous, section);
        const after = starterExampleValues(current, section);
        return before.length !== after.length || after.some((text, index) => text !== before[index]);
      });
      if (changed.length) markEdited(changed);
    });
    return () => {
      window.removeEventListener('storage', onStorage);
      unsubscribe();
    };
  }, [workspaceReady, id, epoch, markEdited]);

  return {
    hiddenSections,
    checked: hiddenSections.length === 0,
    onChange: checked => setOverride({ epoch, restored: checked ? hiddenByDefault : 'hide' }),
    onCategoryInput: section => markEdited([section]),
  };
}
