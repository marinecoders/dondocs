import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText } from 'lucide-react';
import { CommandPalette, type CommandGroup } from '@/components/modals/CommandPalette';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
describe('workspace search navigation', () => {
  it('finds an older document by its body and passes the query to its destination', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const groups: CommandGroup[] = [{ label: 'Documents', items: Array.from({ length: 16 }, (_, i) => ({
      id: `doc-${i}`, label: `Saved draft ${i}`, icon: FileText, onRun,
      searchFields: [{ text: i === 15 ? 'Harbor logistics request' : 'Routine draft', label: 'Paragraphs', sectionId: 'body' }],
    })) }];
    render(<CommandPalette open onClose={vi.fn()} groups={groups} />);
    await user.type(screen.getByRole('combobox'), 'harbor');
    expect(screen.getByRole('option')).toHaveTextContent('Saved draft 15');
    expect(screen.getByRole('option')).toHaveTextContent('Harbor logistics request');
    await user.keyboard('{Enter}');
    expect(onRun).toHaveBeenCalledWith('harbor');
  });
});
