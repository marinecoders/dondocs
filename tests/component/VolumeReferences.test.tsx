import { act, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { lineToHtml } from '@/components/ui/variable-chip-editor-text';
import { emptyPublicationVolume, volumeReferenceToken } from '@/lib/publicationVolume';
import { useDocumentStore } from '@/stores/documentStore';

it('shows live reference labels while preserving exact lowercase and hyphenated target identities', async () => {
  const volume = emptyPublicationVolume();
  volume.chapters.push({ id: 'chapter-second', title: 'Maintenance', sections: [{ id: 'section-second', title: 'Checks' }] });
  const paragraphs = [{ id: 'body-one', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Intro', level: 0 }];
  useDocumentStore.setState({ docType: 'technical_volume', formData: { volume }, paragraphs });
  const text = `See ${volumeReferenceToken(volume.chapters[0].id)} and ${volumeReferenceToken('body-one')}.`;
  const onChange = vi.fn();
  const { container } = render(<VariableChipEditor value={text} onChange={onChange} ariaLabel="Volume body" />);
  const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(dom.editor).toBeDefined());
  expect([...dom.querySelectorAll('[data-type="variable"]')].map(node => node.textContent)).toEqual(['@Chapter 1', '@1.1.1']);
  expect(dom.textContent).not.toContain('VOLREF_');
  act(() => { useDocumentStore.getState().setVolumeContent({ ...volume, chapters: [...volume.chapters].reverse() }); });
  expect([...dom.querySelectorAll('[data-type="variable"]')].map(node => node.textContent)).toEqual(['@Chapter 2', '@2.1.1']);
  act(() => { dom.editor.commands.insertContentAt(dom.editor.state.doc.content.size - 1, ' Updated.'); });
  expect(onChange).toHaveBeenLastCalledWith(`${text} Updated.`);
});

it('escapes resolved chip labels before HTML parsing', () => {
  const title = '<img src=x onerror=alert(1)> "Injected" & text';
  const wrapper = document.createElement('div');
  wrapper.innerHTML = lineToHtml('{{VOLREF_body-one}}', { getVariableLabel: () => title });
  expect(wrapper.querySelector('img')).toBeNull();
  expect(wrapper.querySelector('[data-type="variable"]')?.getAttribute('data-label')).toBe(title);
  expect(wrapper.textContent).toBe(`@${title}`);
});

it('shows a live chip for a valid target identity containing paired underscores', async () => {
  const volume = emptyPublicationVolume();
  const paragraphs = [{ id: 'body__stable__id', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Intro', level: 0 }];
  useDocumentStore.setState({ docType: 'technical_volume', formData: { volume }, paragraphs });
  const text = `See ${volumeReferenceToken(paragraphs[0].id)}.`;
  const onChange = vi.fn();
  const { container } = render(<VariableChipEditor value={text} onChange={onChange} ariaLabel="Underscore volume reference" />);
  const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(dom.editor).toBeDefined());
  expect(dom.querySelector('[data-type="variable"]')?.textContent).toBe('@1.1.1');
  act(() => { dom.editor.commands.insertContentAt(dom.editor.state.doc.content.size - 1, ' Updated.'); });
  expect(onChange).toHaveBeenLastCalledWith(`${text} Updated.`);
});
