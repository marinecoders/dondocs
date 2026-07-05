/**
 * Component tests for <ClassificationSection> (classification path).
 *
 * Classification marking is the highest-consequence domain in the app
 * (audit #1). These tests lock in that the picker surfaces the right
 * marking-specific fields for the selected level — the classified warning
 * + classified config for a classified level, the CUI config for CUI, and
 * neither for an unclassified document.
 *
 * Domain restriction + async config are mocked to a permissive, settled
 * state so the conditional rendering is driven purely by the selected
 * level (not by the test host's hostname or a config-load race).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClassificationSection } from '@/components/editor/ClassificationSection';
import { useDocumentStore } from '@/stores/documentStore';

const ALL_LEVELS = ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'];

vi.mock('@/lib/domainClassification', () => ({
  getDomainClassificationRestriction: () => ({ allowedLevels: ALL_LEVELS }),
  getDomainRestrictionMessage: () => 'All levels permitted (test).',
}));
vi.mock('@/config/classification', () => ({
  getClassificationConfig: () => Promise.resolve(null),
}));

function setLevel(level: string) {
  useDocumentStore.getState().setField('classLevel', level);
}

beforeEach(() => {
  setLevel('unclassified');
});

describe('ClassificationSection', () => {
  it('reflects the selected classified level in the section header', () => {
    setLevel('secret');
    render(<ClassificationSection />);
    // The header label is visible without expanding the accordion.
    expect(screen.getByText('(SECRET)')).toBeInTheDocument();
  });

  it('shows the classified warning + classified config when a classified level is selected', async () => {
    const user = userEvent.setup();
    setLevel('secret');
    render(<ClassificationSection />);

    await user.click(screen.getByText('Classification')); // expand accordion

    expect(await screen.findByText('Classified Document Warning')).toBeInTheDocument();
    expect(screen.getByText('Classified Configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Classified By')).toBeInTheDocument();
    // CUI-only config must NOT be present for a classified (non-CUI) level.
    expect(screen.queryByText('CUI Configuration')).not.toBeInTheDocument();
  });

  it('shows CUI configuration (and no classified warning) for CUI', async () => {
    const user = userEvent.setup();
    setLevel('cui');
    render(<ClassificationSection />);

    await user.click(screen.getByText('Classification'));

    expect(await screen.findByText('CUI Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Classified Document Warning')).not.toBeInTheDocument();
  });

  it('offers no classified marking in the custom quick-fill (this browser tool is not accredited)', async () => {
    const user = userEvent.setup();
    setLevel('custom');
    render(<ClassificationSection />);

    await user.click(screen.getByText('Classification')); // expand accordion

    // The unclassified caveats are offered as one-click quick-fill…
    expect(await screen.findByRole('button', { name: 'FOR OFFICIAL USE ONLY' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unclassified' })).toBeInTheDocument();

    // …but classified levels must NEVER be a one-click preset here. They are
    // reachable only through the domain-accreditation-gated level dropdown.
    for (const name of ['CONFIDENTIAL', 'SECRET', 'TOP SECRET', 'TOP SECRET//SCI']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('shows neither classified nor CUI config for an unclassified document', async () => {
    const user = userEvent.setup();
    setLevel('unclassified');
    render(<ClassificationSection />);

    await user.click(screen.getByText('Classification'));

    // The "Domain Restrictions" banner is now gated to domains that actually
    // narrow the level list; the permissive mock above does not, so it must NOT
    // render (keeps the default panel clean, matching the design). Wait on the
    // always-present level picker instead, then assert no marking-specific blocks.
    expect(await screen.findByText('Classification Level')).toBeInTheDocument();
    expect(screen.queryByText('Domain Restrictions')).not.toBeInTheDocument();
    expect(screen.queryByText('Classified Document Warning')).not.toBeInTheDocument();
    expect(screen.queryByText('CUI Configuration')).not.toBeInTheDocument();
  });
});
