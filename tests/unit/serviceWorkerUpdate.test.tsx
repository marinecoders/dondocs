import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushDocumentWrites } from '@/stores/documentsStore';
import { showAppAlert } from '@/stores/alertStore';
import { useServiceWorker } from '@/hooks/useServiceWorker';

vi.mock('@/stores/documentsStore', () => ({ flushDocumentWrites: vi.fn(async () => {}) }));
vi.mock('@/stores/alertStore', () => ({ showAppAlert: vi.fn() }));
const registration = vi.hoisted(() => ({
  needRefresh: false,
  update: vi.fn(async (_reload?: boolean) => {}),
  options: {} as { onNeedReload?: () => void; onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration) => void },
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: typeof registration.options) => {
    registration.options = options;
    return { needRefresh: [registration.needRefresh], offlineReady: [false], updateServiceWorker: registration.update };
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function worker(state: ServiceWorkerState = 'installed') {
  return Object.assign(new EventTarget(), { state });
}
function environment(slots: Partial<Record<'waiting' | 'installing' | 'active', ReturnType<typeof worker> | null>> = {}) {
  const record = { waiting: null, installing: null, active: null, ...slots, update: vi.fn(async () => {}) };
  const container = Object.assign(new EventTarget(), {
    getRegistration: vi.fn(async () => record as unknown as ServiceWorkerRegistration),
  });
  vi.stubGlobal('navigator', { serviceWorker: container });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const registered = () => act(() => registration.options.onRegisteredSW?.('/sw.js', record as unknown as ServiceWorkerRegistration));
  return { record, container, reload, registered };
}

beforeEach(() => {
  registration.needRefresh = false;
  registration.update.mockReset().mockResolvedValue();
  vi.mocked(flushDocumentWrites).mockReset().mockResolvedValue();
  vi.mocked(showAppAlert).mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps an already activated update offer passive until confirmation', async () => {
  const active = worker('activated');
  const env = environment({ active });
  const { result, rerender } = renderHook(() => useServiceWorker());
  env.registered();
  registration.needRefresh = true;
  await act(async () => { rerender(); });
  await act(async () => {
    active.dispatchEvent(new Event('statechange'));
    env.container.dispatchEvent(new Event('controllerchange'));
    registration.options.onNeedReload?.();
  });
  expect(result.current).toMatchObject({ updateAvailable: true, showUpdatePrompt: false, updating: false });
  expect(flushDocumentWrites).not.toHaveBeenCalled();
  expect(registration.update).not.toHaveBeenCalled();
  expect(env.reload).not.toHaveBeenCalled();
});

it('ignores an unsolicited plugin reload callback with no confirmed update', async () => {
  const env = environment();
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => registration.options.onNeedReload?.());
  expect(result.current.updating).toBe(false);
  expect(flushDocumentWrites).not.toHaveBeenCalled();
  expect(env.reload).not.toHaveBeenCalled();
});

it('does not let notifications bypass the pending initial save', async () => {
  const saved = deferred<void>(), waiting = worker();
  vi.mocked(flushDocumentWrites).mockReturnValueOnce(saved.promise);
  const env = environment({ waiting });
  const { result } = renderHook(() => useServiceWorker());
  env.registered();
  act(() => result.current.confirmUpdate());
  expect(result.current.updating).toBe(true);
  await act(async () => {
    waiting.state = 'activated';
    waiting.dispatchEvent(new Event('statechange'));
    env.container.dispatchEvent(new Event('controllerchange'));
    registration.options.onNeedReload?.();
  });
  expect(flushDocumentWrites).toHaveBeenCalledOnce();
  expect(env.container.getRegistration).not.toHaveBeenCalled();
  expect(registration.update).not.toHaveBeenCalled();
  expect(env.reload).not.toHaveBeenCalled();
  await act(async () => saved.resolve());
  expect(registration.update).toHaveBeenCalledExactlyOnceWith(true);
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
  expect(env.reload).toHaveBeenCalledOnce();
});

it('reloads a confirmed uncontrolled first-install tab when its offered worker activates without claiming clients', async () => {
  const waiting = worker(), env = environment({ waiting });
  const { result, rerender } = renderHook(() => useServiceWorker());
  env.registered();registration.needRefresh = true;rerender();
  await act(async () => result.current.confirmUpdate());
  expect(env.reload).not.toHaveBeenCalled();
  waiting.state = 'activating';
  await act(async () => waiting.dispatchEvent(new Event('statechange')));
  expect(env.reload).not.toHaveBeenCalled();
  waiting.state = 'activated';
  await act(async () => waiting.dispatchEvent(new Event('statechange')));
  expect(env.reload).toHaveBeenCalledOnce();
  await act(async () => {
    env.container.dispatchEvent(new Event('controllerchange'));
    registration.options.onNeedReload?.();
  });
  expect(env.reload).toHaveBeenCalledOnce();
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
});

it('resolves the live registration when the waiting slot was empty at the offer', async () => {
  const installing = worker(), waiting = worker();
  const env = environment({ installing });
  const { result, rerender } = renderHook(() => useServiceWorker());
  env.registered();registration.needRefresh = true;rerender();
  env.record.installing = null;env.record.waiting = waiting;
  await act(async () => result.current.confirmUpdate());
  expect(env.container.getRegistration).toHaveBeenCalledOnce();
  installing.state = 'activated';
  await act(async () => installing.dispatchEvent(new Event('statechange')));
  expect(env.reload).not.toHaveBeenCalled();
  waiting.state = 'activated';
  await act(async () => waiting.dispatchEvent(new Event('statechange')));
  expect(env.reload).toHaveBeenCalledOnce();
});

it('observes the installing slot when a confirmed offer has not entered waiting', async () => {
  const installing = worker(), env = environment({ installing });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  installing.state = 'activated';
  await act(async () => installing.dispatchEvent(new Event('statechange')));
  expect(env.reload).toHaveBeenCalledOnce();
});

it('reloads once when the offered worker activated before confirmation', async () => {
  const env = environment({ active: worker('activated') });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(registration.update).toHaveBeenCalledExactlyOnceWith(true);
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
  expect(env.reload).toHaveBeenCalledOnce();
});

it('waits for the final save and deduplicates notifications while it is pending', async () => {
  const saved = deferred<void>();
  vi.mocked(flushDocumentWrites).mockResolvedValueOnce().mockReturnValueOnce(saved.promise);
  const env = environment({ active: worker('activated') });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  await act(async () => { registration.options.onNeedReload?.();registration.options.onNeedReload?.(); });
  expect(result.current.updating).toBe(true);
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
  expect(env.reload).not.toHaveBeenCalled();
  await act(async () => saved.resolve());
  expect(env.reload).toHaveBeenCalledOnce();
});

it('leaves a failed initial save passive until an explicit retry', async () => {
  vi.mocked(flushDocumentWrites).mockRejectedValueOnce(new Error('Storage unavailable'));
  const env = environment({ active: worker('activated') });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(result.current.updating).toBe(false);
  expect(showAppAlert).toHaveBeenCalledExactlyOnceWith({ title: 'Update paused', message: 'Error: Storage unavailable' });
  await act(async () => registration.options.onNeedReload?.());
  expect(flushDocumentWrites).toHaveBeenCalledOnce();
  expect(registration.update).not.toHaveBeenCalled();
  expect(env.reload).not.toHaveBeenCalled();
  await act(async () => result.current.confirmUpdate());
  expect(env.reload).toHaveBeenCalledOnce();
});

it('requires a new confirmation after the final save fails', async () => {
  vi.mocked(flushDocumentWrites).mockResolvedValueOnce().mockRejectedValueOnce(new Error('Late save failed'));
  const env = environment({ active: worker('activated') });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(result.current.updating).toBe(false);
  expect(showAppAlert).toHaveBeenCalledExactlyOnceWith({ title: 'Update paused', message: 'Late save failed' });
  await act(async () => registration.options.onNeedReload?.());
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
  expect(env.reload).not.toHaveBeenCalled();
  await act(async () => result.current.confirmUpdate());
  expect(registration.update).toHaveBeenCalledTimes(2);
  expect(env.reload).toHaveBeenCalledOnce();
});

it('does not reload from notifications emitted by a failed activation request', async () => {
  registration.update.mockImplementationOnce(async () => {
    registration.options.onNeedReload?.();
    throw new Error('Activation failed');
  });
  const env = environment({ active: worker('activated') });
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(result.current.updating).toBe(false);
  expect(flushDocumentWrites).toHaveBeenCalledOnce();
  expect(env.reload).not.toHaveBeenCalled();
  await act(async () => result.current.confirmUpdate());
  expect(env.reload).toHaveBeenCalledOnce();
});

it('retains a notification emitted during a successful activation request', async () => {
  registration.update.mockImplementationOnce(async () => { registration.options.onNeedReload?.(); });
  const env = environment();
  const { result } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(flushDocumentWrites).toHaveBeenCalledTimes(2);
  expect(env.reload).toHaveBeenCalledOnce();
});

it('ignores duplicate confirmations while saving and waiting for activation', async () => {
  const saved = deferred<void>(), waiting = worker();
  vi.mocked(flushDocumentWrites).mockReturnValueOnce(saved.promise);
  const env = environment({ waiting });
  const { result } = renderHook(() => useServiceWorker());
  act(() => { result.current.confirmUpdate();result.current.confirmUpdate(); });
  expect(flushDocumentWrites).toHaveBeenCalledOnce();
  await act(async () => saved.resolve());
  await act(async () => result.current.confirmUpdate());
  expect(registration.update).toHaveBeenCalledOnce();
  waiting.state = 'activated';
  await act(async () => waiting.dispatchEvent(new Event('statechange')));
  expect(env.reload).toHaveBeenCalledOnce();
});

it.each(['initial save', 'registration lookup', 'activation request', 'final save'] as const)('ignores completion after unmount during %s', async phase => {
  const pending = deferred<void>(), lookup = deferred<ServiceWorkerRegistration>();
  const env = environment({ active: worker('activated') });
  if (phase === 'initial save') vi.mocked(flushDocumentWrites).mockReturnValueOnce(pending.promise);
  if (phase === 'registration lookup') env.container.getRegistration.mockReturnValueOnce(lookup.promise);
  if (phase === 'activation request') registration.update.mockReturnValueOnce(pending.promise);
  if (phase === 'final save') vi.mocked(flushDocumentWrites).mockResolvedValueOnce().mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  unmount();
  await act(async () => { pending.resolve();lookup.resolve(env.record as unknown as ServiceWorkerRegistration); });
  expect(env.reload).not.toHaveBeenCalled();
  expect(showAppAlert).not.toHaveBeenCalled();
  if (phase === 'initial save' || phase === 'registration lookup') expect(registration.update).not.toHaveBeenCalled();
});

it('cleans up confirmed activation listeners and ignores late plugin registration after unmount', async () => {
  vi.useFakeTimers();
  const waiting = worker(), env = environment({ waiting });
  const remove = vi.spyOn(waiting, 'removeEventListener');
  const { result, unmount } = renderHook(() => useServiceWorker());
  env.registered();
  await act(async () => result.current.confirmUpdate());
  unmount();
  expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function));
  await act(async () => {
    waiting.state = 'activated';waiting.dispatchEvent(new Event('statechange'));
    env.container.dispatchEvent(new Event('controllerchange'));
    registration.options.onNeedReload?.();
    registration.options.onRegisteredSW?.('/late-sw.js', env.record as unknown as ServiceWorkerRegistration);
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(env.record.update).not.toHaveBeenCalled();
  expect(flushDocumentWrites).toHaveBeenCalledOnce();
  expect(env.reload).not.toHaveBeenCalled();
});
