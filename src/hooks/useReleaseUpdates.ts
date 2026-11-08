import { useCallback, useEffect, useRef, useState } from 'react';
import { releaseManifest, type ReleaseManifest } from '@/lib/releases';
import { activeReleaseWorker, requestReleaseWorker } from '@/lib/releaseClient';
import { prepareUpdateCheckpoint, verifyUpdateCheckpoint } from '@/lib/updateCheckpoint';
import { readUpdateRestore, clearUpdateRestore, FAILED_RELEASE_KEY } from '@/lib/updateRestore';
import { showAppAlert } from '@/stores/alertStore';

export function useReleaseUpdates() {
  const [available, setAvailable] = useState<ReleaseManifest | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const offered = useRef<ReleaseManifest | null>(null);
  const worker = useRef<ServiceWorker | null>(null);
  const updating = useRef(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let disposed = false, checking = false, requested = false;
    let registration: ServiceWorkerRegistration | undefined;
    const identify = (event: MessageEvent) => {
      if (event.data?.type === 'DD_CLIENT_PROTOCOL') event.ports[0]?.postMessage({ protocol: 1, releases: [...new Set([__RELEASE_ID__, offered.current?.id, readUpdateRestore()?.previous].filter(Boolean))] });
    };
    navigator.serviceWorker.addEventListener('message', identify);
    const check = async () => {
      if (disposed || document.visibilityState === 'hidden' || !registration) return;
      if (checking) { requested = true; return; }
      checking = true;
      try {
        await registration.update();
        const active = await activeReleaseWorker(registration);
        worker.current = active;
        await requestReleaseWorker(active, { type: 'PREPARE_RELEASE', id: __RELEASE_ID__ });
        if (!disposed) setOfflineReady(true);
        const reply = await requestReleaseWorker<{ manifest: unknown }>(active, { type: 'CHECK_RELEASE' });
        const manifest = releaseManifest.parse(reply.manifest);
        if (!disposed) setAvailable(manifest.id === __RELEASE_ID__ || manifest.id === sessionStorage.getItem(FAILED_RELEASE_KEY) ? null : manifest);
        active.postMessage({ type: 'COLLECT_RELEASES' });
      } catch { /* Background failures leave the current release and editing alone. */ }
      finally { checking = false; if (requested && !disposed) { requested = false; void check(); } }
    };
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async value => {
      registration = value;
      if (registration.installing) registration.installing.addEventListener('statechange', () => { void check(); });
      await check();
    }).catch(() => {});
    const interval = setInterval(() => { void check(); }, 60000);
    const resume = () => { void check(); };
    window.addEventListener('online', resume); window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true; clearInterval(interval);
      navigator.serviceWorker.removeEventListener('message', identify);
      window.removeEventListener('online', resume); window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  const promptUpdate = useCallback(() => {
    if (available && !updating.current) { offered.current = available; setShowUpdatePrompt(true); }
  }, [available]);
  const dismissUpdatePrompt = useCallback(() => { offered.current = null; setShowUpdatePrompt(false); }, []);
  const confirmUpdate = useCallback(() => {
    const target = offered.current, active = worker.current;
    if (!target || !active || updating.current) return;
    updating.current = true; setIsUpdating(true); setShowUpdatePrompt(false);
    void (async () => {
      const point = await prepareUpdateCheckpoint(target.id, __RELEASE_ID__);
      await requestReleaseWorker(active, { type: 'PREPARE_RELEASE', id: target.id });
      const result = await requestReleaseWorker<{ ready: boolean }>(active, { type: 'IS_RELEASE_READY', id: target.id });
      if (!result.ready) throw new Error('The update is no longer ready. Reconnect and retry.');
      await verifyUpdateCheckpoint(point);
      window.location.assign(target.entry + window.location.search + window.location.hash);
    })().catch(error => {
      updating.current = false; setIsUpdating(false);
      try { clearUpdateRestore(); } catch { /* A failed checkpoint never causes navigation. */ }
      showAppAlert({ title: 'Update paused', message: error instanceof Error ? error.message : String(error) });
    });
  }, []);
  return { updateAvailable: available !== null, promptUpdate, showUpdatePrompt, confirmUpdate, dismissUpdatePrompt, offlineReady, updating: isUpdating };
}
