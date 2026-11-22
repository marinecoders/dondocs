import { ambiguousEndorsementBodySources } from '@/lib/previewSourceProvenance';
import { useUIStore } from '@/stores/uiStore';
import { isOutputFieldActive } from '@/lib/documentFields';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from '@/components/layout/editorSections';
import type { PreviewSource } from '@/lib/previewSources';

/** Source controls are opt-in on the live editor preview, never package/review PDFs. */
export function usePreviewSources(disabled: boolean, mobileSurface = false) {
  const previewVisible = useUIStore(s => s.previewVisible);
  const isMobile = useUIStore(s => s.isMobile);
  const mobilePreviewOpen = useUIStore(s => s.mobilePreviewOpen);
  const enabled = !disabled && (mobileSurface ? isMobile && mobilePreviewOpen : previewVisible && !isMobile);
  const active = useRef(true);
  const navigationRequest = useRef(0);
  const enabledRef = useRef(enabled);
  const pendingMobileFocus = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    enabledRef.current = enabled;
    if (disabled || (!mobileSurface && !enabled)) { navigationRequest.current++; pendingMobileFocus.current = null; }
    if (mobileSurface && mobilePreviewOpen) pendingMobileFocus.current = null;
  }, [enabled, disabled, mobileSurface, mobilePreviewOpen]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const paragraphs = useDocumentStore(s => s.paragraphs);
  const formData = useDocumentStore(s => s.formData);
  const enclosures = useDocumentStore(s => s.enclosures);
  const docType = useDocumentStore(s => s.docType);
  const category = useDocumentStore(s => s.documentCategory);
  const { sections } = useEditorSections();
  const supportsBody = category !== 'forms' && sections.some(section => section.id === 'body');
  const hasImportedPages = (docType.endsWith('_endorsement') && !!(formData.basicLetterFile || formData.basicLetterFileRef))
    || (isOutputFieldActive(useDocumentStore.getState(), ['enclosures']) && enclosures.some(enclosure => enclosure.file || enclosure.fileRef));
  const sources = useMemo<PreviewSource[]>(() => {
    if (category === 'forms' || hasImportedPages) return [];
    const state = { ...useDocumentStore.getState(), docType };
    const fields = [
      ['subject', 'Subject', 'addressing'], ['from', 'From', 'addressing'], ['to', 'To', 'addressing'],
      ['unitLine1', 'Unit name', 'letterhead'], ['unitLine2', 'Unit name line 2', 'letterhead'],
      ['addressStreet', 'Street address', 'letterhead'], ['sigTitle', 'Signature position', 'signature'],
    ];
    const anchors: PreviewSource[] = fields.flatMap(([fieldId, label, sectionId]) => {
      const text = formData[fieldId as keyof typeof formData];
      return typeof text === 'string' && text.trim().length >= 12 && sections.some(section => section.id === sectionId) && isOutputFieldActive(state, ['formData', fieldId])
        ? [{ id: `field:${fieldId}`, fieldId, sectionId, label, text }] : [];
    });
    const ambiguous = ambiguousEndorsementBodySources(docType, formData, paragraphs);
    if (supportsBody) for (const [index, paragraph] of paragraphs.entries()) {
      if (paragraph.id && paragraph.text && !ambiguous.has(paragraph.id)) anchors.push({ id: paragraph.id, paragraphId: paragraph.id, sectionId: 'body', label: `Paragraph ${index + 1}`, text: paragraph.text });
    }
    return anchors;
  }, [paragraphs, supportsBody, formData, docType, category, sections, hasImportedPages]);
  const [follow, setFollow] = useState(false);
  const owner = captureDocumentTarget();
  function followSources(visible: PreviewSource[]) {
    if (!active.current || !follow || !enabled || !isCurrentDocumentTarget(owner)) return;
    // Never move a focused editor field or switch sections during typing.
    if (document.activeElement?.closest('.workspace-editor')) return;
    const source = visible.find(item => item.paragraphId && sources.includes(item));
    const section = document.getElementById('sec-body');
    if (!source || !section || section.closest('[hidden], [inert], [aria-hidden="true"]')) return;
    const row = [...section.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(element => element.dataset.paragraphId === source.paragraphId);
    row?.scrollIntoView({ block: 'nearest' });
  }
  function navigate(source: PreviewSource) {
    if (!active.current || !enabled || !isCurrentDocumentTarget(owner) || !sources.includes(source)) return;
    const request = ++navigationRequest.current;
    const focusOrigin = document.activeElement;
    const focusSource = () => {
      if ((!active.current && !mobileSurface) || request !== navigationRequest.current || !isCurrentDocumentTarget(owner)) return;
      useEditorOutlineStore.getState().jump(source.sectionId);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if ((!active.current && !mobileSurface) || (!mobileSurface && !enabledRef.current) || request !== navigationRequest.current || !isCurrentDocumentTarget(owner)) return;
        if (mobileSurface && (useUIStore.getState().mobilePreviewOpen || document.querySelector('[data-slot="dialog-content"][data-state="open"]'))) return;
        const section = document.getElementById(`sec-${source.sectionId}`);
        const focused = document.activeElement;
        if (focused !== focusOrigin && focused !== document.body && focused !== section) return;
        const row = [...(section?.querySelectorAll<HTMLElement>('[data-paragraph-id]') ?? [])].find(element => element.dataset.paragraphId === source.paragraphId);
        const field = source.fieldId ? document.getElementById(source.fieldId) : null;
        const target = (field && section?.contains(field) ? field : null) ?? row?.querySelector<HTMLElement>('[data-paragraph-field="text"]') ?? row?.querySelector<HTMLElement>('[contenteditable="true"], textarea, input');
        target?.focus({ preventScroll: true });
        (target ?? row)?.scrollIntoView({ block: 'nearest' });
      }));
    };
    if (mobileSurface) {
      // The modal is lazy-mounted by App, so this deliberate handoff finishes
      // from Radix close-autofocus after its focus trap has been removed.
      pendingMobileFocus.current = focusSource;
      useUIStore.getState().setMobilePreviewOpen(false);
    } else focusSource();
  }
  function onMobileCloseAutoFocus(event: Event) {
    const focus = pendingMobileFocus.current;
    pendingMobileFocus.current = null;
    if (!focus) return;
    event.preventDefault();
    focus();
  }
  return { sources, hasImportedPages, follow, setFollow, followSources, onMobileCloseAutoFocus, navigate: enabled ? navigate : undefined };
}
