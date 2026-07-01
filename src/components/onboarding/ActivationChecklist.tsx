import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  X,
  ArrowRight,
  PartyPopper,
  GraduationCap,
  UserPlus,
  FileText,
  Compass,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { TourButton } from '@/components/tour/TourButton';
import { ProgressRing } from './ProgressRing';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useProfileStore } from '@/stores/profileStore';
import { useTourStore, GUIDED_TOUR_KEY } from '@/stores/tourStore';
import { useUIStore } from '@/stores/uiStore';

// The 7 power-feature keys the guide tracks; "all learned" is one checklist step.
const POWER_KEYS = ['batch', 'profiles', 'templates', 'enclosures', 'signature', 'share', 'classification'] as const;
// Profiles the app ships with; a non-default name counts as user-created.
const DEFAULT_PROFILE_NAMES = ['Marine Innovation Unit'];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface ChecklistRow {
  glyph: LucideIcon;
  title: string;
  sub: string;
  done: boolean;
  /** Shown in place of the arrow while incomplete (e.g. the features tally). */
  badge?: string;
  action: () => void;
}

/**
 * Floating getting-started checklist. A collapsed pill (progress ring + "Get set
 * up") expands into a card tracking the four onboarding steps; finishing all four
 * fires a one-off celebration and retires the launcher. Dismissible and re-openable
 * from Help. Hidden while the product tour runs.
 *
 * Completion is derived live from the stores (tour flag, non-default profile,
 * first_document milestone, the 7 feature walkthroughs). Only the launcher's own
 * dismissed/celebrated lifecycle is persisted.
 */
export function ActivationChecklist() {
  const completed = useOnboardingStore((s) => s.completed);
  const profiles = useProfileStore((s) => s.profiles);
  const dismissed = useOnboardingStore((s) => s.checklistDismissed);
  const celebrated = useOnboardingStore((s) => s.checklistCelebrated);
  const setDismissed = useOnboardingStore((s) => s.setChecklistDismissed);
  const setCelebrated = useOnboardingStore((s) => s.setChecklistCelebrated);
  // Hide the launcher while a tour is running so they don't compete.
  const tourActive = useTourStore((s) => s.active);
  // On mobile the Preview PDF FAB owns the bottom-right corner; hide this so they
  // don't overlap.
  const isMobile = useUIStore((s) => s.isMobile);

  // Credit the tour only when finished (reaching the last step marks
  // GUIDED_TOUR_KEY); skipping or exiting doesn't count.
  const tourDone = !!completed[GUIDED_TOUR_KEY];
  const profileDone = Object.keys(profiles).some((n) => !DEFAULT_PROFILE_NAMES.includes(n));
  const docDone = !!completed['first_document'];
  const learnedCount = POWER_KEYS.filter((k) => completed[k]).length;
  const featuresDone = learnedCount === POWER_KEYS.length;

  const rows: ChecklistRow[] = [
    {
      glyph: GraduationCap,
      title: 'Take the guided tour',
      sub: 'A 60-second look around the editor',
      done: tourDone,
      action: () => useTourStore.getState().start(),
    },
    {
      glyph: UserPlus,
      title: 'Create your command profile',
      sub: 'Save your letterhead and signature once, reuse everywhere',
      done: profileDone,
      // Deselect first so the modal opens in Create mode; otherwise the
      // default profile selected on load would lock it into Edit mode and this
      // step could never complete. Mirrors ProfileBar's create action.
      action: () => {
        useProfileStore.getState().selectProfile(null);
        useUIStore.getState().setProfileModalOpen(true);
      },
    },
    {
      glyph: FileText,
      title: 'Build your first document',
      sub: 'Pick a template and export a PDF',
      done: docDone,
      action: () => useUIStore.getState().setTemplateLoaderOpen(true),
    },
    {
      glyph: Compass,
      title: 'Explore the power features',
      sub: 'Batch, sharing, classification, and more',
      done: featuresDone,
      badge: featuresDone ? undefined : `${learnedCount}/${POWER_KEYS.length}`,
      action: () => {
        useUIStore.getState().setDocumentGuideTab('features');
        useUIStore.getState().setDocumentGuideOpen(true);
      },
    },
  ];

  const done = rows.filter((r) => r.done).length;
  const total = rows.length;

  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Celebration is derived: shown while every step is done but checklistCelebrated
  // hasn't been set. The effect retires it after a beat; "Start drafting" at once.
  const showCelebration = done === total && !celebrated;
  useEffect(() => {
    if (!showCelebration) return;
    const t = window.setTimeout(() => setCelebrated(true), 4500);
    return () => window.clearTimeout(t);
  }, [showCelebration, setCelebrated]);

  // On open, focus the first actionable row, or the card itself when every row is
  // done (a disabled button can't take focus). Escape collapses, handled at the
  // window in capture phase so it works wherever focus landed.
  useEffect(() => {
    if (open) {
      const card = cardRef.current;
      const firstEnabled = card?.querySelector<HTMLButtonElement>('ul button:not([disabled])');
      (firstEnabled ?? card)?.focus();
      wasOpen.current = true;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        setOpen(false);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }
    // Collapsed: return focus to the pill, but only when returning from the open
    // card, never on initial mount.
    if (wasOpen.current) {
      wasOpen.current = false;
      pillRef.current?.focus();
    }
  }, [open]);

  // The first-run tour owns the screen.
  if (tourActive) return null;
  // The mobile Preview FAB owns the corner (see isMobile note above).
  if (isMobile) return null;
  // A finished celebration retires the launcher for good.
  if (celebrated) return null;
  // Dismissed and hidden until re-opened from Help. The celebrated guard above
  // means a dismissed user who later finishes is retired without a surprise popup.
  if (dismissed && !celebrated) return null;

  const reduce = prefersReducedMotion();
  // The open effect handles focus; these just flip state.
  const collapse = () => setOpen(false);
  const hide = () => {
    setOpen(false);
    setDismissed(true);
  };

  // z-40: above page content but below Radix modals (z-50), so a modal a row
  // opens covers the pill rather than floating over the dim.
  const anchor = 'fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 origin-bottom-right';
  const cardChrome =
    'w-[340px] max-w-[calc(100vw-2.5rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-elevated overflow-hidden';
  const cardMotion = reduce ? '' : 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 ease-out';

  // ── Celebration ──────────────────────────────────────────────────────────
  if (showCelebration) {
    return (
      <div className={anchor}>
        <div className={`${cardChrome} ${cardMotion}`} role="dialog" aria-label="Onboarding complete">
          <div className="p-6 text-center">
            <div
              className={`mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400 ${
                reduce ? '' : 'animate-in zoom-in-50 duration-300'
              }`}
            >
              <PartyPopper className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold">Squared away</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything&apos;s in order — time to draft.
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              All steps complete. DonDocs is ready.
            </p>
            <TourButton className="mt-4" onClick={() => setCelebrated(true)}>
              Start drafting
            </TourButton>
          </div>
        </div>
      </div>
    );
  }

  // ── Collapsed pill ───────────────────────────────────────────────────────
  if (!open) {
    return (
      <div className={anchor}>
        <button
          ref={pillRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Get set up — ${done} of ${total} steps complete`}
          aria-expanded={false}
          aria-haspopup="dialog"
          className="inline-flex h-11 items-center gap-2.5 rounded-full border border-border bg-popover pl-1.5 pr-3.5 text-popover-foreground shadow-elevated outline-none transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-primary/40 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none max-sm:w-11 max-sm:justify-center max-sm:px-0"
        >
          <ProgressRing size={28} done={done} total={total} />
          <span className="hidden text-[13px] font-medium leading-none sm:inline">Get set up</span>
        </button>
      </div>
    );
  }

  // ── Expanded card ────────────────────────────────────────────────────────
  return (
    <div className={anchor}>
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`${cardChrome} ${cardMotion} outline-none`}
        role="dialog"
        aria-label="Getting started checklist"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <ProgressRing size={26} done={done} total={total} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">Getting started</div>
            <div className="text-xs text-muted-foreground">
              {done === total ? 'Squared away' : `${done} of ${total} done`}
            </div>
          </div>
          <button
            type="button"
            onClick={collapse}
            aria-label="Collapse checklist"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={hide}
            aria-label="Hide getting-started checklist"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Macro progress rail */}
        <div className="mx-4 mb-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
        <p className="sr-only" role="status" aria-live="polite">{`${done} of ${total} steps complete`}</p>

        {/* Items */}
        <ul className="p-1.5">
          {rows.map((row) => {
            const Glyph = row.glyph;
            return (
              <li key={row.title}>
                <button
                  type="button"
                  disabled={row.done}
                  onClick={() => {
                    row.action();
                    setOpen(false);
                  }}
                  aria-label={
                    row.done
                      ? `${row.title} — completed`
                      : row.badge
                        ? `${row.title} — ${row.badge.replace('/', ' of ')} learned`
                        : `${row.title} — not started`
                  }
                  className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    row.done ? 'cursor-default' : 'hover:bg-muted/60'
                  }`}
                >
                  {row.done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                  ) : (
                    <Glyph className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm font-medium leading-snug ${
                        row.done ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}
                    >
                      {row.title}
                    </div>
                    {!row.done && <div className="text-xs text-muted-foreground">{row.sub}</div>}
                  </div>
                  {!row.done &&
                    (row.badge ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {row.badge}
                      </span>
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    ))}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Reopen anytime from the Help menu.</p>
        </div>
      </div>
    </div>
  );
}
