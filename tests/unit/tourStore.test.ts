/**
 * tourStore drives both the first-run product tour and the guide's per-feature
 * "Show me" spotlights. The two share one overlay but must not share one fate:
 * dismissing a one-off spotlight must NOT record the first-run tour as seen,
 * or a brand-new user who clicks "Show me" before the intro tour would never
 * get the intro. These tests lock in that boundary (the `markOnEnd` guard) plus
 * the basics of the generalized step set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTourStore, hasCompletedTour } from '@/stores/tourStore';
import { TOUR_STEPS } from '@/components/tour/tourSteps';

const SPOTLIGHT = [
  { target: '[data-tour="batch"]', title: 'Batch lives here', body: 'Open this to generate one per row.' },
];

describe('tourStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({ active: false, stepIndex: 0, steps: TOUR_STEPS, markOnEnd: true });
  });

  it('start() runs the full intro tour and ending records it as seen', () => {
    useTourStore.getState().start();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().steps).toBe(TOUR_STEPS);

    useTourStore.getState().end();
    expect(useTourStore.getState().active).toBe(false);
    expect(hasCompletedTour()).toBe(true);
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
});
