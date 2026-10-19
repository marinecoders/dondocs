import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserCompatibilityNotice } from '@/components/BrowserCompatibilityNotice';
import { getDeviceInfo } from '@/utils/device';

vi.mock('@/utils/device', () => ({
  getDeviceInfo: vi.fn(() => ({ isInAppBrowser: true, isIOS: false, isAndroid: true })),
}));

beforeEach(() => {
  vi.mocked(getDeviceInfo).mockReturnValue({ ...getDeviceInfo(), isInAppBrowser: true, isIOS: false, isAndroid: true });
});

describe('browser compatibility notice', () => {
  it('provides an accessible dialog, keeps keyboard focus inside, and dismisses with Escape', async () => {
    const user = userEvent.setup();
    render(<><button>Outside action</button><BrowserCompatibilityNotice /></>);
    const dialog = await screen.findByRole('dialog', { name: 'Limited browser support' });
    expect(screen.getByText('How to open in Chrome:')).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows Safari instructions on iOS and a named Close button', async () => {
    vi.mocked(getDeviceInfo).mockReturnValue({ ...getDeviceInfo(), isIOS: true, isAndroid: false });
    render(<BrowserCompatibilityNotice />);
    expect(await screen.findByText('How to open in Safari:')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
