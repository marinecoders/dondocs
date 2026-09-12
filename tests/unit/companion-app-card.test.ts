/**
 * The card's own arithmetic: what it reads from a render result and what
 * it shows. The host and pdf.js are out of reach here; this is the rest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64Of, bytesOf, fileOf, fileUri, fitScale, mostVisible, nameOf, sizeOf, titleOf } from '../../companion/app/card';

describe('the letter card', () => {
  it('takes a render result and refuses anything else', () => {
    const file = { format: 'pdf', path: '/root/drafts/v2.pdf', out: 'drafts/v2.pdf', bytes: 249_141 };
    expect(fileOf({ structuredContent: file })).toEqual(file);
    expect(fileOf({ structuredContent: file, isError: true })).toBeUndefined();
    expect(fileOf({ structuredContent: { format: 'txt', path: '/x', out: 'x', bytes: 1 } })).toBeUndefined();
    expect(fileOf({ structuredContent: { format: 'pdf', path: '/x' } })).toBeUndefined();
    expect(fileOf({})).toBeUndefined();
  });

  it('reads a nested name back through one encoded segment', () => {
    expect(fileUri('request-for-cft-waiver.pdf')).toBe('dondocs://files/request-for-cft-waiver.pdf');
    expect(fileUri('drafts/v2.pdf')).toBe('dondocs://files/drafts%2Fv2.pdf');
  });

  it('names and titles the file from out', () => {
    expect(nameOf('drafts/v2.pdf')).toBe('v2.pdf');
    expect(titleOf('request-for-cft-waiver.pdf')).toBe('Request for cft waiver');
    expect(titleOf('drafts/v2.docx')).toBe('V2');
    expect(titleOf('.pdf')).toBe('.pdf');
  });

  it('sizes in the unit a person would use', () => {
    expect(sizeOf(512)).toBe('512 B');
    expect(sizeOf(249_141)).toBe('243 KB');
    expect(sizeOf(1_300_000)).toBe('1.2 MB');
  });

  it('round-trips bytes through base64, past the call-stack limit of one spread', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(bytesOf(base64Of(bytes))).toEqual(bytes);
    expect(base64Of(new Uint8Array([37, 80, 68, 70]))).toBe(Buffer.from('%PDF').toString('base64'));
  });

  it('fits a page to the width, and to the height when one is given', () => {
    const letter = { width: 612, height: 792 };
    expect(fitScale(letter, 612)).toBe(1);
    expect(fitScale(letter, 306)).toBe(0.5);
    // Height-bound: 792 * 0.5 = 396 is over 300, so the height decides.
    expect(fitScale(letter, 306, 300)).toBeCloseTo(300 / 792);
    // A cap that is not binding changes nothing.
    expect(fitScale(letter, 306, 5000)).toBe(0.5);
    // A degenerate page never yields zero or infinity.
    expect(fitScale({ width: 0, height: 0 }, 300)).toBeGreaterThan(0);
    expect(Number.isFinite(fitScale({ width: 0, height: 0 }, 300))).toBe(true);
  });

  it('names the page that shows most of itself in the viewport', () => {
    // Three pages of 900px with 12px gaps, scrolled so page 2 fills the view.
    const rects = [{ top: -1300, bottom: -400 }, { top: -388, bottom: 512 }, { top: 524, bottom: 1424 }];
    expect(mostVisible(rects, 800)).toBe(2);
    // At the top, page 1.
    expect(mostVisible([{ top: 0, bottom: 900 }, { top: 912, bottom: 1812 }], 800)).toBe(1);
    // A tie goes to the earlier page; nothing visible gives page 1.
    expect(mostVisible([{ top: -400, bottom: 400 }, { top: 400, bottom: 1200 }], 800)).toBe(1);
    expect(mostVisible([{ top: 2000, bottom: 2900 }], 800)).toBe(1);
    expect(mostVisible([], 800)).toBe(1);
  });

  it('waits on no animation frame, which a card off screen is never given', () => {
    // The card lives in a long conversation and is often not displayed; a
    // browser withholds frames from such a document, and a layout step that
    // waited for one left the fullscreen switch half-done. Comments may say
    // the word, code may not.
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'companion', 'app', 'letter.ts'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/requestAnimationFrame/);
  });
});
