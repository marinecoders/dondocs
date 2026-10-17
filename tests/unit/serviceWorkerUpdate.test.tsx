import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { flushDocumentWrites } from '@/stores/documentsStore';
import { useServiceWorker } from '@/hooks/useServiceWorker';

vi.mock('@/stores/documentsStore', () => ({ flushDocumentWrites: vi.fn(async () => {}) }));

const registration = vi.hoisted(() => ({ needRefresh: false, options: {} as { onNeedReload?: () => void; onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration) => void } }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: typeof registration.options) => {
    registration.options = options;
    return { needRefresh: [registration.needRefresh], offlineReady: [false], updateServiceWorker: vi.fn() };
  },
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); registration.needRefresh = false; });

it('reloads a previously uncontrolled tab when the offered update takes control', async () => {
  const worker = new EventTarget();
  vi.stubGlobal('navigator', { serviceWorker: worker });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { rerender } = renderHook(() => useServiceWorker());
  await act(async () => { worker.dispatchEvent(new Event('controllerchange')); });
  expect(reload).not.toHaveBeenCalled();
  registration.needRefresh = true;
  rerender();
  await act(async () => { worker.dispatchEvent(new Event('controllerchange')); });
  expect(reload).toHaveBeenCalledOnce();
  act(() => registration.options.onNeedReload?.());
  expect(reload).toHaveBeenCalledOnce();
});

it('removes the activation listener when the hook unmounts', () => {
  const worker = new EventTarget();
  vi.stubGlobal('navigator', { serviceWorker: worker });
  registration.needRefresh = true;
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { unmount } = renderHook(() => useServiceWorker());
  unmount();
  worker.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
});


it('reloads an uncontrolled first-install tab when the waiting worker activates without claiming clients', async () => {
  const worker = new EventTarget();
  const waiting = Object.assign(new EventTarget(), { state: 'installed' });
  vi.stubGlobal('navigator', { serviceWorker: worker });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { rerender, unmount } = renderHook(() => useServiceWorker());
  act(() => registration.options.onRegisteredSW?.('/sw.js', { waiting } as unknown as ServiceWorkerRegistration));
  registration.needRefresh = true;
  rerender();
  waiting.state = 'activating';
  await act(async () => { waiting.dispatchEvent(new Event('statechange')); });
  expect(reload).not.toHaveBeenCalled();
  waiting.state = 'activated';
  await act(async () => { waiting.dispatchEvent(new Event('statechange')); });
  expect(reload).toHaveBeenCalledOnce();
  await act(async () => { worker.dispatchEvent(new Event('controllerchange')); });
  expect(reload).toHaveBeenCalledOnce();
  unmount();
});

it('waits for pending saves before reloading after activation', async () => {
  let finish!: () => void;
  vi.mocked(flushDocumentWrites).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { unmount } = renderHook(() => useServiceWorker());
  act(() => registration.options.onNeedReload?.());
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(reload).toHaveBeenCalledOnce();
  unmount();
});

it('keeps the tab open when saving fails', async () => {
  vi.mocked(flushDocumentWrites).mockRejectedValueOnce(new Error('Storage unavailable'));
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { unmount } = renderHook(() => useServiceWorker());
  await act(async () => registration.options.onNeedReload?.());
  expect(reload).not.toHaveBeenCalled();
  unmount();
});
it('observes activation when the prompt arrives before the waiting slot is populated', async () => {
  const worker = new EventTarget();
  const installing = Object.assign(new EventTarget(), { state: 'installed' });
  vi.stubGlobal('navigator', { serviceWorker: worker });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { rerender, unmount } = renderHook(() => useServiceWorker());
  act(() => registration.options.onRegisteredSW?.('/sw.js', { waiting: null, installing } as unknown as ServiceWorkerRegistration));
  registration.needRefresh = true;
  rerender();
  installing.state = 'activated';
  await act(async () => { installing.dispatchEvent(new Event('statechange')); });
  expect(reload).toHaveBeenCalledOnce();
  unmount();
});
it('resolves the current waiting worker before confirming an update', async () => {
  const waiting = Object.assign(new EventTarget(), { state: 'installed' });
  const worker = Object.assign(new EventTarget(), { getRegistration: vi.fn(async () => ({ waiting })) });
  vi.stubGlobal('navigator', { serviceWorker: worker });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { result, unmount } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(worker.getRegistration).toHaveBeenCalledOnce();
  waiting.state = 'activated';
  await act(async () => waiting.dispatchEvent(new Event('statechange')));
  expect(reload).toHaveBeenCalledOnce();
  unmount();
});
it('reloads when the offered update activated before confirmation', async () => {
  const active = Object.assign(new EventTarget(), { state: 'activated' });
  vi.stubGlobal('navigator', { serviceWorker: Object.assign(new EventTarget(), { getRegistration: vi.fn(async () => ({ active })) }) });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const { result, unmount } = renderHook(() => useServiceWorker());
  await act(async () => result.current.confirmUpdate());
  expect(reload).toHaveBeenCalledOnce();
  unmount();
});
