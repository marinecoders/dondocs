import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Loader2, Radio } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import {
  isProbeableUrl,
  runProbe,
  VERDICT_COPY,
  type ProbeResult,
} from '@/lib/connectivityProbe';

/**
 * Whether this browser can reach an endpoint, answered in the page.
 *
 * The point is that it reports where a devtools console is not available, and
 * that it separates "the endpoint refused to share its response" from "nothing
 * answered" — one error covers both, and they are fixed in different places.
 *
 * The address is typed in rather than built in: this checks whatever needs
 * checking, and the app keeps no list of anywhere it might reach.
 */
export function ConnectivityModal() {
  const open = useUIStore((s) => s.connectivityModalOpen);
  const setOpen = useUIStore((s) => s.setConnectivityModalOpen);

  const [url, setUrl] = useState('');
  // Local state on purpose. A token typed here never reaches the store, never
  // reaches storage, and goes when the dialog closes.
  const [token, setToken] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  const runnable = isProbeableUrl(url) && !running;

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await runProbe(url.trim(), token.trim() || undefined));
    } finally {
      setRunning(false);
    }
  };

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setToken('');
      setResult(null);
    }
  };

  const copy = result ? VERDICT_COPY[result.verdict] : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" aria-hidden="true" />
            Endpoint check
          </DialogTitle>
          <DialogDescription>
            Sends one request from this browser and reports what came back. Nothing is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="probe-url">Address</Label>
            <Input
              id="probe-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && runnable) void run();
              }}
              placeholder="https://…"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="probe-token">
              Bearer token <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="probe-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Sent once, never stored"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-2xs text-muted-foreground">
              Including one makes this behave like a real call, which is the case worth testing.
            </p>
          </div>

          <Button onClick={() => void run()} disabled={!runnable} className="w-full">
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Checking…
              </>
            ) : (
              'Run check'
            )}
          </Button>

          {result && copy && (
            <Notice variant={result.verdict === 'ok' ? 'success' : 'warning'}>
              <p
                className={cn(
                  'text-sm font-semibold',
                  result.verdict === 'ok' ? 'text-success' : 'text-warning'
                )}
              >
                {copy.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs">
                <dt className="text-muted-foreground">Time</dt>
                <dd className="tnum">{result.elapsedMs} ms</dd>
                {result.status !== undefined && (
                  <>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="tnum">{result.status}</dd>
                  </>
                )}
                {result.responseType && (
                  <>
                    <dt className="text-muted-foreground">Response</dt>
                    <dd>{result.responseType}</dd>
                  </>
                )}
                {result.error && (
                  <>
                    <dt className="text-muted-foreground">Reported</dt>
                    <dd className="break-words">{result.error}</dd>
                  </>
                )}
              </dl>
              {result.headers && Object.keys(result.headers).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-2xs text-muted-foreground">
                    Headers the endpoint chose to expose
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-2xs">
                    {Object.entries(result.headers)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n')}
                  </pre>
                </details>
              )}
            </Notice>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
