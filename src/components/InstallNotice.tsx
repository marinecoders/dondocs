import { useSyncExternalStore } from 'react';
import { MonitorDown, X } from 'lucide-react';
import { useInstallStore } from '@/stores/installStore';
import { promptInstall, isInstallRelevant } from '@/hooks/useInstallPrompt';

// The clock never pushes updates; snooze changes arrive via the zustand
// re-render, which re-creates the snapshot closure below.
const subscribeNever = () => () => {};

/**
 * Slim, dismissible install strip (the StorageNotice pattern). This is the
 * affordance that carries MOBILE — the Help dropdown holding the "Install app"
 * item is desktop-only — so it renders only where installing is actually
 * possible (a captured Chromium prompt, or iOS's manual path), never as a dead
 * suggestion. Dismissing snoozes it for ~14 days (persisted); installing
 * retires it for good.
 */
export function InstallNotice() {
  const canInstall = useInstallStore((s) => s.canInstall);
  const isInstalled = useInstallStore((s) => s.isInstalled);
  const dismissedUntil = useInstallStore((s) => s.dismissedUntil);
  const snooze = useInstallStore((s) => s.snoozeBanner);
  // Render must stay pure, so the Date.now comparison goes through
  // useSyncExternalStore (the sanctioned escape hatch for reading a mutable
  // external value — here, the clock — during render).
  const snoozed = useSyncExternalStore(
    subscribeNever,
    () => dismissedUntil != null && Date.now() < dismissedUntil
  );

  if (snoozed || !isInstallRelevant(canInstall, isInstalled)) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-1 text-xs text-foreground"
    >
      <MonitorDown className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">
        Install DonDocs for offline, one-tap access.{' '}
        <span className="text-muted-foreground">No app store — it installs from this page.</span>
      </p>
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="shrink-0 rounded border border-border px-2 py-0.5 font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Install
      </button>
      <button
        type="button"
        onClick={() => snooze()}
        aria-label="Dismiss install suggestion"
        className="shrink-0 rounded p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
