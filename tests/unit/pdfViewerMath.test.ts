import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computePageLayout,
  contentHeight,
  visibleRange,
  currentPage,
  nextZoomStep,
  clampScrollTop,
  rescaleScrollTop,
  ZOOM_STEPS,
  DEFAULT_PAGE_ASPECT,
} from '@/components/pdf/pdfMath';

// A three-page US-Letter stack at 600px wide, 16px gaps, 24px padding:
// heights ≈ 776.47, tops at 24, 816.47, 1608.94.
const LETTER = DEFAULT_PAGE_ASPECT;
const layout3 = computePageLayout([LETTER, LETTER, LETTER], 600, 16, 24);

describe('computePageLayout / contentHeight', () => {
  it('stacks pages with gaps and padding', () => {
    expect(layout3).toHaveLength(3);
    expect(layout3[0].top).toBe(24);
    expect(layout3[0].height).toBeCloseTo(600 / LETTER, 5);
    expect(layout3[1].top).toBeCloseTo(24 + layout3[0].height + 16, 5);
    expect(contentHeight(layout3, 24)).toBeCloseTo(layout3[2].top + layout3[2].height + 24, 5);
  });

  it('guards a zero/negative aspect with the US-Letter default', () => {
    const [broken] = computePageLayout([0], 600, 16, 24);
    expect(broken.height).toBeCloseTo(600 / DEFAULT_PAGE_ASPECT, 5);
  });

  it('empty layout still reports the padding as content height', () => {
    expect(contentHeight([], 24)).toBe(48);
  });
});

describe('visibleRange', () => {
  it('returns only the first page when the viewport sits at the top with no overscan', () => {
    expect(visibleRange(0, 400, layout3, 0)).toEqual([0, 0]);
  });

  it('overscan pulls in the neighbor page', () => {
    // Viewport bottom at 400; page 2 starts ~816 — a full-viewport overscan reaches it.
    expect(visibleRange(0, 400, layout3, 500)).toEqual([0, 1]);
  });

  it('clamps to the nearest page when scrolled past all content', () => {
    expect(visibleRange(99_999, 400, layout3, 0)).toEqual([2, 2]);
  });

  it('property: range is always within bounds and ordered', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.array(fc.double({ min: 0.3, max: 3, noNaN: true }), { minLength: 1, maxLength: 30 }),
        (scrollTop, viewportH, overscan, aspects) => {
          const layout = computePageLayout(aspects, 600, 16, 24);
          const [first, last] = visibleRange(scrollTop, viewportH, layout, overscan);
          return first >= 0 && last < layout.length && first <= last;
        }
      )
    );
  });
});

describe('currentPage', () => {
  it('reports the page covering the viewport center, owning its trailing gap', () => {
    expect(currentPage(0, 400, layout3)).toBe(1);
    // Center inside the gap right after page 1 still reads as page 1.
    const gapCenterScroll = layout3[0].height + 24 + 8 - 200; // center ≈ in the gap
    expect(currentPage(gapCenterScroll, 400, layout3)).toBe(1);
    expect(currentPage(layout3[2].top, 400, layout3)).toBe(3);
  });

  it('property: monotonically non-decreasing in scrollTop', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.3, max: 3, noNaN: true }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 100, max: 1500 }),
        fc.array(fc.integer({ min: 0, max: 30_000 }), { minLength: 2, maxLength: 10 }),
        (aspects, viewportH, scrolls) => {
          const layout = computePageLayout(aspects, 600, 16, 24);
          const sorted = [...scrolls].sort((a, b) => a - b);
          const pages = sorted.map((s) => currentPage(s, viewportH, layout));
          return pages.every((p, i) => i === 0 || p >= pages[i - 1]);
        }
      )
    );
  });
});

describe('nextZoomStep', () => {
  it('steps up and down through the discrete stops', () => {
    expect(nextZoomStep(1.0, 1)).toBe(1.1);
    expect(nextZoomStep(1.0, -1)).toBe(0.9);
  });

  it('snaps a non-step fit-width scale into the ladder', () => {
    expect(nextZoomStep(0.93, 1)).toBe(1.0);
    expect(nextZoomStep(0.93, -1)).toBe(0.9);
  });

  it('clamps at both ends', () => {
    expect(nextZoomStep(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(nextZoomStep(ZOOM_STEPS[0], -1)).toBe(ZOOM_STEPS[0]);
  });

  it('property: up-then-down from any step returns to it (round-trip)', () => {
    for (let i = 1; i < ZOOM_STEPS.length - 1; i++) {
      const up = nextZoomStep(ZOOM_STEPS[i], 1);
      expect(nextZoomStep(up, -1)).toBe(ZOOM_STEPS[i]);
    }
  });
});

describe('clampScrollTop / rescaleScrollTop', () => {
  it('clamps into the valid scroll range', () => {
    expect(clampScrollTop(-10, 2000, 400)).toBe(0);
    expect(clampScrollTop(5000, 2000, 400)).toBe(1600);
    expect(clampScrollTop(800, 2000, 400)).toBe(800);
  });

  it('content shorter than the viewport clamps to zero', () => {
    expect(clampScrollTop(300, 200, 400)).toBe(0);
  });

  it('keeps the viewport center anchored across a content-height change', () => {
    // Center at 1000 of 2000 (ratio .5) → new center 2000 of 4000.
    expect(rescaleScrollTop(800, 400, 2000, 4000)).toBeCloseTo(1800, 5);
    // Shrinking maps back symmetrically.
    expect(rescaleScrollTop(1800, 400, 4000, 2000)).toBeCloseTo(800, 5);
  });

  it('degenerate old height rescales to the top', () => {
    expect(rescaleScrollTop(500, 400, 0, 2000)).toBe(0);
  });
});
