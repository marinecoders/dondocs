// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Device detection is the only environment-dependent input to the gating
// logic; drive it per-test.
const deviceInfo = { isIOS: false };
vi.mock('@/utils/device', () => ({
  getDeviceInfo: () => deviceInfo,
}));

import { useInstallStore, type BeforeInstallPromptEvent } from '@/stores/installStore';
import { promptInstall, isInstallRelevant } from '@/hooks/useInstallPrompt';

function fakePrompt(over: Partial<BeforeInstallPromptEvent> = {}): BeforeInstallPromptEvent {
  return {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    ...over,
  } as unknown as BeforeInstallPromptEvent;
}

beforeEach(() => {
  deviceInfo.isIOS = false;
  localStorage.clear();
  useInstallStore.setState({
    deferredPrompt: null,
    canInstall: false,
    isInstalled: false,
    dismissedUntil: null,
    installModalOpen: false,
  });
});

describe('installStore transitions', () => {
  it('capturing a prompt flips canInstall; clearing it flips back', () => {
    const s = useInstallStore.getState();
    s.setDeferredPrompt(fakePrompt());
    expect(useInstallStore.getState().canInstall).toBe(true);
    s.setDeferredPrompt(null);
    expect(useInstallStore.getState().canInstall).toBe(false);
  });

  it('installing retires the captured prompt (it can never fire post-install)', () => {
    const s = useInstallStore.getState();
    s.setDeferredPrompt(fakePrompt());
    s.setInstalled(true);
    const st = useInstallStore.getState();
    expect(st.isInstalled).toBe(true);
    expect(st.deferredPrompt).toBeNull();
    expect(st.canInstall).toBe(false);
  });

  it('snoozeBanner sets a future timestamp (default ~14 days)', () => {
    useInstallStore.getState().snoozeBanner();
    const until = useInstallStore.getState().dismissedUntil!;
    expect(until).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);
    expect(until).toBeLessThan(Date.now() + 15 * 24 * 60 * 60 * 1000);
  });

  it('persists ONLY the snooze — never the live event or derived flags', () => {
    const s = useInstallStore.getState();
    s.setDeferredPrompt(fakePrompt());
    s.snoozeBanner();
    const persisted = JSON.parse(localStorage.getItem('dondocs-install') ?? '{}');
    expect(Object.keys(persisted.state ?? {})).toEqual(['dismissedUntil']);
  });
});

describe('promptInstall — never a dead end', () => {
  it('fires the native prompt when one is captured, then consumes the single-use event', async () => {
    const ev = fakePrompt();
    useInstallStore.getState().setDeferredPrompt(ev);
    await promptInstall();
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(useInstallStore.getState().deferredPrompt).toBeNull();
    expect(useInstallStore.getState().installModalOpen).toBe(false); // native path, no modal
  });

  it('opens the instructions modal when no prompt was ever captured (iOS/Firefox/enterprise)', async () => {
    await promptInstall();
    expect(useInstallStore.getState().installModalOpen).toBe(true);
  });

  it('falls back to the modal when a stale/consumed event throws', async () => {
    const ev = fakePrompt({ prompt: vi.fn(async () => Promise.reject(new Error('already used'))) });
    useInstallStore.getState().setDeferredPrompt(ev);
    await promptInstall();
    expect(useInstallStore.getState().installModalOpen).toBe(true);
    expect(useInstallStore.getState().deferredPrompt).toBeNull(); // still consumed
  });
});

describe('isInstallRelevant — where install affordances may appear', () => {
  it('never once installed', () => {
    expect(isInstallRelevant(true, true)).toBe(false);
    expect(isInstallRelevant(false, true)).toBe(false);
  });

  it('with a captured prompt', () => {
    expect(isInstallRelevant(true, false)).toBe(true);
  });

  it('on iOS even without a prompt (manual Add-to-Home-Screen path)', () => {
    deviceInfo.isIOS = true;
    expect(isInstallRelevant(false, false)).toBe(true);
  });

  it('nowhere else — no dead suggestions on prompt-less desktops', () => {
    deviceInfo.isIOS = false;
    expect(isInstallRelevant(false, false)).toBe(false);
  });
});
