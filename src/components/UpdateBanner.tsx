/**
 * Update Banner Component
 *
 * Shows a brief notification when the app has been updated to a new version.
 * Appears at the bottom of the screen and auto-dismisses after a few seconds.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface UpdateBannerProps {
  show: boolean;
  onDismiss: () => void;
}

export function UpdateBanner({ show, onDismiss }: UpdateBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (show) {
      // Small delay for enter animation
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsLeaving(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setIsLeaving(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!show && !isLeaving) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] transition-all duration-300 ease-out ${
        isVisible && !isLeaving
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-primary text-primary-foreground rounded-lg shadow-lg border border-primary/20">
        <RefreshCw className="h-4 w-4 animate-spin-slow" />
        <span className="text-sm font-medium">App updated to v1.2.0</span>
        <button
          onClick={onDismiss}
          className="ml-2 p-1 rounded-md hover:bg-primary-foreground/10 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
