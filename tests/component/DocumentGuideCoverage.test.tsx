import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DOCUMENT_TYPE_GUIDES, GUIDE_CATEGORIES } from '@/data/documentGuide';
import { DOC_TYPE_LABELS, FORM_TYPE_LABELS } from '@/types/document';
import { DocumentGuideModal } from '@/components/modals/DocumentGuideModal';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'browse' }));

describe('document guide completeness', () => {
  it('covers every selectable correspondence and form type exactly once', () => {
    const supported = [...Object.keys(DOC_TYPE_LABELS), ...Object.keys(FORM_TYPE_LABELS)];
    expect(DOCUMENT_TYPE_GUIDES.map(({ id }) => id).sort()).toEqual(supported.sort());
    for (const guide of DOCUMENT_TYPE_GUIDES) {
      expect(GUIDE_CATEGORIES.some(({ id }) => id === guide.category)).toBe(true);
      expect(guide.summary.length).toBeGreaterThan(0);
    }
  });

  it('supports keyboard switching between guide topics', async () => {
    const user = userEvent.setup();
    render(<DocumentGuideModal />);
    const browse = screen.getByRole('tab', { name: 'Browse' });
    await user.click(browse);
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Features' })).toBeVisible();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel', { name: 'Browse' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Correspondence 21 types/ }));
    expect(screen.getByRole('button', { name: /Action Memorandum/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Information Memorandum/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Standard Memorandum \(HqDON\)/ })).toBeVisible();
  });
});
