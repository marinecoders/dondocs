import { useCallback, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AccordionStaticProvider } from '@/components/ui/accordion';
import { ProfileBar } from '@/components/editor/ProfileBar';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { Form6105Section } from '@/components/editor/Form6105Section';
import { Form11811Section } from '@/components/editor/Form11811Section';
import { BackgroundBeams } from '@/components/effects/BackgroundBeams';
import { SectionShell } from './SectionShell';
import { renderEditorSection, useEditorSections } from './editorSections';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useReducedMotion } from '@/hooks';

const marineCodersLogo = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;

export function FormPanel() {
  // Section list shared with the sidebar outline (single source of truth).
  const { sections, config, isFormsMode, formType } = useEditorSections();
  const previewVisible = useUIStore((s) => s.previewVisible);
  const isMobile = useUIStore((s) => s.isMobile);
  // OS reduce-motion preference; stops the animated beams (SMIL animation the
  // CSS reduced-motion rule doesn't cover).
  const prefersReducedMotion = useReducedMotion();
  // The outline is shown beside the editor only on desktop multi-section docs.
  const spyEnabled = !isMobile && sections.length > 1;

  // The active section lives in the shared outline store; FormPanel runs the
  // scroll-spy that feeds it but does NOT read it here, so scrolling re-renders
  // only the affected SectionShells, not the whole panel.

  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const viewport = () =>
    scrollWrapRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;

  // Scroll-spy: the active section is the last one whose top has passed a
  // trigger line near the top of the viewport, with a bottom-edge override so
  // the final short sections light up at the end. Publishes to the outline store.
  useEffect(() => {
    if (!spyEnabled) return;
    const root = viewport();
    if (!root) return;
    const setActiveId = useEditorOutlineStore.getState().setActiveId;
    let raf = 0;
    const compute = () => {
      raf = 0;
      // Bottom-edge override: when scrolled to the end, light the last section.
      // Gated on the form actually overflowing, else a short doc would light the
      // last section at the top on first paint instead of the first.
      if (
        root.scrollHeight - root.clientHeight > 2 &&
        root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      ) {
        setActiveId(sections[sections.length - 1].id);
        return;
      }
      const trigger = root.getBoundingClientRect().top + Math.min(96, root.clientHeight * 0.2);
      let current = sections[0]?.id ?? null;
      for (const s of sections) {
        const el = root.querySelector(`#sec-${s.id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= trigger) current = s.id;
        else break;
      }
      if (current) setActiveId(current);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    root.addEventListener('scroll', schedule, { passive: true });
    schedule(); // initial sync, deferred out of the effect body
    return () => {
      root.removeEventListener('scroll', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections, spyEnabled]);

  // Instant jump to a section. Stable so it registers once with the outline
  // store for the sidebar to call.
  const jumpTo = useCallback((id: string) => {
    const root = scrollWrapRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const el = root?.querySelector<HTMLElement>(`#sec-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    // Move focus into the section so keyboard/AT users land there, not back on
    // the rail button (WCAG 2.4.3). The wrapper is tabIndex=-1 for this.
    el.focus({ preventScroll: true });
    useEditorOutlineStore.getState().setActiveId(id);
  }, []);

  useEffect(() => {
    useEditorOutlineStore.getState().registerJump(jumpTo);
    return () => useEditorOutlineStore.getState().registerJump(null);
  }, [jumpTo]);

  return (
    <div className={`relative flex flex-col h-full bg-card overflow-hidden w-full ${!isMobile ? 'border-r border-border' : ''}`}>
      {/* Branded editor backdrop — animated beams + a faint centered EGA seal,
          scoped to this column so the motion lives in the editor and the form
          content scrolls above it (z-10). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <BackgroundBeams
          className="absolute inset-0 opacity-60 dark:opacity-50"
          reducedMotion={isMobile}
          prefersReducedMotion={prefersReducedMotion}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={marineCodersLogo}
            alt=""
            className="w-[78%] max-w-[480px] opacity-[0.05] dark:opacity-[0.06] invert dark:invert-0"
          />
        </div>
      </div>

      <div className="relative z-10 flex flex-1 min-h-0 flex-col">
      <ProfileBar />

      <div ref={scrollWrapRef} className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div
            className={`p-3 sm:p-density-4 space-y-density-6 overflow-x-hidden ${isMobile ? 'pb-24' : ''} ${
              !previewVisible ? 'max-w-4xl mx-auto' : 'max-w-full'
            }`}
          >
            <AccordionStaticProvider>
              {/* Document Type leads the editor as its own rail section. */}
              <SectionShell id="type">
                <DocumentTypeSelector />
              </SectionShell>
              {isFormsMode ? (
                <>
                  {formType === 'navmc_10274' && <Form6105Section />}
                  {formType === 'navmc_118_11' && <Form11811Section />}
                </>
              ) : (
                sections
                  .filter((s) => s.id !== 'type')
                  .map((s) => (
                    <SectionShell key={s.id} id={s.id}>
                      {renderEditorSection(s.id, config)}
                    </SectionShell>
                  ))
              )}
            </AccordionStaticProvider>
          </div>
        </ScrollArea>
      </div>
      </div>
    </div>
  );
}
