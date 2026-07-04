/**
 * Steps for the guided product tour.
 *
 * Each step spotlights a real element (found by its `data-tour` attribute)
 * and explains it in a coachmark. Keep the set short — a tour earns its
 * keep by getting out of the way, not by narrating every control. If a
 * step's target is not on screen (e.g. hidden at a narrow breakpoint) the
 * overlay falls back to a centered card, so the tour never breaks.
 */
export interface TourStep {
  /** CSS selector for the element to spotlight. Omit for a centered card. */
  target?: string;
  title: string;
  body: string;
  /**
   * Optional side-effect run when this step becomes active — e.g. open the
   * modal or expand the section the target lives in, so a guided walkthrough
   * can spotlight a control that is not yet on screen. Must be idempotent: it
   * re-runs when the user navigates back to the step.
   */
  action?: () => void;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="category"]',
    title: 'Start here',
    body: 'Choose what you are writing: Department of the Navy correspondence, or a service form.',
  },
  {
    target: '[data-tour="doctype"]',
    title: 'Pick the format',
    body: 'Each document type is set up to match its governing instruction, so the layout is correct from the first keystroke.',
  },
  {
    target: '[data-tour="templates"]',
    title: 'Or start from a template',
    body: 'Load a ready-made document for common formats instead of starting from a blank page.',
  },
  {
    target: '[data-tour="download"]',
    title: 'Export when ready',
    body: 'Generate a print-ready PDF or a Word file. Everything compiles in your browser; nothing leaves your device.',
  },
  {
    target: '[data-tour="save"]',
    title: 'Save your work',
    body: 'Your draft autosaves in this browser; use Download or Share to keep a permanent copy. Save keeps a named copy you can reload later.',
  },
  {
    target: '[data-tour="save"]',
    title: 'Back up everything',
    body: 'This menu is also your safety net: "Back up everything" downloads one file with all your documents, profiles, signatures, and settings — restore it on any machine. On desktop Chrome or Edge, auto-backup can keep a file current after every save.',
  },
  {
    target: '[data-tour="appearance"]',
    title: 'Make it yours',
    body: 'Switch between light and dark mode and adjust the spacing here.',
  },
  {
    target: '[data-tour="help"]',
    title: 'Help lives here',
    body: 'Guides, keyboard shortcuts, bug reports, and feature ideas are all in this menu, and you can replay this tour from here anytime.',
  },
];

/**
 * Drop steps whose target isn't in the current layout, so the tour never
 * spotlights an element the user can't see. Two Header controls (appearance,
 * help) are `hidden xl:flex`, so on sub-1280px widths their steps would
 * otherwise fall back to a centered card describing invisible buttons. A step
 * with no target (a centered card) or an `action` (which mounts its own target)
 * is always kept — only steps that name an element already absent are removed.
 */
export function visibleTourSteps(steps: TourStep[] = TOUR_STEPS): TourStep[] {
  if (typeof document === 'undefined') return steps;
  return steps.filter((s) => {
    if (!s.target || s.action) return true;
    const el = document.querySelector(s.target);
    return !!el && (el as HTMLElement).getClientRects().length > 0;
  });
}
