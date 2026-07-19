/**
 * Component tests for <ActionRoutingHelper>.
 *
 * The AA form is dual-use (a routed admin action vs a counseling entry), so the
 * helper must stay quiet until there's a routable action type — these lock in
 * that it collapses with no detection, surfaces the right suggestion when the
 * Nature of Action matches, and only inserts on an explicit click.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionRoutingHelper } from '@/components/editor/ActionRoutingHelper';
import { useRoutingStore } from '@/stores/routingStore';

beforeEach(() => useRoutingStore.setState({ overrides: {} }));

describe('ActionRoutingHelper', () => {
  it('stays collapsed to a quiet link when nothing routable is detected', () => {
    render(<ActionRoutingHelper natureOfAction="Counseling for failure to meet PFT standards" onInsert={vi.fn()} />);
    expect(screen.getByText(/Get routing help/i)).toBeTruthy();
    // The full "Where does this route?" panel is not shown.
    expect(screen.queryByText(/Where does this route\?/i)).toBeNull();
  });

  it('expands and can be opened by the drafter from the collapsed link', () => {
    render(<ActionRoutingHelper natureOfAction="" onInsert={vi.fn()} />);
    fireEvent.click(screen.getByText(/Get routing help/i));
    expect(screen.getByText(/Where does this route\?/i)).toBeTruthy();
  });

  it('auto-surfaces a cited suggestion when the Nature of Action matches an action type', () => {
    render(
      <ActionRoutingHelper
        natureOfAction="Request BAH-with-dependents rate for newly added dependent"
        onInsert={vi.fn()}
      />
    );
    expect(screen.getByText(/Where does this route\?/i)).toBeTruthy();
    expect(screen.getByText(/IPAC Dependent Administration/i)).toBeTruthy();
    expect(screen.getByText(/MCO 5000\.14D/i)).toBeTruthy();
    // Always shows the advisory caveat.
    expect(screen.getByText(/Confirm with your unit SOP/i)).toBeTruthy();
  });

  it('inserts the suggested destination only when the drafter clicks Use', () => {
    const onInsert = vi.fn();
    render(<ActionRoutingHelper natureOfAction="Request reenlistment and SRB" onInsert={onInsert} />);
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use ".*" in the To field/i }));
    expect(onInsert).toHaveBeenCalledWith('Unit Career Planner (career retention specialist)');
  });

  it('lets a unit save its own routing, which then wins and can be reset', () => {
    const onInsert = vi.fn();
    render(<ActionRoutingHelper natureOfAction="Request TAD travel via DTS" onInsert={onInsert} />);

    fireEvent.click(screen.getByRole('button', { name: /Set your command's routing/i }));
    fireEvent.change(screen.getByLabelText(/Your command's routing/i), {
      target: { value: 'S-4 Travel, Bldg 22 (Cpl Vega)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    // The unit value now shows and inserts instead of the doctrine default.
    expect(screen.getByText('S-4 Travel, Bldg 22 (Cpl Vega)')).toBeTruthy();
    expect(screen.getByText(/Saved for your unit/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use ".*" in the To field/i }));
    expect(onInsert).toHaveBeenCalledWith('S-4 Travel, Bldg 22 (Cpl Vega)');

    // Reset restores the bundled default.
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(screen.queryByText('S-4 Travel, Bldg 22 (Cpl Vega)')).toBeNull();
    expect(screen.getByText(/S-1 or S-4/i)).toBeTruthy();
  });
});
