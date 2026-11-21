import { useMemo } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from '@/components/layout/editorSections';
import type { PreviewSource } from '@/lib/previewSources';

/** Source controls are opt-in on the live editor preview, never package/review PDFs. */
export function usePreviewSources(disabled: boolean) {
  const paragraphs = useDocumentStore(s => s.paragraphs);
  const category = useDocumentStore(s => s.documentCategory);
  const { sections } = useEditorSections();
  const supportsBody = category !== 'forms' && sections.some(section => section.id === 'body');
  const sources = useMemo<PreviewSource[]>(() => supportsBody ? paragraphs.flatMap((paragraph, index) =>
    paragraph.id && paragraph.text ? [{ id: paragraph.id, paragraphId: paragraph.id, sectionId: 'body', label: `Paragraph ${index + 1}`, text: paragraph.text }] : []) : [], [paragraphs, supportsBody]);
  const owner = captureDocumentTarget();
  function navigate(source: PreviewSource) {
    if (disabled || !isCurrentDocumentTarget(owner) || !sources.includes(source)) return;
    useEditorOutlineStore.getState().jump(source.sectionId);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!isCurrentDocumentTarget(owner)) return;
      const section = document.getElementById(`sec-${source.sectionId}`);
      const row = [...(section?.querySelectorAll<HTMLElement>('[data-paragraph-id]') ?? [])].find(element => element.dataset.paragraphId === source.paragraphId);
      const target = row?.querySelector<HTMLElement>('[data-paragraph-field="text"]') ?? row?.querySelector<HTMLElement>('[contenteditable="true"], textarea, input');
      target?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    }));
  }
  return { sources, navigate: disabled ? undefined : navigate };
}
