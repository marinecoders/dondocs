import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const attach = (el: HTMLElement) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      const update = () => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          setRect(null); // hidden (e.g. collapsed at this breakpoint)
        } else {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      };
      update();
      // Recompute after the smooth scroll settles.
      const settle = window.setTimeout(update, reduce ? 0 : 280);
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      cleanups.push(() => {
        window.clearTimeout(settle);
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
      });
    };

    // Locate the target, retrying briefly so an element mounted by action()
    // (a modal opening, a section expanding) is caught instead of falling
    // straight through to the centered fallback.
    const locate = (attemptsLeft: number) => {
      if (cancelled) return;
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      if (el) {
        attach(el);
        return;
      }
      if (step.target && attemptsLeft > 0) {
        const t = window.setTimeout(() => locate(attemptsLeft - 1), 60);
        cleanups.push(() => window.clearTimeout(t));
        return;
      }
      setRect(null); // no target (or it never appeared) → centered card
    };
    locate(10); // ~600ms budget for an async-mounted modal to appear

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
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
      if (e.key === 'Escape') end();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepIndex, next, prev, end]);

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

  // Portaled to <body> and layered above Radix dialogs (z-50) and the
  // browser-compat notice (z-100), so a guided step can spotlight a control
  // inside an open modal — the dim covers the modal and the cutout reveals it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Click-catcher: blocks interaction with the page beneath the tour.
          Explicit pointer-events so it works even if <body> is locked. */}
      <div className="fixed inset-0 z-[110] pointer-events-auto" />

      {/* The dim + spotlight. With a target, a transparent box punches a hole
          via its huge spread shadow; without one, a plain full-screen dim. */}
      {rect ? (
        <div
          className="fixed z-[111] pointer-events-none rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[111] pointer-events-none bg-black/60" />
      )}

      {/* Coachmark */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className="fixed z-[112] pointer-events-auto rounded-xl border bg-popover text-popover-foreground p-4 shadow-elevated outline-none"
        style={cardStyle}
      >
        {!isSingle && (
          <div className="text-xs text-muted-foreground mb-1">
            {stepIndex + 1} of {steps.length}
          </div>
        )}
        <h3 className="text-sm font-semibold mb-1">{step.title}</h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">{step.body}</p>
        <div className="flex items-center justify-between">
          {isSingle ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={end}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip tour
            </button>
          )}
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="outline" size="sm" onClick={prev}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isSingle ? 'Got it' : isLast ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
