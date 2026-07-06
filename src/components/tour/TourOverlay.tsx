import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import { TourButton } from './TourButton';

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
 * above, right, then left of the padded spotlight rect (each candidate sits fully
 * outside it) and picks the first that fits. The card is capped to the viewport
 * first. The fallback runs only when the highlight is itself larger than the
 * screen minus the card, pinning the card to the roomiest edge.
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

  // Try each side at full card size; each candidate is fully outside the spotlight.
  if (sBottom + GAP + ch <= vh - GAP) return { top: sBottom + GAP, left: cx }; // below
  if (sTop - GAP - ch >= GAP) return { top: sTop - GAP - ch, left: cx }; // above
  if (sRight + GAP + cw <= vw - GAP) return { top: cy, left: sRight + GAP }; // right
  if (sLeft - GAP - cw >= GAP) return { top: cy, left: sLeft - GAP - cw }; // left

  // Taller than any side's gap: drop it into the larger vertical band and cap its
  // height there (it scrolls). Width is never capped, keeping placement stable.
  const gapBelow = vh - sBottom - 2 * GAP;
  const gapAbove = sTop - 2 * GAP;
  if (Math.max(gapBelow, gapAbove) >= 100) {
    return gapBelow >= gapAbove
      ? { top: sBottom + GAP, left: cx, maxH: gapBelow }
      : { top: GAP, left: cx, maxH: gapAbove };
  }
  // The highlight nearly fills the viewport; overlap is unavoidable, so pin the
  // card to the bottom.
  return { top: clamp(vh - ch - GAP, GAP, vh - GAP), left: cx };
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Guided-tour overlay. Dims the page, spotlights the current step's target via a
 * box-shadow cutout, and anchors a coachmark beside it. Driven by useTourStore;
 * renders nothing when inactive. The highlight is shown but not interactive;
 * navigation is via the card and Esc. A missing target centers the card and skips
 * the spotlight so the tour never breaks.
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
  // A one-off "Show me" spotlight is a single step: drop the counter and soften
  // the action label.
  const isSingle = steps.length === 1;

  // Locate + track the target rect for the current step.
  useEffect(() => {
    if (!active || !step) return;
    const reduce = prefersReducedMotion();

    // A step may need to open the surface its target lives in (e.g. the Batch
    // modal) before the element exists. Run that side-effect first.
    step.action?.();

    // Re-query the selector every tick rather than hold an element reference: the
    // surface underneath can open and close, so this catches a freshly-mounted
    // modal within a tick and re-centers when the target is gone.
    let scrolled: Element | null = null;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      // A target inside a closing/closed Radix dialog counts as gone, so the
      // spotlight doesn't strand on a just-closed control. Scoped to dialogs so a
      // collapsed accordion header (also data-state="closed", but visible) still
      // spotlights.
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
      // Park the target to reserve card room: center it when the viewport is tall
      // enough to also fit the card on one side, otherwise pull it to the top so a
      // full card height stays free below. Keeps the card off the spotlight on
      // short/landscape displays.
      const vh = window.innerHeight;
      const block: ScrollLogicalPosition =
        vh >= r.height + 2 * CARD_H_EST + 3 * GAP ? 'center' : 'start';
      if (scrolled !== el) {
        scrolled = el;
        el.scrollIntoView({ block, inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      } else if (r.top < -1 || r.bottom > vh + 1) {
        // The target was clipped (e.g. a section expanded and pushed it
        // off-screen). Re-anchor instantly, but only on real clipping so a
        // top-parked target isn't re-scrolled.
        el.scrollIntoView({ block, inline: 'nearest', behavior: 'auto' });
      }
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - r.top) < 0.5 &&
        Math.abs(prev.left - r.left) < 0.5 &&
        Math.abs(prev.width - r.width) < 0.5 &&
        Math.abs(prev.height - r.height) < 0.5
          ? prev // unchanged; skip the re-render
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
    // The welcome dialog can leave pointer-events:none stuck on <body>; clear it
    // after render so it wins over Radix's layout effects.
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only Escape; typing and arrows flow to the focused field, and navigation
      // is via the on-card Back/Next.
      if (e.key !== 'Escape') return;
      // Capture-phase + stop so a spotlighted Radix dialog doesn't also handle
      // Escape and close itself, stranding the walkthrough.
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, stepIndex, end]);

  // Measure the card's real size so placement reserves the right room (body length
  // varies per step). Re-runs on step/target change; the value guard makes
  // redundant runs a no-op.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    // The card's natural height, independent of any maxHeight cap, so measurement
    // can't feed back into the cap and oscillate. The body is the only flexible
    // part, so swap its visible height for its content height.
    const body = bodyRef.current;
    const h = body
      ? el.offsetHeight - body.clientHeight + body.scrollHeight
      : el.scrollHeight;
    setCardSize((p) => (p.w === w && p.h === h ? p : { w, h }));
  }, [active, stepIndex, rect]);

  if (!active || !step) return null;

  // Position the coachmark beside the target so it never covers the spotlight.
  // When no side fits, placeCoachmark caps it to the largest gap (maxH) and it
  // scrolls; overflow-auto keeps Back/Next reachable.
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

  // The tour is modal: only its own controls (corner ×, Back, Next, Esc) advance
  // or exit it. Portaled to <body> and layered above Radix dialogs (z-50) so a
  // step can spotlight a control inside a modal.
  return createPortal(
    <div role="region" aria-label="Product tour">
      {/* Click blocker over the page. No onClick, so tapping the dim does
          nothing; stopPropagation keeps a spotlighted dialog from treating the
          tap as an outside-click and closing. */}
      <div
        className="fixed inset-0 z-[110] pointer-events-auto"
        onPointerDown={(e) => e.stopPropagation()}
      />

      {/* Dim + spotlight (visual only). With a target, a transparent box punches
          a hole via its large spread shadow; without one, a plain full dim. */}
      {rect ? (
        <div
          className="fixed z-[111] pointer-events-none rounded-lg ring-2 ring-primary transition-[top,left,width,height] duration-200"
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

      {/* Coachmark: the only interactive surface. Stop pointer events from
          reaching the document so an open Radix dialog beneath doesn't dismiss
          on a tap. */}
      <div
        ref={cardRef}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed z-[112] pointer-events-auto flex flex-col rounded-xl border bg-popover text-popover-foreground p-4 shadow-elevated outline-none overflow-hidden"
        style={cardStyle}
      >
        {/* Exit, in the corner so it stays clear of the controls. */}
        <button
          type="button"
          onClick={end}
          aria-label="Exit tour"
          className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        {/* Announce each step to screen readers: the card element is reused
            across steps (never remounts), so this region's text updates in
            place and a polite live region reads the new step. The visual dots
            below are aria-hidden, so this is the only step-progress a SR gets. */}
        <p className="sr-only" role="status" aria-live="polite">
          {isSingle
            ? step.title
            : `Step ${stepIndex + 1} of ${steps.length}: ${step.title}`}
        </p>
        <h3 className="shrink-0 text-sm font-semibold mb-1 pr-6">{step.title}</h3>
        {/* Only the body scrolls when the card is capped to a tight gap; the
            title and controls stay pinned so Back/Next are always in the box. */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        </div>
        <div className="shrink-0 flex items-center justify-between gap-3 pt-3">
          {/* Progress: current step is a pill, the rest dots. The dots column
              yields space first (min-w-0 + overflow-hidden) so a long step list
              can't push the shrink-0 Back/Next group past the clipped edge. */}
          {isSingle ? (
            <span />
          ) : (
            <div className="flex min-w-0 items-center gap-2 overflow-hidden" aria-hidden="true">
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {stepIndex + 1}/{steps.length}
              </span>
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={
                      i === stepIndex
                        ? 'h-1.5 w-4 shrink-0 rounded-full bg-primary transition-[width]'
                        : 'h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30 transition-[width]'
                    }
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex shrink-0 gap-2">
            {stepIndex > 0 && (
              <TourButton variant="ghost" onClick={prev}>
                Back
              </TourButton>
            )}
            <TourButton arrow={!isSingle && !isLast ? 'next' : undefined} onClick={next}>
              {isSingle ? 'Got it' : isLast ? 'Done' : 'Next'}
            </TourButton>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
