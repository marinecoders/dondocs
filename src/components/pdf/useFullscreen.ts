import { useCallback, useEffect, useState } from 'react';

/**
 * Fullscreen for the viewer root. `available` is false where the Fullscreen
 * API is missing (iPhone Safari) so the toolbar can hide the control instead
 * of offering a dead button.
 */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const available = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    if (!available) return;
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [available, ref]);

  const toggle = useCallback(() => {
    if (!available || !ref.current) return;
    if (document.fullscreenElement === ref.current) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void ref.current.requestFullscreen().catch(() => {});
    }
  }, [available, ref]);

  return { available, isFullscreen, toggle };
}
