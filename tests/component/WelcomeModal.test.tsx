import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { WelcomeModal } from '@/components/modals/WelcomeModal';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => { useUIStore.setState({ welcomeOpen: false }); });
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
