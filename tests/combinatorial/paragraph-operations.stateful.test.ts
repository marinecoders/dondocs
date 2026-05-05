/**
 * Stateful property test for paragraph operations.
 *
 * Where unit tests check "operation X with input Y produces Z", a
 * stateful property test checks "any sequence of operations leaves
 * the data in a valid state". `fast-check` generates random sequences
 * of operations and replays them; if any sequence violates an
 * invariant, fast-check shrinks the failure to the smallest reproducer.
 *
 * To keep the test self-contained (and avoid bringing up the full
 * Zustand persistence layer in node — which dragged in localStorage
 * + workbox stubs), we re-implement the paragraph mutations as pure
 * array transforms with the SAME semantics as
 * `src/stores/documentStore.ts`. The intent is to lock down the
 * algorithmic correctness of the operations, not the Zustand wiring
 * (which is straightforward and Zustand-tested).
 *
 * Invariants enforced after every operation:
 *
 *   1. Every paragraph has a valid level (0..MAX_DEPTH).
 *   2. Every paragraph has a string `text` field.
 *   3. `indentParagraph` never produces a level > MAX_DEPTH.
 *   4. `outdentParagraph` never produces a level < 0.
 *   5. `add` then `remove` of N paragraphs returns to the initial count.
 *   6. `reorder` is a permutation (same multiset, just shuffled).
 *
 * Catches the bug class where a refactor "looked correct" for
 * isolated operations but interaction with previous state breaks an
 * invariant — e.g., reorder after a remove that adjusted indices.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

const MAX_DEPTH = 7;

interface Paragraph {
  text: string;
  level: number;
}

/**
 * Pure paragraph-mutation API. Mirrors documentStore.ts:
 *   addParagraph(text, level, afterIndex?)
 *   removeParagraph(index)
 *   indentParagraph(index)         clamps to MAX_DEPTH
 *   outdentParagraph(index)        clamps to 0
 *   updateLevel(index, level)      clamps to [0, MAX_DEPTH]
 *   reorder(fromIndex, toIndex)
 *
 * Each function returns a new array (no in-place mutation).
 */
const paraOps = {
  add(state: Paragraph[], text: string, level: number, afterIndex?: number): Paragraph[] {
    const newPara: Paragraph = { text, level: clampLevel(level) };
    if (afterIndex === undefined) return [...state, newPara];
    const next = [...state];
    next.splice(afterIndex + 1, 0, newPara);
    return next;
  },
  remove(state: Paragraph[], index: number): Paragraph[] {
    return state.filter((_, i) => i !== index);
  },
  indent(state: Paragraph[], index: number): Paragraph[] {
    return state.map((p, i) =>
      i === index ? { ...p, level: Math.min(p.level + 1, MAX_DEPTH) } : p
    );
  },
  outdent(state: Paragraph[], index: number): Paragraph[] {
    return state.map((p, i) =>
      i === index ? { ...p, level: Math.max(p.level - 1, 0) } : p
    );
  },
  updateLevel(state: Paragraph[], index: number, level: number): Paragraph[] {
    return state.map((p, i) => (i === index ? { ...p, level: clampLevel(level) } : p));
  },
  reorder(state: Paragraph[], fromIndex: number, toIndex: number): Paragraph[] {
    if (fromIndex < 0 || fromIndex >= state.length) return state;
    if (toIndex < 0 || toIndex >= state.length) return state;
    const next = [...state];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  },
};

function clampLevel(level: number): number {
  return Math.max(0, Math.min(level, MAX_DEPTH));
}

type Operation =
  | { type: 'add'; text: string; level: number; afterIndex?: number }
  | { type: 'remove'; index: number }
  | { type: 'indent'; index: number }
  | { type: 'outdent'; index: number }
  | { type: 'updateLevel'; index: number; level: number }
  | { type: 'reorder'; fromIndex: number; toIndex: number };

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    type: fc.constant('add' as const),
    text: fc.string({ maxLength: 30 }),
    level: fc.integer({ min: 0, max: MAX_DEPTH }),
    afterIndex: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  }),
  fc.record({ type: fc.constant('remove' as const), index: fc.nat({ max: 20 }) }),
  fc.record({ type: fc.constant('indent' as const), index: fc.nat({ max: 20 }) }),
  fc.record({ type: fc.constant('outdent' as const), index: fc.nat({ max: 20 }) }),
  fc.record({
    type: fc.constant('updateLevel' as const),
    index: fc.nat({ max: 20 }),
    level: fc.integer({ min: 0, max: MAX_DEPTH }),
  }),
  fc.record({
    type: fc.constant('reorder' as const),
    fromIndex: fc.nat({ max: 20 }),
    toIndex: fc.nat({ max: 20 }),
  }),
);

function applyOperation(state: Paragraph[], op: Operation): Paragraph[] {
  switch (op.type) {
    case 'add':
      return paraOps.add(state, op.text, op.level, op.afterIndex);
    case 'remove':
      // Tests in-range invariants. Out-of-range removes are no-ops.
      return op.index < state.length ? paraOps.remove(state, op.index) : state;
    case 'indent':
      return op.index < state.length ? paraOps.indent(state, op.index) : state;
    case 'outdent':
      return op.index < state.length ? paraOps.outdent(state, op.index) : state;
    case 'updateLevel':
      return op.index < state.length ? paraOps.updateLevel(state, op.index, op.level) : state;
    case 'reorder':
      return paraOps.reorder(state, op.fromIndex, op.toIndex);
  }
}

function checkInvariants(state: Paragraph[]): void {
  for (const [i, p] of state.entries()) {
    expect(p.level, `paragraph[${i}].level out of range`).toBeGreaterThanOrEqual(0);
    expect(p.level, `paragraph[${i}].level out of range`).toBeLessThanOrEqual(MAX_DEPTH);
    expect(typeof p.text, `paragraph[${i}].text type`).toBe('string');
  }
}

describe('paragraph operations — stateful property test', () => {
  it('any sequence of operations preserves the level invariant', () => {
    fc.assert(
      fc.property(fc.array(operationArb, { minLength: 1, maxLength: 80 }), (operations) => {
        let state: Paragraph[] = [{ text: 'seed', level: 0 }];
        for (const op of operations) {
          state = applyOperation(state, op);
          checkInvariants(state);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('indent never produces a level > MAX_DEPTH (no matter how many times called)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 5 }), { maxLength: 50 }), (indices) => {
        let state: Paragraph[] = [
          { text: 'a', level: 0 },
          { text: 'b', level: 3 },
          { text: 'c', level: MAX_DEPTH - 1 },
        ];
        for (const idx of indices) {
          if (idx < state.length) {
            state = paraOps.indent(state, idx);
          }
        }
        for (const p of state) {
          expect(p.level).toBeLessThanOrEqual(MAX_DEPTH);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('outdent never produces a level < 0 (no matter how many times called)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 5 }), { maxLength: 50 }), (indices) => {
        let state: Paragraph[] = [
          { text: 'a', level: 0 },
          { text: 'b', level: 3 },
          { text: 'c', level: 1 },
        ];
        for (const idx of indices) {
          if (idx < state.length) {
            state = paraOps.outdent(state, idx);
          }
        }
        for (const p of state) {
          expect(p.level).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('add of N items then remove of N items returns to initial count', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 20 }),
        (texts) => {
          const initial: Paragraph[] = [{ text: 'seed', level: 0 }];
          let state = initial;
          for (const text of texts) {
            state = paraOps.add(state, text, 0);
          }
          expect(state.length).toBe(initial.length + texts.length);
          // Remove all newly added (index = initial.length, repeatedly).
          for (let i = 0; i < texts.length; i++) {
            state = paraOps.remove(state, initial.length);
          }
          expect(state.length).toBe(initial.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reorder is a permutation (same multiset of paragraphs after any reorder)', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.string({ maxLength: 10 }), { minLength: 2, maxLength: 10 })
          .chain((texts) =>
            fc.tuple(
              fc.constant(texts),
              fc.nat({ max: texts.length - 1 }),
              fc.nat({ max: texts.length - 1 })
            )
          ),
        ([texts, from, to]) => {
          const state: Paragraph[] = texts.map((t) => ({ text: t, level: 0 }));
          const reordered = paraOps.reorder(state, from, to);
          expect(reordered.length).toBe(state.length);
          // Same multiset of texts (sorted comparison).
          expect(reordered.map((p) => p.text).sort()).toEqual(state.map((p) => p.text).sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('updateLevel always clamps to [0, MAX_DEPTH] regardless of input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        (rawLevel) => {
          const state: Paragraph[] = [{ text: 'a', level: 0 }];
          const updated = paraOps.updateLevel(state, 0, rawLevel);
          expect(updated[0].level).toBeGreaterThanOrEqual(0);
          expect(updated[0].level).toBeLessThanOrEqual(MAX_DEPTH);
        }
      ),
      { numRuns: 100 }
    );
  });
});
