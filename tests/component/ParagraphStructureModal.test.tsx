/**
 * Component tests for <ParagraphStructureModal>, the pre-export review.
 *
 * The load-bearing property is that it never traps anyone: "Download anyway"
 * has to reach onProceed, and dismissing has to reach onCancel so the export
 * parked in App's ref is released rather than stranded.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParagraphStructureModal } from '@/components/modals/ParagraphStructureModal';
import { useUIStore } from '@/stores/uiStore';

const findings = [
  { message: 'Paragraph 1a is the only subparagraph of 1.' },
  { message: 'Paragraph 2 has a heading but paragraph 3 does not.' },
];

beforeEach(() => useUIStore.setState({ structureWarningOpen: true }));

describe('ParagraphStructureModal', () => {
  it('lists every finding', () => {
    render(<ParagraphStructureModal findings={findings} onCancel={() => {}} onProceed={() => {}} />);
    expect(screen.getByText(findings[0].message)).toBeTruthy();
    expect(screen.getByText(findings[1].message)).toBeTruthy();
  });

  it('renders nothing when there is nothing to report', () => {
    const { container } = render(
      <ParagraphStructureModal findings={[]} onCancel={() => {}} onProceed={() => {}} />
    );
    expect(container.textContent).toBe('');
  });

  it('lets the export through — this must never be a wall', async () => {
    const onProceed = vi.fn();
    render(<ParagraphStructureModal findings={findings} onCancel={() => {}} onProceed={onProceed} />);
    await userEvent.click(screen.getByRole('button', { name: /download anyway/i }));
    expect(onProceed).toHaveBeenCalledOnce();
    expect(useUIStore.getState().structureWarningOpen).toBe(false);
  });

  it('cancels back to the editor, releasing the parked export', async () => {
    const onCancel = vi.fn();
    render(<ParagraphStructureModal findings={findings} onCancel={onCancel} onProceed={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /go back and fix/i }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(useUIStore.getState().structureWarningOpen).toBe(false);
  });

  it('counts the findings in the subtitle', () => {
    render(
      <ParagraphStructureModal
        findings={[findings[0]]}
        onCancel={() => {}}
        onProceed={() => {}}
      />
    );
    expect(screen.getByText(/1 thing to look at/i)).toBeTruthy();
  });
});
