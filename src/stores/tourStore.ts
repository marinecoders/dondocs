import { create } from 'zustand';
import { TOUR_STEPS } from '@/components/tour/tourSteps';

const TOUR_STORAGE_KEY = 'dondocs-tour-completed';
// Version of the TOUR CONTENT (not the app). Bump when the steps change
// meaningfully so the first-run tour replays once for returning users.
const TOUR_VERSION = '1';

interface TourState {
  active: boolean;
  stepIndex: number;
  /** Open the tour from the first step (used by replays and first-run). */
  start: () => void;
  next: () => void;
  prev: () => void;
  /** Close the tour and mark it seen so first-run does not nag again. */
  end: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  stepIndex: 0,
  start: () => set({ active: true, stepIndex: 0 }),
  next: () => {
    const { stepIndex } = get();
    if (stepIndex >= TOUR_STEPS.length - 1) {
      get().end();
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  end: () => {
    // Mark seen whether the user finished or skipped — first-run is one-time;
    // explicit replays via start() ignore this flag.
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, TOUR_VERSION);
    } catch {
      /* storage unavailable — nothing to persist */
    }
    set({ active: false, stepIndex: 0 });
  },
}));

/** True once the user has seen the current tour version (first-run guard). */
export function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === TOUR_VERSION;
  } catch {
    return true; // if we cannot read storage, don't auto-start
  }
}
