/**
 * The card's own arithmetic: what it reads from a render result and what
 * it shows. The host and pdf.js are out of reach here; this is the rest.
 */
import { describe, it, expect } from 'vitest';
import { base64Of, bytesOf, fileOf, fileUri, nameOf, sizeOf, titleOf } from '../../companion/app/card';

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
});
