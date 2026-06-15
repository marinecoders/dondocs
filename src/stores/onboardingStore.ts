import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tracks which feature walkthroughs the user has finished, so the guide can
 * show onboarding progress (checks per feature + an overall tally). A feature
 * is marked learned only when its "Walk me through it" tour reaches the last
 * step — skipping or exiting early does not count.
 *
 * Also backs the floating "getting started" activation checklist: the same
 * `completed` map carries a `first_document` milestone (set on the first PDF
 * export), and two flags govern the launcher's lifecycle — `checklistDismissed`
 * (the user hid it; reversible from Help) and `checklistCelebrated` (all steps
 * done, the one-time celebration has fired, retire it for good). Persisted to
 * localStorage; the whole store is saved (no partialize), so all of this
 * survives reloads.
 */
interface OnboardingState {
  /** Feature key → learned. Absent/false means not yet completed. Also holds
   *  the `first_document` checklist milestone (not one of the 7 features). */
  completed: Record<string, boolean>;
  markComplete: (key: string) => void;
  /** User hid the activation checklist launcher. Reversible via Help → Getting started. */
  checklistDismissed: boolean;
  /** Terminal: every step is done and the celebration has shown once — retire it. */
  checklistCelebrated: boolean;
  setChecklistDismissed: (v: boolean) => void;
  setChecklistCelebrated: (v: boolean) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: {},
      markComplete: (key) =>
        set((s) => (s.completed[key] ? s : { completed: { ...s.completed, [key]: true } })),
      checklistDismissed: false,
      checklistCelebrated: false,
      setChecklistDismissed: (v) => set({ checklistDismissed: v }),
      // Retiring the launcher also clears any lingering dismissal so no dead
      // `checklistDismissed: true` is left stranded once it's celebrated.
      setChecklistCelebrated: (v) =>
        set(v ? { checklistCelebrated: true, checklistDismissed: false } : { checklistCelebrated: v }),
    }),
    { name: 'dondocs-onboarding' }
  )
);
