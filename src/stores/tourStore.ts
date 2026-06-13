import { create } from 'zustand';
import { TOUR_STEPS, type TourStep } from '@/components/tour/tourSteps';

const TOUR_STORAGE_KEY = 'dondocs-tour-completed';
// Version of the TOUR CONTENT (not the app). Bump when the steps change
// meaningfully so the first-run tour replays once for returning users.
const TOUR_VERSION = '1';

interface TourState {
  active: boolean;
  stepIndex: number;
  /** The steps currently being shown — the full intro tour, or an ad-hoc
   *  spotlight launched from the guide's "Show me" buttons. */
  steps: TourStep[];
  /** Whether ending should record the first-run flag. Only the intro tour
   *  marks itself seen; a one-off "Show me" spotlight must not. */
  markOnEnd: boolean;
  /** Open the full intro tour from the first step (replays + first-run). */
  start: () => void;
  /** Spotlight an arbitrary set of steps (e.g. one feature's location). */
  startSteps: (steps: TourStep[]) => void;
  next: () => void;
  prev: () => void;
  /** Close the tour and mark it seen so first-run does not nag again. */
  end: () => void;
}

// A closing Radix dialog (e.g. the welcome modal) can leave
// `pointer-events: none` stuck on <body>, which would make the tour — and
// the whole app — unclickable. Clear it whenever the tour opens or closes.
function clearBodyPointerLock(): void {
  try {
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
  } catch {
    /* no DOM */
  }
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  stepIndex: 0,
  steps: TOUR_STEPS,
  markOnEnd: true,
  start: () => {
    clearBodyPointerLock();
    set({ active: true, stepIndex: 0, steps: TOUR_STEPS, markOnEnd: true });
  },
  startSteps: (steps) => {
    if (steps.length === 0) return;
    clearBodyPointerLock();
    set({ active: true, stepIndex: 0, steps, markOnEnd: false });
  },
  next: () => {
    const { stepIndex, steps } = get();
    if (stepIndex >= steps.length - 1) {
      get().end();
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  end: () => {
    // Mark seen whether the user finished or skipped — first-run is one-time;
    // explicit replays via start() ignore this flag. A "Show me" spotlight
    // (markOnEnd === false) must not stand in for the first-run tour.
    if (get().markOnEnd) {
      try {
        localStorage.setItem(TOUR_STORAGE_KEY, TOUR_VERSION);
      } catch {
        /* storage unavailable — nothing to persist */
      }
    }
    clearBodyPointerLock();
    set({ active: false, stepIndex: 0, steps: TOUR_STEPS, markOnEnd: true });
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
