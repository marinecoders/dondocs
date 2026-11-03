import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePdfZoom } from '@/components/pdf/usePdfZoom';
import { useUIStore } from '@/stores/uiStore';
import type { ZoomMode } from '@/components/pdf/pdfMath';

let resize: (width: number, height: number) => void;

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState());
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = (width, height) => callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientWidth: { value: 660 },
    clientHeight: { value: 1000 },
  });
  const contentRef = { current: element };
  return renderHook(
    ({ width, aspect }) => usePdfZoom(contentRef, width, aspect),
    { initialProps: { width: 612, aspect: 8.5 / 11 } }
  );
}

describe('preview zoom preference', () => {
  it('keeps 110% when the panel resizes and a wider form loads', async () => {
    const { result, rerender } = setup();
    act(() => result.current.zoomStep(1));
    expect(result.current.pageWidth).toBe(673);

    act(() => resize(900, 700));
    rerender({ width: 792, aspect: 11 / 8.5 });
    await waitFor(() => expect(result.current.pageWidth).toBe(871));
    expect(Math.round(result.current.effectiveScale * 100)).toBe(110);
    expect(result.current.mode).toEqual({ kind: 'manual', scale: 1.1 });
  });

  it('keeps Fit page active while recalculating for the panel and page dimensions', async () => {
    const { result, rerender } = setup();
    act(() => result.current.zoomFitPage());
    expect(result.current.pageWidth).toBe(612);

    act(() => resize(900, 700));
    await waitFor(() => expect(result.current.pageWidth).toBeCloseTo(652 * 8.5 / 11));
    rerender({ width: 792, aspect: 11 / 8.5 });
    expect(result.current.pageWidth).toBeCloseTo(652 * 11 / 8.5);
    expect(result.current.mode).toEqual({ kind: 'fit-page' });
  });

  it('keeps Fit width tracking the panel after loading a wider form', async () => {
    const { result, rerender } = setup();
    act(() => resize(900, 700));
    await waitFor(() => expect(result.current.pageWidth).toBe(852));
    rerender({ width: 792, aspect: 11 / 8.5 });
    expect(result.current.pageWidth).toBe(852);
    expect(result.current.mode).toEqual({ kind: 'fit-width' });
  });

  it.each<ZoomMode>([{ kind: 'manual', scale: 1.1 }, { kind: 'fit-page' }, { kind: 'fit-width' }])(
    'restores $kind from saved UI preferences',
    async (mode) => {
      const storage = useUIStore.persist.getOptions().storage!;
      useUIStore.getState().setPdfZoomMode(mode);
      const saved = await storage.getItem('dondocs_ui');

      // Simulate a fresh store starting with defaults, then reading disk.
      useUIStore.setState(useUIStore.getInitialState());
      await storage.setItem('dondocs_ui', saved!);
      await useUIStore.persist.rehydrate();
      expect(useUIStore.getState().pdfZoomMode).toEqual(mode);
    }
  );
});
