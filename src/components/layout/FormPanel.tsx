import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePageScrollLayout } from '@/hooks/usePageScrollLayout';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AccordionStaticProvider } from '@/components/ui/accordion';
import { WorkspaceBar } from './WorkspaceBar';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { Form6105Section } from '@/components/editor/Form6105Section';
import { GenericFormSection } from '@/components/editor/GenericFormSection';
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
  const pageScroll = usePageScrollLayout();
  const scrollMode = useUIStore((s) => s.editorLayout === 'scroll');
  const previousMode = useRef(scrollMode);
  const initialPlacement = useRef(true);
  const jumpPinned = useRef(false);
  const activeRef = useRef<string | null>(null);
  const saved = useRef(documentId ? useUIStore.getState().documentPositions[documentId] : undefined);
  const [section, setSection] = useState(() => {
    const requested = useEditorOutlineStore.getState().pendingJump;
    const id = requested?.documentId === documentId ? requested?.sectionId : (documentId ? useUIStore.getState().documentPositions[documentId]?.section : undefined);
    return sections.some((s) => s.id === id) ? id! : isFormsMode ? 'content' : 'body';
  });
  const active = sections.some((s) => s.id === section) ? section : sections[0]?.id ?? 'content';
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const getScrollRoot = useCallback(() => pageScroll
    ? scrollWrapRef.current?.closest<HTMLElement>('.workspace-shell')
    : scrollWrapRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]'), [pageScroll]);
  const focusSection = useRef(false);
  const pendingJump = useEditorOutlineStore((s) => s.pendingJump);
  const jumpTo = useCallback((id: string) => {
    if (!sections.some((s) => s.id === id)) return;
    focusSection.current = true;
    jumpPinned.current = true;
    setSection(id);
    useEditorOutlineStore.getState().setActiveId(id);
    // Also focus an already selected section when it is chosen again.
    requestAnimationFrame(() => {
      const target = scrollWrapRef.current?.querySelector<HTMLElement>(`#sec-${id}`);
      target?.focus({ preventScroll: true });
      if (scrollMode || pageScroll) target?.scrollIntoView({ block: 'start' });
    });
  }, [sections, scrollMode, pageScroll]);

  useLayoutEffect(() => {
    const root = getScrollRoot();
    if (!root) return;
    activeRef.current = active;
    useEditorOutlineStore.getState().setActiveId(active);
    const modeChanged = previousMode.current !== scrollMode;
    const savedLayout = saved.current?.layout ?? 'focused';
    let restoreFrame: number | undefined;
    if (!scrollMode) {
      root.scrollTop = savedLayout === 'focused' && saved.current?.section === active ? saved.current.top : 0;
    } else if (saved.current && savedLayout === 'scroll' && !modeChanged) {
      jumpPinned.current = true;
      const top = saved.current.top;
      root.scrollTop = top;
      restoreFrame = requestAnimationFrame(() => { root.scrollTop = top; });
    } else if (modeChanged || initialPlacement.current) {
      jumpPinned.current = true;
      root.querySelector<HTMLElement>(`#sec-${active}`)?.scrollIntoView({ block: 'start' });
    }
    initialPlacement.current = false;
    previousMode.current = scrollMode;
    saved.current = undefined;
    if (focusSection.current) {
      root.querySelector<HTMLElement>(`#sec-${active}`)?.focus({ preventScroll: true });
      focusSection.current = false;
    }
    return () => { if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame); };
  }, [active, scrollMode, getScrollRoot]);

  // overflow:hidden retains scrollTop. Clear the page offset when rotating back
  // so the normal fixed header cannot remain scrolled above the viewport.
  useLayoutEffect(() => {
    if (!pageScroll) {
      const shell = scrollWrapRef.current?.closest<HTMLElement>('.workspace-shell');
      if (shell) shell.scrollTop = 0;
    }
  }, [pageScroll]);

  useEffect(() => {
    const root = getScrollRoot();
    if (!root) return;
    const remember = () => {
      if (documentId) useUIStore.getState().rememberPosition(documentId, root.scrollTop, activeRef.current);
    };
    const onScroll = () => {
      if (scrollMode && !jumpPinned.current) {
        const threshold = root.getBoundingClientRect().top + 80;
        let nearest = sections[0]?.id ?? 'content';
        for (const entry of sections) {
          const el = root.querySelector<HTMLElement>(`#sec-${entry.id}`);
          if (el && el.getBoundingClientRect().top <= threshold) nearest = entry.id;
        }
        if (root.scrollHeight > root.clientHeight && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) nearest = sections[sections.length - 1].id;
        activeRef.current = nearest;
        setSection(nearest);
      }
      remember();
    };
    const releasePin = () => { jumpPinned.current = false; };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('wheel', releasePin, { passive: true });
    root.addEventListener('touchmove', releasePin, { passive: true });
    root.addEventListener('keydown', releasePin);
    window.addEventListener('pagehide', remember);
    remember();
    return () => {
      remember();
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('wheel', releasePin);
      root.removeEventListener('touchmove', releasePin);
      root.removeEventListener('keydown', releasePin);
      window.removeEventListener('pagehide', remember);
    };
  }, [scrollMode, sections, documentId, getScrollRoot]);

  useEffect(() => {
    const root = getScrollRoot();
    if (root && documentId) useUIStore.getState().rememberPosition(documentId, root.scrollTop, active);
  }, [active, documentId, getScrollRoot]);

  useEffect(() => {
    useEditorOutlineStore.getState().registerJump(jumpTo);
    return () => useEditorOutlineStore.getState().registerJump(null);
  }, [jumpTo]);

  useEffect(() => {
    if (!pendingJump || pendingJump.documentId !== documentId) return;
    const frame = requestAnimationFrame(() => { jumpTo(pendingJump.sectionId); useEditorOutlineStore.getState().clearPendingJump(); });
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, documentId, jumpTo]);

  return <div data-editor-kind={isFormsMode ? 'forms' : 'correspondence'} className="workspace-editor flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <WorkspaceBar activeSection={active} />
    <div ref={scrollWrapRef} className="workspace-editor-scroll flex-1 min-h-0 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="workspace-fields mx-auto w-full max-w-[760px] px-4 sm:px-5 pt-4 pb-12">
          <EditorSectionContext.Provider value={scrollMode ? null : active}>
            <AccordionStaticProvider>
              {isFormsMode ? <>
                {formType === 'navmc_10274' && <Form6105Section />}
                {formType === 'navmc_118_11' && <Form11811Section />}
                {formType !== 'navmc_10274' && formType !== 'navmc_118_11' && <GenericFormSection key={formType} formType={formType} />}
              </> : sections.map((s) => <SectionShell key={s.id} id={s.id} fieldSurface={s.id !== 'body'}>{renderEditorSection(s.id, config)}</SectionShell>)}
            </AccordionStaticProvider>
          </EditorSectionContext.Provider>
        </div>
      </ScrollArea>
    </div>
  </div>;
}
