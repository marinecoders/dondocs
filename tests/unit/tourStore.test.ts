/**
 * tourStore drives both the first-run product tour and the guide's per-feature
 * "Show me" spotlights. The two share one overlay but must not share one fate:
 * dismissing a one-off spotlight must NOT record the first-run tour as seen,
 * or a brand-new user who clicks "Show me" before the intro tour would never
 * get the intro. These tests lock in that boundary (the `markOnEnd` guard) plus
 * the basics of the generalized step set.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTourStore, hasCompletedTour } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { TOUR_STEPS, visibleTourSteps, type TourStep } from '@/components/tour/tourSteps';

// jsdom does no layout, so getClientRects() is always empty. Mount a stand-in
// element for each selector and stub getClientRects so visibleTourSteps sees it
// as laid out — mirroring a real browser where the target is on screen.
const mounted: HTMLElement[] = [];
function mountTargets(selectors: string[]): void {
  for (const sel of selectors) {
    const name = sel.match(/\[data-tour="(.+?)"\]/)?.[1];
    if (!name || document.querySelector(sel)) continue;
    const el = document.createElement('div');
    el.setAttribute('data-tour', name);
    el.getClientRects = () => [{ width: 10, height: 10 } as DOMRect] as unknown as DOMRectList;
    document.body.appendChild(el);
    mounted.push(el);
  }
}
function mountAllTourTargets(): void {
  mountTargets(TOUR_STEPS.map((s) => s.target).filter((t): t is string => !!t));
}

const SPOTLIGHT = [
  { target: '[data-tour="batch"]', title: 'Batch lives here', body: 'Open this to generate one per row.' },
];

const TWO_STEP = [
  { target: '[data-tour="a"]', title: 'A', body: 'first' },
  { target: '[data-tour="b"]', title: 'B', body: 'second' },
];

describe('tourStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({ active: false, stepIndex: 0, steps: TOUR_STEPS, markOnEnd: true, completionKey: null });
    useOnboardingStore.setState({ completed: {} });
  });

  afterEach(() => {
    mounted.splice(0).forEach((el) => el.remove());
  });

  it('start() runs the full intro tour and ending records it as seen', () => {
    mountAllTourTargets(); // every target on screen → no step filtered out
    useTourStore.getState().start();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().steps).toEqual(TOUR_STEPS);

    useTourStore.getState().end();
    expect(useTourStore.getState().active).toBe(false);
    expect(hasCompletedTour()).toBe(true);
  });

  it('start() drops steps whose target is absent from the current layout', () => {
    // Mount every target except the two Header controls that are hidden below xl.
    mountTargets(
      TOUR_STEPS.map((s) => s.target).filter(
        (t): t is string => !!t && t !== '[data-tour="appearance"]' && t !== '[data-tour="help"]'
      )
    );
    useTourStore.getState().start();
    const steps = useTourStore.getState().steps;
    expect(steps).toHaveLength(TOUR_STEPS.length - 2);
    expect(steps.some((s) => s.target === '[data-tour="appearance"]')).toBe(false);
    expect(steps.some((s) => s.target === '[data-tour="help"]')).toBe(false);
  });

  it('startSteps() spotlights ad-hoc steps without marking the first-run tour seen', () => {
    useTourStore.getState().startSteps(SPOTLIGHT);
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().steps).toEqual(SPOTLIGHT);

    useTourStore.getState().end();
    expect(useTourStore.getState().active).toBe(false);
    // The one-off spotlight must not stand in for the first-run intro tour.
    expect(hasCompletedTour()).toBe(false);
  });

  it('next() ends based on the active step set, not the intro-tour length', () => {
    useTourStore.getState().startSteps(SPOTLIGHT); // single step
    useTourStore.getState().next(); // advancing past the only step closes it
    expect(useTourStore.getState().active).toBe(false);
  });

  it('startSteps([]) is a no-op', () => {
    useTourStore.getState().startSteps([]);
    expect(useTourStore.getState().active).toBe(false);
  });

  it('end() resets back to the intro tour for the next first-run check', () => {
    useTourStore.getState().startSteps(SPOTLIGHT);
    useTourStore.getState().end();
    expect(useTourStore.getState().steps).toBe(TOUR_STEPS);
    expect(useTourStore.getState().markOnEnd).toBe(true);
  });

  it('finishing a walkthrough marks its onboarding key learned', () => {
    useTourStore.getState().startSteps(TWO_STEP, 'enclosures');
    useTourStore.getState().next(); // step 1 -> 2
    useTourStore.getState().next(); // past the last step = finished
    expect(useTourStore.getState().active).toBe(false);
    expect(useOnboardingStore.getState().completed.enclosures).toBe(true);
  });

  it('exiting a walkthrough early does NOT mark it learned', () => {
    useTourStore.getState().startSteps(TWO_STEP, 'enclosures');
    useTourStore.getState().next(); // advance to step 2 (not finished)
    useTourStore.getState().end();  // user hits the corner X / Esc
    expect(useOnboardingStore.getState().completed.enclosures).toBeUndefined();
  });

  it('a walkthrough with no key never touches onboarding', () => {
    useTourStore.getState().startSteps(SPOTLIGHT); // no completionKey
    useTourStore.getState().next(); // single step -> finishes
    expect(useOnboardingStore.getState().completed).toEqual({});
  });
});

describe('visibleTourSteps', () => {
  afterEach(() => {
    mounted.splice(0).forEach((el) => el.remove());
  });

  it('keeps a step whose target is on screen and drops one whose target is absent', () => {
    mountTargets(['[data-tour="present"]']);
    const steps: TourStep[] = [
      { target: '[data-tour="present"]', title: 'Present', body: 'here' },
      { target: '[data-tour="absent"]', title: 'Absent', body: 'gone' },
    ];
    expect(visibleTourSteps(steps)).toEqual([steps[0]]);
  });

  it('always keeps a centered step (no target) and an action step (mounts its own target)', () => {
    const steps: TourStep[] = [
      { title: 'Centered', body: 'no target' },
      { target: '[data-tour="absent"]', title: 'Opens surface', body: 'x', action: () => {} },
    ];
    expect(visibleTourSteps(steps)).toEqual(steps);
  });
});
