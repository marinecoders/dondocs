// @vitest-environment happy-dom
/**
 * The mobile getting-started sheet (PR: mobile onboarding). Locks the contract
 * that made the desktop-only checklist a dead menu item on phones:
 *  - on mobile, the checklist renders as a sheet driven by checklistSheetOpen
 *    (no floating pill), and `dismissed` does NOT block it — it is
 *    explicit-open only;
 *  - tapping a row runs its action and closes the sheet;
 *  - on desktop the floating pill renders;
 *  - Help can reopen the checklist after dismissal or completion on any screen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivationChecklist } from '@/components/onboarding/ActivationChecklist';
import { HelpModal } from '@/components/modals/HelpModal';
import { useUIStore } from '@/stores/uiStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useTourStore } from '@/stores/tourStore';

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ isMobile: true, checklistSheetOpen: false, templateLoaderOpen: false, helpOpen: false });
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

  it('opens the checklist from the floating pill on desktop', async () => {
    useUIStore.setState({ isMobile: false, checklistSheetOpen: false });
    render(<ActivationChecklist />);
    expect(screen.getByLabelText(/get set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/get set up/i));
    expect(screen.getByRole('dialog', { name: 'Getting started checklist' })).toHaveTextContent('Take the guided tour');
    expect(screen.getByRole('button', { name: /Take the guided tour/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText(/get set up/i)).toHaveFocus();
  });

  it('celebrated retires the desktop launcher', () => {
    useOnboardingStore.setState({ checklistCelebrated: true });
    useUIStore.setState({ isMobile: false });
    render(<ActivationChecklist />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/get set up/i)).not.toBeInTheDocument();
  });

  it('lets Escape close Help when the floating card is already open', async () => {
    const user = userEvent.setup();
    useUIStore.setState({ isMobile: false });
    render(<><button onClick={() => useUIStore.getState().setHelpOpen(true)}>Open Help</button><HelpModal /><ActivationChecklist /></>);
    await user.click(screen.getByLabelText(/get set up/i));
    await user.click(screen.getByRole('button', { name: 'Open Help' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument();
  });

  it.each([
    { mobile: false, celebrated: false },
    { mobile: false, celebrated: true },
    { mobile: true, celebrated: false },
    { mobile: true, celebrated: true },
  ])('reopens from Help with mobile=$mobile and celebrated=$celebrated', async ({ mobile, celebrated }) => {
    useUIStore.setState({ isMobile: mobile, helpOpen: true });
    useOnboardingStore.setState({ checklistDismissed: true, checklistCelebrated: celebrated });
    render(<><HelpModal /><ActivationChecklist /></>);

    await userEvent.click(screen.getByRole('button', { name: 'Getting started' }));
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Getting started/ })).toHaveTextContent('Build your first document');

    await userEvent.click(screen.getByRole('button', { name: /build your first document/i }));
    expect(useUIStore.getState().templateLoaderOpen).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/get set up/i)).not.toBeInTheDocument();
  });
});
