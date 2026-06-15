import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import { Button } from '@/components/ui/button';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 304;
const CARD_H_EST = 210; // initial estimate before the card is measured
const GAP = 12; // space between target and card
const PAD = 6; // spotlight padding around the target

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Choose a coachmark position that never covers the spotlight. Tries below,
 * above, right, then left of the padded spotlight rect — each candidate sits
 * fully outside it, so the highlighted control stays visible — and picks the
 * first that fits on screen. The card size is capped to the viewport first, so
 * the math never assumes a card larger than the screen.
 *
 * A side fits whenever the target is small enough on that axis to leave a
 * card-plus-gap band; combined with the adaptive scroll in `measure` (which
 * parks the target near an edge on short viewports), at least one side fits for
 * any normal control on any display. The fallback runs only when the highlighted
 * element is itself larger than the screen minus the card — then the card is
 * pinned to the roomiest edge so it covers as little of the spotlight as
 * possible (nothing can show both fully in that case).
 */
interface Placement {
  top: number;
  left: number;
  /** When set, cap the card to this height (it scrolls) so it fits a tight gap. */
  maxH?: number;
}

function placeCoachmark(rect: Rect, vw: number, vh: number, cardW: number, cardH: number): Placement {
  const cw = Math.min(cardW, vw - 2 * GAP);
  const ch = Math.min(cardH, vh - 2 * GAP);
  const sTop = rect.top - PAD;
  const sBottom = rect.top + rect.height + PAD;
  const sLeft = rect.left - PAD;
  const sRight = rect.left + rect.width + PAD;
  // Centered on the target for the vertical placements / on it for the side ones.
  const cx = clamp(rect.left + rect.width / 2 - cw / 2, GAP, vw - cw - GAP);
  const cy = clamp(rect.top + rect.height / 2 - ch / 2, GAP, vh - ch - GAP);

  // Try each side at the card's full size — each candidate is fully outside the
  // padded spotlight, so the highlight stays visible.
  if (sBottom + GAP + ch <= vh - GAP) return { top: sBottom + GAP, left: cx }; // below
  if (sTop - GAP - ch >= GAP) return { top: sTop - GAP - ch, left: cx }; // above
  if (sRight + GAP + cw <= vw - GAP) return { top: cy, left: sRight + GAP }; // right
  if (sLeft - GAP - cw >= GAP) return { top: cy, left: sLeft - GAP - cw }; // left

  // The card is taller than any side's gap. Drop it into the larger vertical
  // band and cap its height there — it scrolls internally — so it still never
  // covers the spotlight. Width is never capped, which keeps placement stable
  // (the card's measured natural height doesn't change under it).
  const gapBelow = vh - sBottom - 2 * GAP;
  const gapAbove = sTop - 2 * GAP;
  if (Math.max(gapBelow, gapAbove) >= 100) {
    return gapBelow >= gapAbove
      ? { top: sBottom + GAP, left: cx, maxH: gapBelow }
      : { top: GAP, left: cx, maxH: gapAbove };
  }
  // The highlight nearly fills the viewport (it's larger than the screen minus a
  // usable card) — overlap is unavoidable; pin the card to the bottom.
  return { top: clamp(vh - ch - GAP, GAP, vh - GAP), left: cx };
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Guided-tour overlay. Dims the page, spotlights the current step's target
 * (a box-shadow cutout), and anchors a coachmark beside it. Drives entirely
 * from `useTourStore`; renders nothing when the tour is inactive.
 *
 * The highlighted element is shown but not interactive — the tour is a
 * walkthrough, not a task, so navigation is via the card and the keyboard
 * (Esc to exit, arrows to move). If a step's target is missing or hidden,
 * the card centers and the spotlight is skipped, so the tour never breaks.
 */
export function TourOverlay() {
  const active = useTourStore((s) => s.active);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const steps = useTourStore((s) => s.steps);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const end = useTourStore((s) => s.end);

  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: CARD_H_EST });
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  // A one-off "Show me" spotlight is a single step; drop the step counter and
  // soften the action label so it doesn't read like a multi-step walkthrough.
  const isSingle = steps.length === 1;

  // Locate + track the target rect for the current step.
  useEffect(() => {
    if (!active || !step) return;
    const reduce = prefersReducedMotion();

    // A guided step may need to open the surface its target lives in (e.g. the
    // Batch modal) before the element exists. Run that side-effect first.
    step.action?.();

    // We re-query the selector on every tick rather than hold an element
    // reference. The overlay is passive, so the user can open and close the
    // surface underneath it: re-querying means a freshly-mounted modal is
    // caught within a tick, and a closed one yields "not found" → the spotlight
    // re-centers instead of stranding on stale coordinates.
    let scrolled: Element | null = null;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      // A target inside a closing/closed Radix dialog (a dismissed modal still
      // mounted for its exit animation) counts as gone — otherwise the
      // spotlight strands on a control the user just closed. Scoped to dialogs
      // so a collapsed accordion header (also data-state="closed", but visible)
      // can still be spotlighted.
      if (!el || el.closest('[role="dialog"][data-state="closed"]')) {
        setRect((prev) => (prev === null ? prev : null));
        scrolled = null;
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect((prev) => (prev === null ? prev : null)); // hidden / collapsed
        return;
      }
      // Reserve room for the card by where we park the target: center it when
      // the viewport is tall enough to also fit the card on one side (looks
      // best), otherwise pull the target to the top so a full card height stays
      // free below it. 'start' is always at least as good as 'center' for fitting
      // the card, so prefer it on any viewport too short to center — this is the
      // lever that keeps the card off the spotlight on small / landscape displays.
      const vh = window.innerHeight;
      const block: ScrollLogicalPosition =
        vh >= r.height + 2 * CARD_H_EST + 3 * GAP ? 'center' : 'start';
      if (scrolled !== el) {
        scrolled = el;
        el.scrollIntoView({ block, inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      } else if (r.top < -1 || r.bottom > vh + 1) {
        // The target was clipped — e.g. a section finished expanding and pushed
        // it off-screen. Re-anchor instantly so the spotlight follows. (Only on
        // real clipping, so an intentional top-parked target isn't re-scrolled.)
        el.scrollIntoView({ block, inline: 'nearest', behavior: 'auto' });
      }
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - r.top) < 0.5 &&
        Math.abs(prev.left - r.left) < 0.5 &&
        Math.abs(prev.width - r.width) < 0.5 &&
        Math.abs(prev.height - r.height) < 0.5
          ? prev // unchanged — skip the re-render
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };

    measure();
    const poll = window.setInterval(measure, 150);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [active, stepIndex, step]);

  // Keyboard controls + initial focus.
  useEffect(() => {
    if (!active) return;
    // The welcome dialog can leave pointer-events:none stuck on <body>; clear
    // it here (after render, so it wins over Radix's layout effects).
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only Escape is handled — typing and arrow keys flow to whatever field
      // is focused (the tour spotlights real inputs) and never drive the tour;
      // navigation happens solely through the on-card Back/Next buttons.
      if (e.key !== 'Escape') return;
      // Exit the tour. Capture-phase + stop so a spotlighted Radix dialog
      // doesn't also handle Escape and close itself, stranding the walkthrough.
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, stepIndex, end]);

  // Measure the card's real size so placement reserves the right amount of room
  // (the body length varies per step). Re-runs when the step content changes or
  // the target moves/resizes; the value guard makes redundant runs a no-op.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    // The card's NATURAL height, independent of any maxHeight cap we apply for
    // placement — so the measurement can't feed back into the cap and oscillate.
    // The body is the only flexible part, so swap its visible height for its
    // full content height: cardHeight - bodyVisible + bodyContent.
    const body = bodyRef.current;
    const h = body
      ? el.offsetHeight - body.clientHeight + body.scrollHeight
      : el.scrollHeight;
    setCardSize((p) => (p.w === w && p.h === h ? p : { w, h }));
  }, [active, stepIndex, rect]);

  if (!active || !step) return null;

  // Position the coachmark beside the target — below / above / right / left,
  // whichever fits — so it never covers the spotlight. On a viewport too small
  // for the card beside the target, placeCoachmark caps it to the largest gap
  // (maxH) and it scrolls; overflow-auto keeps the Back/Next buttons reachable.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const p = placeCoachmark(rect, vw, vh, cardSize.w, cardSize.h);
    cardStyle = { top: p.top, left: p.left, maxHeight: p.maxH ?? 'calc(100dvh - 1.5rem)' };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxHeight: 'calc(100dvh - 1.5rem)' };
  }
  cardStyle = {
    ...cardStyle,
    width: CARD_W,
    maxWidth: 'calc(100vw - 1.5rem)',
  };

  // Locked coach overlay: the tour is modal, so only its own controls (the
  // corner ×, Back, Next, or Esc) advance or exit it. Incidental clicks and
  // keys can't break the step. Portaled to <body> and layered above Radix
  // dialogs (z-50) so a guided step can spotlight a control inside a modal.
  return createPortal(
    <div role="region" aria-label="Product tour">
      {/* Click blocker: catches every pointer event on the page beneath the
          tour. No onClick, so tapping the dim does nothing (never dismisses
          the tour); stopPropagation keeps a spotlighted dialog from treating
          the tap as an outside-click and closing itself. */}
      <div
        className="fixed inset-0 z-[110] pointer-events-auto"
        onPointerDown={(e) => e.stopPropagation()}
      />

      {/* The dim + spotlight (visual only). With a target, a transparent box
          punches a hole via its huge spread shadow; without one, a plain
          full-screen dim. */}
      {rect ? (
        <div
          className="fixed z-[111] pointer-events-none rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[111] pointer-events-none bg-black/50" />
      )}

      {/* Coachmark — the only interactive surface. Stop pointer events from
          reaching the document so an open Radix dialog beneath doesn't treat a
          tap on the card as an outside-click and dismiss itself. */}
      <div
        ref={cardRef}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed z-[112] pointer-events-auto flex flex-col rounded-xl border bg-popover text-popover-foreground p-4 shadow-elevated outline-none overflow-hidden"
        style={cardStyle}
      >
        {/* Exit, tucked into the corner so it stays out of the controls. */}
        <button
          type="button"
          onClick={end}
          aria-label="Exit tour"
          className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="shrink-0 text-sm font-semibold mb-1 pr-6">{step.title}</h3>
        {/* Only the body scrolls when the card is capped to a tight gap on a
            short screen; the title above and the controls below stay pinned, so
            Back/Next are always inside the box. */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        </div>
        <div className="shrink-0 flex items-center justify-between gap-3 pt-3">
          {/* Progress: the current step is a pill, the rest small dots. */}
          {isSingle ? (
            <span />
          ) : (
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={
                    i === stepIndex
                      ? 'h-1.5 w-4 rounded-full bg-primary transition-all'
                      : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/30 transition-all'
                  }
                />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={prev}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isSingle ? 'Got it' : isLast ? 'Done' : 'Next'}
              {!isSingle && !isLast && <ArrowRight className="h-3.5 w-3.5 ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
