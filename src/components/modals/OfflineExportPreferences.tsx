import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { prepareWordOffline, readOfflineOutputStatus, wordOfflineBytes, type OfflineOutputStatus } from '@/lib/offlineOutputs';

const unknownGuidance = {
  uncontrolled: 'Reopen DonDocs while connected to check offline readiness.',
  'updating-worker': 'Close other DonDocs tabs, then reopen while connected to finish the update and check offline readiness.',
  'setting-up': 'Keep DonDocs open while connected until offline setup finishes.',
  'storage-unavailable': 'Offline storage could not be checked. Reopen DonDocs while connected and try again.',
} satisfies Record<Extract<OfflineOutputStatus, { kind: 'unknown' }>['reason'], string>;

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

export function OfflineExportPreferences() {
  const [status, setStatus] = useState<OfflineOutputStatus>();
  const [online, setOnline] = useState(navigator.onLine);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState('');
  const preparing = useRef(false);
  const readGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    let checking = false;
    function refresh() {
      setOnline(navigator.onLine);
      if (checking || preparing.current) return;
      checking = true;
      const generation = readGeneration.current;
      void readOfflineOutputStatus().then(value => {
        if (active && generation === readGeneration.current) setStatus(value);
      }).finally(() => { checking = false; });
    }
    refresh();
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
    };
  }, []);

  async function prepare() {
    setError('');
    if (status?.kind !== 'verified' || preparing.current) return;
    preparing.current = true;
    readGeneration.current++;
    setProgress(status.wordBytes);
    try {
      setStatus(await prepareWordOffline(setProgress));
    } catch (cause) {
      setStatus(await readOfflineOutputStatus());
      setError(cause instanceof Error ? cause.message : 'Word preparation failed. Try again.');
    } finally {
      preparing.current = false;
      setProgress(undefined);
    }
  }

  const busy = progress !== undefined;
  const verified = status?.kind === 'verified' ? status : undefined;
  const wordReady = !!wordOfflineBytes && verified?.wordBytes === wordOfflineBytes;
  const pendingLabel = status?.kind === 'unknown' ? 'Readiness unknown' : 'Checking…';
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-medium">PDF engine</dt>
        <dd role="status">{verified ? verified.pdf ? 'Ready offline' : 'Not ready offline' : pendingLabel}</dd>
        <dt className="font-medium">Word resources</dt>
        <dd role="status">{verified ? wordReady ? 'Ready offline' : 'Not ready offline' : pendingLabel}</dd>
      </dl>
      {status?.kind === 'unknown' && <p className="text-muted-foreground">{unknownGuidance[status.reason]}</p>}
      {verified && !verified.pdf && <p className="text-muted-foreground">Reopen DonDocs while connected and let the PDF preview finish before going offline.</p>}
      <p className="text-xs text-muted-foreground">Save any library forms you need for offline use separately.</p>
      {verified && !wordReady && !!wordOfflineBytes && <div className="space-y-2">
        <Button variant="outline" disabled={busy || !online} onClick={() => void prepare()}>
          {busy ? 'Preparing Word…' : 'Prepare Word offline'}
        </Button>
        {busy
          ? <div className="space-y-1">
              <progress aria-label="Word resources downloaded" className="w-full" max={wordOfflineBytes} value={progress} />
              <p className="text-xs tabular-nums text-muted-foreground">{formatMegabytes(progress)} of {formatMegabytes(wordOfflineBytes)} ready</p>
            </div>
          : <p className="text-xs text-muted-foreground">
              {online ? `${formatMegabytes(wordOfflineBytes - verified.wordBytes)} to download for Word exports.` : 'Reconnect to download the missing Word resources.'}
            </p>}
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  );
}
