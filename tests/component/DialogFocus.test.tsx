import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

function ExternalDialog() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Workspace settings</button>
    <button>Next action</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Preferences for this device.</DialogDescription>
        <input aria-label="Preference" />
      </DialogContent>
    </Dialog>
  </>;
}

describe('externally controlled dialogs', () => {
  it('contains keyboard focus and returns to the launching control after Escape', async () => {
    const user = userEvent.setup();
    render(<ExternalDialog />);
    await user.click(screen.getByRole('button', { name: 'Workspace settings' }));
    expect(screen.getByRole('textbox', { name: 'Preference' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace settings' })).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus();
  });
});
