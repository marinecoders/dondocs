import { describe, it, expect } from 'vitest';
import { isDigital, isImage, type FormSignatureBlock } from '@/types/signature';

const block = (b: Partial<FormSignatureBlock>): FormSignatureBlock => ({
  name: '',
  statement: '',
  ...b,
});

describe('isDigital', () => {
  it('is true only for the digital style', () => {
    expect(isDigital(block({ style: 'digital' }))).toBe(true);
    expect(isDigital(block({ style: 'image' }))).toBe(false);
    expect(isDigital(block({ style: 'typed' }))).toBe(false);
    expect(isDigital(block({}))).toBe(false); // undefined style defaults to not-digital
  });
});

describe('isImage', () => {
  it('is true only for the image style WITH image data', () => {
    expect(isImage(block({ style: 'image', image: 'iVBORw0KGgo=' }))).toBe(true);
    // image style but no upload yet — nothing to draw, so not an image mark
    expect(isImage(block({ style: 'image' }))).toBe(false);
    expect(isImage(block({ style: 'image', image: '' }))).toBe(false);
    // stale image data on a non-image style must not count
    expect(isImage(block({ style: 'typed', image: 'iVBORw0KGgo=' }))).toBe(false);
    expect(isImage(block({ style: 'digital', image: 'iVBORw0KGgo=' }))).toBe(false);
    expect(isImage(block({}))).toBe(false);
  });
});

describe('a block is at most one kind of mark', () => {
  it('never reports both digital and image for the same block', () => {
    for (const style of ['typed', 'image', 'digital'] as const) {
      const b = block({ style, image: 'iVBORw0KGgo=' });
      expect(isDigital(b) && isImage(b)).toBe(false);
    }
  });
});
