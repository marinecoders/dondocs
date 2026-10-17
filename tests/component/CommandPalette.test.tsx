import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { FileText, Settings } from 'lucide-react';
import { CommandPalette, type CommandGroup } from '@/components/modals/CommandPalette';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
describe('workspace search navigation', () => {
  it('finds an older document by its body and passes the query to its destination', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const groups: CommandGroup[] = [{ label: 'Documents', scope: 'Documents', items: Array.from({ length: 16 }, (_, i) => ({
      id: `doc-${i}`, label: `Saved draft ${i}`, icon: FileText, onRun,
      searchFields: [{ text: i === 15 ? 'Harbor logistics request' : 'Routine draft', label: 'Paragraphs', sectionId: 'body' }],
    })) }];
    render(<CommandPalette open onClose={vi.fn()} groups={groups} />);
    await user.type(screen.getByRole('combobox'), 'harbor');
    expect(screen.getByRole('option')).toHaveTextContent('Saved draft 15');
    expect(screen.getByRole('option')).toHaveTextContent('Paragraphs: Harbor logistics request');
    await user.keyboard('{Enter}');
    expect(onRun).toHaveBeenCalledWith('harbor');
  });
  it('filters scopes and keeps Tab within the dialog instead of changing selection', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} groups={[
      { label: 'Documents', scope: 'Documents', items: [{ id: 'draft', label: 'Draft', icon: FileText, onRun: vi.fn() }] },
      { label: 'Settings', scope: 'Settings', items: [{ id: 'settings', label: 'Appearance', icon: Settings, onRun: vi.fn() }] },
    ]} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Appearance');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'All' })).toHaveFocus();
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('expanded workspace search', () => {
  it('inspects a form result before opening it and preserves the query for section navigation', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open presentation="workspace" onClose={onClose} groups={[
      { label: 'Documents', scope: 'Documents', items: [{ id: 'letter', label: 'Training letter', icon: FileText, onRun }] },
      { label: 'Forms', scope: 'Forms', items: [{ id: 'form', label: 'Counseling draft', icon: FileText, onRun, searchFields: [{ text: 'Harbor training review', label: 'Entry content', sectionId: 'content' }] }] },
    ]} />);
    await user.click(screen.getByRole('button', { name: 'Forms' }));
    await user.type(screen.getByRole('combobox'), 'harbor');
    await user.click(screen.getByRole('option'));
    expect(onRun).not.toHaveBeenCalled();
    const detail = within(screen.getByRole('complementary', { name: 'Selected result' }));
    expect(detail.getByText('Harbor training review')).toBeVisible();
    await user.click(detail.getByRole('button', { name: 'Open result' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith('harbor');
  });

  it('returns focus to the workspace launcher when Escape closes search', async () => {
    const user = userEvent.setup();
    function Workspace() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Search</button>{open && <CommandPalette open presentation="workspace" onClose={() => setOpen(false)} groups={[]} />}</>;
    }
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus();
  });
});
