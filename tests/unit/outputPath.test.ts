/**
 * The output sandbox is the companion's security boundary.
 *
 * The caller is an LLM assembling JSON, so a traversal is a realistic input
 * rather than an attack scenario — these are the cases that must be refused
 * before anything is written.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('refuses the root itself', () => {
    // Writing the bytes at the root path turns the output directory into a
    // file and breaks every later render.
    for (const requested of ['', '.', './', 'sub/..']) {
      expect(() => resolveOutputPath(requested, ROOT), JSON.stringify(requested)).toThrow(OutsideSandboxError);
    }
  });
});

describe('resolveOutputPath on a real directory', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), 'dondocs-sandbox-'));
    root = join(base, 'root');
    outside = join(base, 'outside');
    await mkdir(join(root, 'plain'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(root, 'door'));
    await writeFile(join(outside, 'target.pdf'), 'x');
    await symlink(join(outside, 'target.pdf'), join(root, 'alias.pdf'));
    // Dangling links: nothing exists at the far end yet, so a write there
    // would create the file outside the root.
    await symlink(join(outside, 'not-yet.pdf'), join(root, 'dangling.pdf'));
    await symlink(join(outside, 'no-such-dir'), join(root, 'dangling-dir'));
  });
  afterAll(async () => { await rm(join(root, '..'), { recursive: true, force: true }); });

  it('still allows a real subdirectory', () => {
    expect(resolveOutputPath('plain/letter.pdf', root)).toBe(join(root, 'plain', 'letter.pdf'));
  });

  it('refuses a path through a symlinked directory that leaves the root', () => {
    // Lexically inside the root; on disk it lands in `outside`.
    expect(() => resolveOutputPath('door/letter.pdf', root)).toThrow(OutsideSandboxError);
  });

  it('refuses a filename that is itself a symlink', () => {
    expect(() => resolveOutputPath('alias.pdf', root)).toThrow(OutsideSandboxError);
  });

  it('refuses a dangling symlink, as a filename or as a directory on the way', () => {
    expect(() => resolveOutputPath('dangling.pdf', root)).toThrow(OutsideSandboxError);
    expect(() => resolveOutputPath('dangling-dir/letter.pdf', root)).toThrow(OutsideSandboxError);
  });

  it('allows a new file under a root that does not exist yet', () => {
    const fresh = join(root, '..', 'not-yet');
    expect(resolveOutputPath('letter.pdf', fresh)).toBe(join(fresh, 'letter.pdf'));
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
