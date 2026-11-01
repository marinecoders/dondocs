import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { useTourStore } from '@/stores/tourStore';

afterEach(() => {
  act(() => useTourStore.getState().end());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([false, true])('reanchors only when a nested scroller clips the tutorial target (clipped=%s)', (clipped) => {
  vi.useFakeTimers();
  render(<>
    <div data-testid="editor-scroll" style={{ overflowY: 'auto' }}>
      <button data-tour="visibility-fixture">Editor control</button>
    </div>
    <TourOverlay />
  </>);
  const target = screen.getByRole('button', { name: 'Editor control' });
  vi.spyOn(screen.getByTestId('editor-scroll'), 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 100, width: 400, height: 100 }),
  );
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 20, y: clipped ? 250 : 120, width: 120, height: 30 }),
  );
  const scroll = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {});
  act(() => useTourStore.getState().startSteps([
    { title: 'Editor control', body: 'Find this control.', target: '[data-tour="visibility-fixture"]' },
  ]));
  expect(scroll).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(150));
  expect(scroll).toHaveBeenCalledTimes(clipped ? 2 : 1);
});
