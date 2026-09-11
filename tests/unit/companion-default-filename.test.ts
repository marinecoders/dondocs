/**
 * A render without `out` never replaces a file. The default name is a slug
 * of the subject, and the same subject rendered twice used to write over the
 * first copy silently; now the second takes the next free number. A given
 * `out` still replaces, as its description says.
 */
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0;
vi.mock('../../companion/render', () => ({ renderPdf: async () => new TextEncoder().encode(`%PDF render ${++n}`) }));
const { renderToFile } = await import('../../companion/renderToFile');

describe('the default filename', () => {
  it('takes the next free number instead of replacing a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-names-'));
    const letter = { docType: 'naval_letter', subject: 'SAME SUBJECT' };
    const first = await renderToFile(letter, {}, root);
    const second = await renderToFile(letter, {}, root);
    const third = await renderToFile(letter, {}, root);
    expect([first, second, third].map((f) => f.path.slice(root.length + 1)))
      .toEqual(['same-subject.pdf', 'same-subject-2.pdf', 'same-subject-3.pdf']);
    expect((await readFile(first.path)).toString()).toBe('%PDF render 1');
  });

  it('gives concurrent renders of one subject distinct files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-names-'));
    const letter = { docType: 'naval_letter', subject: 'AT ONCE' };
    const files = await Promise.all([1, 2, 3].map(() => renderToFile(letter, {}, root)));
    expect(new Set(files.map((f) => f.path)).size).toBe(3);
    expect((await readdir(root)).sort()).toEqual(['at-once-2.pdf', 'at-once-3.pdf', 'at-once.pdf']);
  });

  it('replaces the file when out is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-names-'));
    const letter = { docType: 'naval_letter', subject: 'SAME SUBJECT', out: 'mine.pdf' };
    await renderToFile(letter, {}, root);
    const again = await renderToFile(letter, {}, root);
    expect(await readdir(root)).toEqual(['mine.pdf']);
    expect((await readFile(again.path)).toString()).toMatch(/render \d+$/);
  });
});
