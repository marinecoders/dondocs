import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { WelcomeModal, showWelcomeOnFirstVisit } from '@/components/modals/WelcomeModal';
import { useUIStore } from '@/stores/uiStore';

const visit = vi.hoisted(() => ({ first: true, inApp: false }));
vi.mock('@/lib/firstVisit', () => ({ isFirstVisit: () => visit.first }));
vi.mock('@/utils/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/device')>();
  return { ...actual, getDeviceInfo: () => ({ ...actual.getDeviceInfo(), isInAppBrowser: visit.inApp }) };
});

beforeEach(() => {
  useUIStore.setState({ welcomeOpen: false });
  visit.first = true;
  visit.inApp = false;
});

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
  it('greets a browser on its first visit', () => {
    render(<WelcomeModal />);
    act(() => showWelcomeOnFirstVisit());
    expect(screen.getByRole('dialog', { name: 'Welcome aboard DonDocs' })).toBeInTheDocument();
  });

  it('stays closed for a browser that has been here before', () => {
    visit.first = false;
    showWelcomeOnFirstVisit();
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });

  it('defers to the browser notice in an in-app browser', () => {
    visit.inApp = true;
    showWelcomeOnFirstVisit();
    expect(useUIStore.getState().welcomeOpen).toBe(false);
  });
});
