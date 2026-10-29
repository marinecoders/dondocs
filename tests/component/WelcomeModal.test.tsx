import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { WelcomeModal, showWelcomeOnFirstVisit } from '@/components/modals/WelcomeModal';
import { useUIStore } from '@/stores/uiStore';

const device = vi.hoisted(() => ({ inApp: false }));
vi.mock('@/utils/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/device')>();
  return { ...actual, getDeviceInfo: () => ({ ...actual.getDeviceInfo(), isInAppBrowser: device.inApp }) };
});

beforeEach(() => {
  useUIStore.setState({ welcomeOpen: false });
  localStorage.clear();
  device.inApp = false;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('optional welcome', () => {
  it('leaves document work unobstructed until explicitly opened from Help', async () => {
    render(<WelcomeModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => useUIStore.getState().setWelcomeOpen(true));
    expect(screen.getByRole('dialog', { name: 'Welcome aboard DonDocs' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start writing' }));
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });
});

describe('first-visit welcome', () => {
  it('greets a new visitor once per browser', () => {
    render(<WelcomeModal />);
    act(() => showWelcomeOnFirstVisit());
    expect(screen.getByRole('dialog', { name: 'Welcome aboard DonDocs' })).toBeInTheDocument();

    act(() => useUIStore.getState().setWelcomeOpen(false));
    act(() => showWelcomeOnFirstVisit());
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });

  it('stays closed for a browser that dismissed it in an earlier release', () => {
    localStorage.setItem('dondocs-welcome-shown', '3.0');
    showWelcomeOnFirstVisit();
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });

  it('defers to the browser notice in an in-app browser', () => {
    device.inApp = true;
    showWelcomeOnFirstVisit();
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });

  it('stays closed when storage is blocked, rather than greeting every visit', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    showWelcomeOnFirstVisit();
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });
});
