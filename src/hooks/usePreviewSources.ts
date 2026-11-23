import { canAppendEndorsement } from '@/lib/appendedEndorsement';
import { ambiguousEndorsementBodySources } from '@/lib/previewSourceProvenance';
import { useUIStore } from '@/stores/uiStore';
import { isOutputFieldActive } from '@/lib/documentFields';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from '@/components/layout/editorSections';
import { previewSourcesWithinBudget, type PreviewFollowMode, type PreviewSource } from '@/lib/previewSources';

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
  const sourceInventory = useMemo(() => {
    if (category === 'forms' || hasImportedPages) return { sources: [] as PreviewSource[], navigationLimited: false };
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
    if (supportsBody) for (const [index, paragraph] of paragraphs.entries()) {
      if (paragraph.id && paragraph.text) anchors.push({ id: paragraph.id, paragraphId: paragraph.id, sectionId: 'body', label: `Paragraph ${index + 1}`, text: paragraph.text });
    }
    // Competing native prose must fit the budget before provenance normalizes it.
    const endorsementCharacters = canAppendEndorsement(docType) && formData.appendEndorsement
      ? (formData.endorsementBody?.length ?? 0) + (formData.additionalEndorsements ?? []).reduce((sum, item) => sum + (item.endorsementBody?.length ?? 0), 0) : 0;
    const navigationLimited = !previewSourcesWithinBudget(anchors, endorsementCharacters);
    if (navigationLimited) return { sources: [] as PreviewSource[], navigationLimited };
    const ambiguous = ambiguousEndorsementBodySources(docType, formData, paragraphs);
    return { sources: anchors.filter(source => !source.paragraphId || !ambiguous.has(source.paragraphId)), navigationLimited };
  }, [paragraphs, supportsBody, formData, docType, category, sections, hasImportedPages]);
  const { sources, navigationLimited } = sourceInventory;
  const [followMode, setFollowMode] = useState<PreviewFollowMode>('off');
  const follow = followMode === 'preview' && !navigationLimited;
  const [editorSelection, setEditorSelection] = useState<{ source: PreviewSource; owner: ReturnType<typeof captureDocumentTarget> } | null>(null);
  // Crossing the limit ends the session; shrinking the document must not
  // revive a previous selection or restart a cancelled PDF search.
  if (navigationLimited && editorSelection !== null) setEditorSelection(null);
  if (navigationLimited && followMode !== 'off') setFollowMode('off');
  useEffect(() => {
    if (!enabled || mobileSurface || followMode !== 'editor') return;
    const select = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.workspace-editor')) return;
      const paragraphId = target.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
      const field = target.closest('[id]');
      const source = sources.find(item => item.paragraphId ? item.paragraphId === paragraphId : item.fieldId === field?.id);
      if (source) setEditorSelection({ source, owner: captureDocumentTarget() });
    };
    document.addEventListener('focusin', select);
    document.addEventListener('pointerup', select);
    return () => {
      document.removeEventListener('focusin', select);
      document.removeEventListener('pointerup', select);
    };
  }, [enabled, followMode, mobileSurface, sources]);
  const sourceToReveal = enabled && followMode === 'editor' && editorSelection
    && isCurrentDocumentTarget(editorSelection.owner)
    ? sources.find(source => source.id === editorSelection.source.id && source.text === editorSelection.source.text) : undefined;
  const changeFollowMode = (mode: typeof followMode) => { setEditorSelection(null); setFollowMode(mode); };
  const pauseEditorFollow = () => setEditorSelection(null);
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
  const unavailableMessage = hasImportedPages
    ? 'Source navigation is unavailable when attached PDFs are included.'
    : navigationLimited ? 'Source navigation is unavailable for this large document.' : undefined;
  return { sources, hasImportedPages, navigationLimited, unavailableMessage, sourceSubject: formData.subject ?? '', follow, setFollow: (value: boolean) => changeFollowMode(value ? 'preview' : 'off'), followMode, changeFollowMode, sourceToReveal, pauseEditorFollow, followSources, onMobileCloseAutoFocus, navigate: enabled && !navigationLimited ? navigate : undefined };
}
