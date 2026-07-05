/**
 * Component tests for <IconTip>.
 *
 * IconTip replaces native `title=` on icon-only controls with a themed Radix
 * tooltip. The subtle-but-important part: Radix only wires `aria-describedby`
 * (a description), so an icon-only trigger would have NO accessible *name* once
 * `title` is removed. IconTip injects `aria-label` from the same `label` unless
 * the caller already provided a name — that injection is what these lock in.
 */
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { IconTip } from '@/components/ui/icon-tip';
import { TooltipProvider } from '@/components/ui/tooltip';

// IconTip relies on the single app-root <TooltipProvider> (App.tsx) rather than
// nesting its own, so tests supply one.
function renderTip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('IconTip — accessible name injection', () => {
  it('gives an unlabelled icon button its accessible name from the label', () => {
    renderTip(
      <IconTip label="Look up a unit">
        <button type="button">
          <svg aria-hidden="true" />
        </button>
      </IconTip>
    );
    const btn = screen.getByRole('button', { name: 'Look up a unit' });
    expect(btn.getAttribute('aria-label')).toBe('Look up a unit');
  });

  it('does not override a caller-supplied accessible name', () => {
    renderTip(
      <IconTip label="Browse SSIC codes">
        <button type="button" aria-label="Custom name">
          <svg aria-hidden="true" />
        </button>
      </IconTip>
    );
    // The explicit name wins; the tooltip label does not clobber it.
    expect(screen.getByRole('button', { name: 'Custom name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Browse SSIC codes' })).toBeNull();
  });

  it('renders the child element as the tooltip trigger', () => {
    renderTip(
      <IconTip label="Search office codes">
        <button type="button" data-testid="trigger" />
      </IconTip>
    );
    const btn = screen.getByTestId('trigger');
    expect(btn.tagName).toBe('BUTTON');
    // asChild keeps the caller's element as the single trigger — no extra button wrapper.
    expect(screen.getAllByRole('button').length).toBe(1);
  });
});
