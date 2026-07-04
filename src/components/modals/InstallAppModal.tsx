/**
 * Install instructions modal — the fallback whenever the native install prompt
 * isn't available (promptInstall() fires the native dialog directly when it
 * is). Content branches on the device, because every platform installs
 * differently and several (iOS!) never fire `beforeinstallprompt`:
 *
 *  - in-app browser (FB/IG/etc.) → escape to a real browser first
 *  - iOS Safari                  → Share → Add to Home Screen → Add
 *  - iOS Chrome/Firefox          → installs only from Safari; open there
 *  - Android Chromium            → browser menu → "Add to Home screen"
 *  - desktop Chromium            → install icon in the address bar / menu
 *  - macOS Safari                → File → Add to Dock
 *  - elsewhere (Firefox desktop) → honest "not supported here"
 *
 * All static in-app text + inline SVG — no network, air-gap safe.
 */
import { MonitorDown, Compass } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useInstallStore } from '@/stores/installStore';
import { useDeviceInfo } from '@/utils/device';

/** iOS Safari's share glyph (square with an up arrow), inline so the step
 *  reads visually without fetching anything. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-4 w-4 align-text-bottom text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((step, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
            {i + 1}
          </span>
          <span className="leading-snug">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallAppModal() {
  const open = useInstallStore((s) => s.installModalOpen);
  const setOpen = useInstallStore((s) => s.setInstallModalOpen);
  const d = useDeviceInfo();

  let body: React.ReactNode;
  if (d.isInAppBrowser) {
    body = (
      <Steps
        items={[
          <>Tap the <strong>⋮</strong> or share button in this app&apos;s browser.</>,
          <>Choose <strong>{d.isIOS ? 'Open in Safari' : 'Open in Chrome'}</strong>.</>,
          <>Then install from there — on {d.isIOS ? 'iOS: Share → Add to Home Screen' : 'Android: menu → Add to Home screen'}.</>,
        ]}
      />
    );
  } else if (d.isIOS && d.isRealSafari) {
    body = (
      <Steps
        items={[
          <>Tap the <strong>Share</strong> button <ShareGlyph /> in Safari&apos;s toolbar.</>,
          <>Scroll down and tap <strong>Add to Home Screen</strong>.</>,
          <>Tap <strong>Add</strong>. DonDocs opens full-screen from its own icon, ready offline.</>,
        ]}
      />
    );
  } else if (d.isIOS) {
    body = (
      <div className="space-y-3">
        <p className="text-sm">
          On iPhone and iPad, apps install from <strong>Safari</strong> only.
        </p>
        <Steps
          items={[
            <>Open this page in <strong>Safari</strong>.</>,
            <>Tap the <strong>Share</strong> button <ShareGlyph />, then <strong>Add to Home Screen</strong>.</>,
            <>Tap <strong>Add</strong>.</>,
          ]}
        />
      </div>
    );
  } else if (d.isAndroid) {
    body = (
      <Steps
        items={[
          <>Open the browser&apos;s <strong>⋮</strong> menu.</>,
          <>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</>,
          <>Confirm. DonDocs opens full-screen from its own icon, ready offline.</>,
        ]}
      />
    );
  } else if (d.isChrome || d.isEdge) {
    body = (
      <Steps
        items={[
          <>Look for the <strong>install icon</strong> <MonitorDown className="inline h-4 w-4 align-text-bottom text-primary" aria-hidden /> at the right end of the address bar.</>,
          <>Or open the browser menu and choose <strong>Install DonDocs…</strong> (sometimes under &quot;Cast, save and share&quot;).</>,
          <>Confirm. DonDocs opens in its own window, ready offline.</>,
        ]}
      />
    );
  } else if (d.isSafari) {
    body = (
      <Steps
        items={[
          <>In Safari&apos;s menu bar, choose <strong>File → Add to Dock…</strong></>,
          <>Confirm. DonDocs opens from your Dock in its own window.</>,
        ]}
      />
    );
  } else {
    body = (
      <p className="text-sm text-muted-foreground">
        This browser doesn&apos;t support installing web apps. Open DonDocs in
        Chrome, Edge, or Safari to install it — or keep using it right here;
        everything works the same in a tab.
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary shrink-0" aria-hidden />
            Install DonDocs
          </DialogTitle>
          <DialogDescription>
            Installs straight from this page — no app store, no account, and
            nothing leaves your device. You get a real app icon and one-tap
            offline access.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
