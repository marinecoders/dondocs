import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tracks which feature walkthroughs the user has finished, so the guide can
 * show onboarding progress (checks per feature + an overall tally). A feature
 * is marked learned only when its "Walk me through it" tour reaches the last
 * step — skipping or exiting early does not count. Persisted to localStorage.
 */
interface OnboardingState {
  /** Feature key → learned. Absent/false means not yet completed. */
  completed: Record<string, boolean>;
  markComplete: (key: string) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: {},
      markComplete: (key) =>
        set((s) => (s.completed[key] ? s : { completed: { ...s.completed, [key]: true } })),
    }),
    { name: 'dondocs-onboarding' }
  )
);
