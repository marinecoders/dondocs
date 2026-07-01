import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeLevels, canIndentAt, splitPastedParagraphs, migratePortionMarkings } from '@/lib/paragraphUtils';
import { useDocumentStore } from '@/stores/documentStore';

const lv = (levels: number[]) => levels.map((level, i) => ({ level, text: `p${i}` }));

describe('migratePortionMarkings — legacy FOUO folds into CUI', () => {
  it('rewrites FOUO to CUI (DoDI 5200.48) and leaves other markings untouched', () => {
    const out = migratePortionMarkings([
      { level: 0, text: 'a', portionMarking: 'FOUO' },
      { level: 0, text: 'b', portionMarking: 'S' },
      { level: 0, text: 'c' },
    ]);
    expect(out.map((p) => p.portionMarking)).toEqual(['CUI', 'S', undefined]);
  });

  it('returns the SAME array reference when there is no FOUO to migrate (no needless dirtying)', () => {
    const input = [
      { level: 0, text: 'a', portionMarking: 'CUI' as const },
      { level: 0, text: 'b' },
    ];
    expect(migratePortionMarkings(input)).toBe(input);
  });

  it('only clones the paragraphs it changes', () => {
    const keep = { level: 0, text: 'keep', portionMarking: 'C' as const };
    const legacy = { level: 0, text: 'x', portionMarking: 'FOUO' as const };
    const out = migratePortionMarkings([keep, legacy]);
    expect(out[0]).toBe(keep); // untouched paragraph preserved by identity
    expect(out[1]).not.toBe(legacy); // migrated one is a fresh object
    expect(out[1].portionMarking).toBe('CUI');
  });
});

describe('normalizeLevels — SECNAV nesting invariant', () => {
  it('forces the first paragraph to top level', () => {
    expect(normalizeLevels(lv([3, 0])).map((p) => p.level)).toEqual([0, 0]);
  });

  it('never lets a paragraph sit more than one level below its predecessor', () => {
    // 0 -> 2 is an illegal jump; clamps to 0 -> 1.
    expect(normalizeLevels(lv([0, 2])).map((p) => p.level)).toEqual([0, 1]);
    expect(normalizeLevels(lv([0, 1, 3, 1])).map((p) => p.level)).toEqual([0, 1, 2, 1]);
  });

  it('leaves an already-legal outline untouched (by identity)', () => {
    const input = lv([0, 1, 2, 1, 0]);
    const out = normalizeLevels(input);
    expect(out.map((p) => p.level)).toEqual([0, 1, 2, 1, 0]);
    out.forEach((p, i) => expect(p).toBe(input[i]));
  });

  it('repairs a stranded sub-paragraph after its parent is outdented', () => {
    // parent P1(1) had child P2(2); outdent P1 to 0 leaves P2 illegally at 2.
    expect(normalizeLevels(lv([0, 0, 2])).map((p) => p.level)).toEqual([0, 0, 1]);
  });
});

describe('canIndentAt', () => {
  it('refuses to indent the first paragraph', () => {
    expect(canIndentAt(lv([0, 0]), 0)).toBe(false);
  });
  it('allows indent only up to one level below the predecessor', () => {
    expect(canIndentAt(lv([0, 0]), 1)).toBe(true); // 0 -> 1 ok
    expect(canIndentAt(lv([0, 1]), 1)).toBe(false); // already one deeper
  });
});

describe('documentStore structural ops keep the outline legal', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('indentParagraph cannot create a two-level jump', () => {
    useDocumentStore.setState({ paragraphs: lv([0, 0]) });
    useDocumentStore.getState().indentParagraph(1); // 0 -> 1 (legal)
    expect(useDocumentStore.getState().paragraphs.map((p) => p.level)).toEqual([0, 1]);
    useDocumentStore.getState().indentParagraph(1); // would be 2, but prev is 0 -> no-op
    expect(useDocumentStore.getState().paragraphs.map((p) => p.level)).toEqual([0, 1]);
  });

  it('reorderParagraphs repairs nesting instead of stranding a child', () => {
    // [0, 1(child), 0] — move the child (idx 1) to the front; it can't stay level 1.
    useDocumentStore.setState({ paragraphs: lv([0, 1, 0]) });
    useDocumentStore.getState().reorderParagraphs(1, 0);
    expect(useDocumentStore.getState().paragraphs[0].level).toBe(0);
  });
});

describe('splitPastedParagraphs — a pasted draft becomes real blocks', () => {
  it('splits on blank lines', () => {
    expect(splitPastedParagraphs('First para.\n\nSecond para.\n\nThird.')).toEqual([
      'First para.',
      'Second para.',
      'Third.',
    ]);
  });
  it('splits on single newlines when there are no blank lines', () => {
    expect(splitPastedParagraphs('One\nTwo\nThree')).toEqual(['One', 'Two', 'Three']);
  });
  it('strips leading auto-enumerators (1. / a. / (1) / bullet)', () => {
    expect(splitPastedParagraphs('1. First\n\na. Second\n\n(3) Third\n\n• Fourth')).toEqual([
      'First',
      'Second',
      'Third',
      'Fourth',
    ]);
  });
  it('returns a single segment for one paragraph (so paste stays default)', () => {
    expect(splitPastedParagraphs('Just one paragraph.')).toEqual(['Just one paragraph.']);
    expect(splitPastedParagraphs('   ')).toEqual([]);
  });
});

describe('insertParagraphs — bulk insert keeps the outline legal', () => {
  beforeEach(() => useDocumentStore.getState().resetForm());
  it('splices multiple paragraphs after the index and normalizes levels', () => {
    useDocumentStore.setState({ paragraphs: lv([0, 0]) });
    useDocumentStore.getState().insertParagraphs(0, ['a', 'b'], 0);
    const paras = useDocumentStore.getState().paragraphs;
    expect(paras.map((p) => p.text)).toEqual(['p0', 'a', 'b', 'p1']);
    expect(paras.every((p) => p.level >= 0 && p.level <= 7)).toBe(true);
  });
});

describe('reorderParagraphs — a parent carries its sub-paragraphs', () => {
  beforeEach(() => useDocumentStore.getState().resetForm());
  const texts = () => useDocumentStore.getState().paragraphs.map((p) => p.text);
  const levels = () => useDocumentStore.getState().paragraphs.map((p) => p.level);

  it('keyboard move-down of a parent takes its child past the next sibling', () => {
    // A, B(parent) + b1(child), C  →  A, C, B, b1
    useDocumentStore.setState({
      paragraphs: [
        { level: 0, text: 'A' },
        { level: 0, text: 'B' },
        { level: 1, text: 'b1' },
        { level: 0, text: 'C' },
      ],
    });
    useDocumentStore.getState().reorderParagraphs(1, 2); // Alt+Down on B → targets its own child
    expect(texts()).toEqual(['A', 'C', 'B', 'b1']);
    expect(levels()).toEqual([0, 0, 0, 1]);
  });

  it('keyboard move-up of a parent takes its child above the previous sibling', () => {
    useDocumentStore.setState({
      paragraphs: [
        { level: 0, text: 'A' },
        { level: 0, text: 'B' },
        { level: 1, text: 'b1' },
        { level: 0, text: 'C' },
      ],
    });
    useDocumentStore.getState().reorderParagraphs(1, 0); // Alt+Up on B
    expect(texts()).toEqual(['B', 'b1', 'A', 'C']);
    expect(levels()).toEqual([0, 1, 0, 0]);
  });

  it('dragging a parent onto a later paragraph moves the whole subtree', () => {
    useDocumentStore.setState({
      paragraphs: [
        { level: 0, text: 'A' },
        { level: 0, text: 'B' },
        { level: 1, text: 'b1' },
        { level: 0, text: 'C' },
      ],
    });
    useDocumentStore.getState().reorderParagraphs(1, 3); // drop B onto C
    expect(texts()).toEqual(['A', 'C', 'B', 'b1']);
  });
});
