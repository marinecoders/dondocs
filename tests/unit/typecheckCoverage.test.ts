/**
 * The typecheck covers what the repo holds.
 *
 * `tsconfig.json` is a solution file: `files: []` and a list of references.
 * Plain `tsc` does not follow references, so for as long as the CI job ran
 * `tsc --noEmit` against it, the job compiled nothing and passed on
 * anything, a blatant error in `src` included. A command that checks
 * nothing looks exactly like one that passes, so both halves are asserted
 * here: every project on disk is referenced, and the job builds the
 * solution rather than reading it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const REPO = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf-8');

describe('the typecheck', () => {
  it('references every project in the repo, since one left out is one nothing checks', () => {
    const onDisk = readdirSync(REPO).filter((name) => /^tsconfig\..+\.json$/.test(name)).sort();
    const config = ts.parseConfigFileTextToJson('tsconfig.json', read('tsconfig.json')).config as {
      references?: Array<{ path: string }>;
    };
    const referenced = (config.references ?? []).map((r) => r.path.replace(/^\.\//, '')).sort();
    expect(referenced).toEqual(onDisk);
  });

  it('builds the solution rather than reading it', () => {
    const task = read('.github', 'workflows', 'test.yml')
      .split('\n')
      .find((line) => line.includes('typecheck)')) ?? '';
    expect(task).toContain('tsc -b');
  });
});
