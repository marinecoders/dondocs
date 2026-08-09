/**
 * The output sandbox is the companion's security boundary.
 *
 * The caller is an LLM assembling JSON, so a traversal is a realistic input
 * rather than an attack scenario — these are the cases that must be refused
 * before anything is written.
 */
import { describe, it, expect } from 'vitest';
import { resolveOutputPath, filenameFor, OutsideSandboxError } from '../../companion/outputPath';

const ROOT = '/tmp/dondocs-root';

describe('resolveOutputPath', () => {
  it('keeps a plain filename inside the root', () => {
    expect(resolveOutputPath('letter.pdf', ROOT)).toBe('/tmp/dondocs-root/letter.pdf');
  });

  it('allows a subfolder', () => {
    expect(resolveOutputPath('2026/letter.pdf', ROOT)).toBe('/tmp/dondocs-root/2026/letter.pdf');
  });

  it('refuses a parent traversal', () => {
    expect(() => resolveOutputPath('../escaped.pdf', ROOT)).toThrow(OutsideSandboxError);
  });

  it('refuses a deep traversal aimed at a real target', () => {
    expect(() => resolveOutputPath('../../../.ssh/authorized_keys', ROOT)).toThrow(OutsideSandboxError);
  });

  it('refuses an absolute path', () => {
    expect(() => resolveOutputPath('/etc/passwd', ROOT)).toThrow(OutsideSandboxError);
  });

  it('refuses a traversal hidden mid-path', () => {
    expect(() => resolveOutputPath('a/b/../../../out.pdf', ROOT)).toThrow(OutsideSandboxError);
  });

  it('refuses a sibling directory that merely shares the prefix', () => {
    // A naive startsWith(root) check would accept this one.
    expect(() => resolveOutputPath('../dondocs-rootEvil/x.pdf', ROOT)).toThrow(OutsideSandboxError);
  });

  it('normalises a redundant but harmless path', () => {
    expect(resolveOutputPath('./sub/../letter.pdf', ROOT)).toBe('/tmp/dondocs-root/letter.pdf');
  });
});

describe('filenameFor', () => {
  it('slugs a subject line', () => {
    expect(filenameFor('PROOF OF CONCEPT FOR AGENT DRIVEN CORRESPONDENCE', 'pdf'))
      .toBe('proof-of-concept-for-agent-driven-correspondence.pdf');
  });

  it('strips characters that break filesystems', () => {
    expect(filenameFor('Re: budget/FY26 <draft>', 'docx')).toBe('re-budget-fy26-draft.docx');
  });

  it('falls back when a subject slugs to nothing', () => {
    expect(filenameFor('///', 'pdf')).toBe('document.pdf');
    expect(filenameFor(undefined, 'pdf')).toBe('document.pdf');
  });

  it('bounds the length', () => {
    expect(filenameFor('x'.repeat(500), 'pdf').length).toBeLessThanOrEqual(84);
  });
});
