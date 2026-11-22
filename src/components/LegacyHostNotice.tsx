import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';

export function LegacyHostNotice() {
  if (window.location.hostname !== 'dondocs.usmc.dev') return null;

  const destination = new URL('https://dondocs.marines.dev/');
  destination.search = window.location.search;
  destination.hash = window.location.hash;

  return (
    <aside aria-label="DonDocs address change"
      className="shrink-0 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>Moving to the primary DonDocs address? Back up this workspace here, then restore it there.</p>
        <Button size="sm" variant="outline" onClick={() => useUIStore.getState().setSettingsOpen(true, 'backup')}>
          Back up workspace
        </Button>
        <a href={destination.href} target="_blank" rel="noopener noreferrer" className="rounded-sm underline underline-offset-4">
          Open dondocs.marines.dev
        </a>
      </div>
    </aside>
  );
}
