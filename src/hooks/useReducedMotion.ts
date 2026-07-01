import { useSyncExternalStore } from 'react';

/**
 * Reactively tracks the OS prefers-reduced-motion preference. Used to gate the
 * animated background beams, whose SVG SMIL isn't governed by CSS reduced-motion.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  // getServerSnapshot returns false: motion is allowed until proven otherwise.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
