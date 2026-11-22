import { describe, expect, it } from 'vitest';
import { hasSignatureDrawing, signatureDrawingBounds, signaturePoint, SIGNATURE_DRAWING } from '@/lib/signatureDrawing';

describe('signature drawing geometry', () => {
  it('maps a touch drawing independently of its viewport and clamps captured movement', () => {
    expect(signaturePoint(150, 75, { left: 50, top: 25, width: 200, height: 100 })).toEqual({ x: 400, y: 200 });
    expect(signaturePoint(-100, 400, { left: 50, top: 25, width: 200, height: 100 })).toEqual({ x: 0, y: 400 });
    expect(() => signaturePoint(10, 10, { left: 0, top: 0, width: 0, height: 100 })).toThrow('unavailable');
  });
  it('rejects an empty pad, accidental taps and invalid points', () => {
    expect(hasSignatureDrawing([])).toBe(false);
    expect(hasSignatureDrawing([[{ x: 20, y: 20 }]])).toBe(false);
    expect(hasSignatureDrawing([[{ x: 20, y: 20 }, { x: 21, y: 20 }]])).toBe(false);
    for (const x of [NaN, Infinity, -1, 801]) expect(() => signatureDrawingBounds([[{ x, y: 20 }]])).toThrow('invalid');
  });
  it('crops to ink with room for round caps, including strokes at the drawing edges', () => {
    expect(signatureDrawingBounds([[{ x: 0, y: 0 }, { x: 800, y: 400 }]])).toEqual({ left: -12, top: -12, width: 824, height: 424 });
    expect(signatureDrawingBounds([[{ x: 100.3, y: 150.2 }, { x: 220.8, y: 180.6 }]])).toEqual({ left: 88, top: 138, width: 145, height: 55 });
  });
  it('bounds points and strokes before allocating a PNG', () => {
    expect(() => signatureDrawingBounds(Array.from({ length: SIGNATURE_DRAWING.maxStrokes + 1 }, () => []))).toThrow('too many strokes');
    expect(() => signatureDrawingBounds([Array.from({ length: SIGNATURE_DRAWING.maxPoints + 1 }, (_, index) => ({ x: index % 800, y: 100 }))])).toThrow('too much detail');
  });
});
