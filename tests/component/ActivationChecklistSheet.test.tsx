// @vitest-environment happy-dom
/**
 * The mobile getting-started sheet (PR: mobile onboarding). Locks the contract
 * that made the desktop-only checklist a dead menu item on phones:
 *  - on mobile, the checklist renders as a sheet driven by checklistSheetOpen
 *    (no floating pill), and `dismissed` does NOT block it — it is
 *    explicit-open only;
 *  - tapping a row runs its action and closes the sheet;
 *  - on desktop the floating pill renders and no sheet exists.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivationChecklist } from '@/components/onboarding/ActivationChecklist';
import { useUIStore } from '@/stores/uiStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useTourStore } from '@/stores/tourStore';

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ isMobile: true, checklistSheetOpen: false, templateLoaderOpen: false });
  useOnboardingStore.setState({ completed: {}, checklistDismissed: false, checklistCelebrated: false });
  useTourStore.setState({ active: false });
});

describe('ActivationChecklist — mobile bottom sheet', () => {
  it('renders nothing on mobile until the sheet is opened (no floating pill)', () => {
    render(<ActivationChecklist />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/get set up/i)).not.toBeInTheDocument();
  });

  it('opens as a sheet with the checklist rows, even when dismissed', () => {
    // dismissed hides the DESKTOP launcher; the sheet is explicit-open only
    // and must ignore it — this exact combination was the dead-menu-item bug.
    useOnboardingStore.setState({ checklistDismissed: true });
    useUIStore.setState({ checklistSheetOpen: true });
    render(<ActivationChecklist />);
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('Getting started');
    expect(sheet).toHaveTextContent('Take the guided tour');
    expect(sheet).toHaveTextContent('Back up your work');
  });

  it('tapping a row fires its action and closes the sheet', async () => {
    const user = userEvent.setup();
    useUIStore.setState({ checklistSheetOpen: true });
    render(<ActivationChecklist />);
    await user.click(screen.getByRole('button', { name: /build your first document/i }));
    expect(useUIStore.getState().templateLoaderOpen).toBe(true); // action ran
    expect(useUIStore.getState().checklistSheetOpen).toBe(false); // sheet closed
  });

  it('renders the floating pill (not a sheet) on desktop', () => {
    useUIStore.setState({ isMobile: false, checklistSheetOpen: false });
    render(<ActivationChecklist />);
    expect(screen.getByLabelText(/get set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('celebrated retires the sheet entirely', () => {
    useOnboardingStore.setState({ checklistCelebrated: true });
    useUIStore.setState({ checklistSheetOpen: true });
    render(<ActivationChecklist />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
