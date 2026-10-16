import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AccordionStaticProvider } from '@/components/ui/accordion';
import { WorkspaceBar } from './WorkspaceBar';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { Form6105Section } from '@/components/editor/Form6105Section';
import { Form11811Section } from '@/components/editor/Form11811Section';
import { SectionShell } from './SectionShell';
import { renderEditorSection, useEditorSections } from './editorSections';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { EditorSectionContext } from './EditorSectionContext';

export function FormPanel() {
  const documentId = useDocumentsStore((s) => s.currentId);
  const category = useDocumentStore((s) => s.documentCategory);
  const type = useDocumentStore((s) => category === 'forms' ? s.formType : s.docType);
  return <FocusedEditor key={`${documentId ?? 'new'}:${category}:${type}`} documentId={documentId} />;
}

function FocusedEditor({ documentId }: { documentId: string | null }) {
  const { sections, config, isFormsMode, formType } = useEditorSections();
  const saved = useRef(documentId ? useUIStore.getState().documentPositions[documentId] : undefined);
  const [section, setSection] = useState(() => {
    const requested = useEditorOutlineStore.getState().pendingJump;
    const id = requested?.documentId === documentId ? requested?.sectionId : (documentId ? useUIStore.getState().documentPositions[documentId]?.section : undefined);
    return sections.some((s) => s.id === id) ? id! : isFormsMode ? 'content' : 'body';
  });
  const active = sections.some((s) => s.id === section) ? section : sections[0].id;
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const focusSection = useRef(false);
  const pendingJump = useEditorOutlineStore((s) => s.pendingJump);
  const jumpTo = useCallback((id: string) => {
    if (!sections.some((s) => s.id === id)) return;
    focusSection.current = true;
    setSection(id);
    useEditorOutlineStore.getState().setActiveId(id);
    // Also focus an already selected section when it is chosen again.
    requestAnimationFrame(() => scrollWrapRef.current?.querySelector<HTMLElement>(`#sec-${id}`)?.focus({ preventScroll: true }));
  }, [sections]);

  useLayoutEffect(() => {
    const root = scrollWrapRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!root) return;
    useEditorOutlineStore.getState().setActiveId(active);
    root.scrollTop = saved.current?.section === active ? saved.current.top : 0;
    saved.current = undefined;
    if (focusSection.current) {
      root.querySelector<HTMLElement>(`#sec-${active}`)?.focus({ preventScroll: true });
      focusSection.current = false;
    }
    const remember = () => { if (documentId) useUIStore.getState().rememberPosition(documentId, root.scrollTop, active); };
    root.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('pagehide', remember);
    remember();
    return () => { remember(); root.removeEventListener('scroll', remember); window.removeEventListener('pagehide', remember); };
  }, [active, documentId]);

  useEffect(() => {
    useEditorOutlineStore.getState().registerJump(jumpTo);
    return () => useEditorOutlineStore.getState().registerJump(null);
  }, [jumpTo]);

  useEffect(() => {
    if (!pendingJump || pendingJump.documentId !== documentId) return;
    const frame = requestAnimationFrame(() => { jumpTo(pendingJump.sectionId); useEditorOutlineStore.getState().clearPendingJump(); });
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, documentId, jumpTo]);

  return <div className="workspace-editor flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <WorkspaceBar activeSection={active} />
    <div ref={scrollWrapRef} className="flex-1 min-h-0 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 pt-4 pb-12">
          <EditorSectionContext.Provider value={active}>
            <AccordionStaticProvider>
              <SectionShell id="type"><DocumentTypeSelector /></SectionShell>
              {isFormsMode ? <>
                {formType === 'navmc_10274' && <Form6105Section />}
                {formType === 'navmc_118_11' && <Form11811Section />}
              </> : sections.filter((s) => s.id !== 'type').map((s) => <SectionShell key={s.id} id={s.id}>{renderEditorSection(s.id, config)}</SectionShell>)}
            </AccordionStaticProvider>
          </EditorSectionContext.Provider>
        </div>
      </ScrollArea>
    </div>
  </div>;
}
