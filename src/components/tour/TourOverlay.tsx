import { useEffect, useRef, useState } from 'react';
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
const CARD_H_EST = 188; // generous estimate for placement math only
const GAP = 12; // space between target and card
const PAD = 6; // spotlight padding around the target

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
  const cardRef = useRef<HTMLDivElement>(null);

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
      if (scrolled !== el) {
        scrolled = el;
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      } else if (r.top < 8 || r.bottom > window.innerHeight - 8) {
        // The target drifted out of view — e.g. a section finished expanding
        // and pushed it down. Re-center instantly so the spotlight follows.
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
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

  if (!active || !step) return null;

  // Position the coachmark: below the target if it fits, otherwise above;
  // clamped to the viewport. Centered when there is no target.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + PAD + GAP;
    const fitsBelow = below + CARD_H_EST < window.innerHeight;
    const top = fitsBelow ? below : Math.max(GAP, rect.top - PAD - GAP - CARD_H_EST);
    const left = Math.min(
      Math.max(GAP, rect.left + rect.width / 2 - CARD_W / 2),
      window.innerWidth - CARD_W - GAP
    );
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W };
  }

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
        className="fixed z-[112] pointer-events-auto rounded-xl border bg-popover text-popover-foreground p-4 shadow-elevated outline-none"
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
        <h3 className="text-sm font-semibold mb-1 pr-6">{step.title}</h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">{step.body}</p>
        <div className="flex items-center justify-between gap-3">
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
