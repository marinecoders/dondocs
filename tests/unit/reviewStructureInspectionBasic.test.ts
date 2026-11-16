import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { applyReviewStructure, captureReviewStructure, inspectReviewStructure } from '@/lib/reviewStructureSuggestions';

it.each(['insert-paragraph', 'delete-paragraph'] as const)('inspects %s without cloning unrelated document content', kind => {
  const source = createBlankSession();
  source.documentCategory = 'correspondence';source.docType = 'naval_letter';
  source.paragraphs = [{ id: crypto.randomUUID(), text: 'First.', level: 0 }, { id: crypto.randomUUID(), text: 'Second.', level: 0 }];
  const target = captureReviewStructure(source, kind === 'insert-paragraph'
    ? { kind, index: 1, text: 'Inserted.', level: 0 }
    : { kind, paragraphId: source.paragraphs[0].id! });
  const before = JSON.stringify(source), clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    expect(inspectReviewStructure(source, target)).toBe(true);
    expect(clone.mock.calls.filter(([value]) => value === source)).toHaveLength(0);
    const applied = applyReviewStructure(source, target);
    expect(applied.paragraphs.map(paragraph => paragraph.text)).toEqual(kind === 'insert-paragraph'
      ? ['First.', 'Inserted.', 'Second.'] : ['Second.']);
  } finally { clone.mockRestore(); }
  expect(JSON.stringify(source)).toBe(before);
});
