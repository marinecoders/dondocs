/**
 * Component tests for <ActionRoutingHelper>.
 *
 * The AA form is dual-use (a routed admin action vs a counseling entry), so the
 * helper must stay quiet until there's a routable action type — these lock in
 * that it collapses with no detection, surfaces the right suggestion when the
 * Nature of Action matches, and only inserts on an explicit click.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionRoutingHelper } from '@/components/editor/ActionRoutingHelper';

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
});
