import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepository, referenceProblem } from './check-ci-actions.mjs';

const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function fixture(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-actions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return root;
}

test('accepts full commit references, subpath actions, reusable workflows and Docker digests', () => {
  for (const reference of [`actions/checkout@${sha}`, `owner/repo/sub/action@${sha}`, `docker://alpine:3@sha256:${digest}`]) {
    assert.equal(referenceProblem(reference, 'action'), null);
  }
  assert.equal(referenceProblem(`owner/repo/.github/workflows/test.yml@${sha}`, 'workflow'), null);
});

test('rejects tags, branches, abbreviated SHAs, expressions and mutable Docker images', () => {
  for (const reference of ['actions/checkout@v7', 'owner/repo@main', 'owner/repo@abc1234', '${{ inputs.action }}', 'docker://alpine:3', 'docker://alpine@sha256:abc', null]) {
    assert.ok(referenceProblem(reference, 'action'), String(reference));
  }
  assert.ok(referenceProblem('owner/repo/.github/workflows/test.yml@v1', 'workflow'));
});

test('allows deliberate local paths and rejects traversal or external workflow Docker refs', () => {
  assert.equal(referenceProblem('./.github/actions/check', 'action'), null);
  assert.equal(referenceProblem('./.github/workflows/check.yaml', 'workflow'), null);
  for (const reference of ['./../outside', './foo/../bar', './foo@main', './foo\\bar', './foo//bar', './${{ inputs.path }}']) {
    assert.ok(referenceProblem(reference, 'action'), reference);
  }
  assert.ok(referenceProblem('./somewhere/check.yml', 'workflow'));
  assert.ok(referenceProblem(`docker://alpine@sha256:${digest}`, 'workflow'));
});

test('parses quoted keys, flow style, aliases and multiline scalars without inspecting shell text', (t) => {
  const root = fixture(t, {
    '.github/workflows/test.yaml': `jobs:
  check:
    steps:
      - &pinned {"uses": 'actions/checkout@${sha}'}
      - *pinned
      - run: |
          echo 'uses: example/ignored@main'
      - uses: >-
          owner/unsafe@main
      - { uses: owner/also-unsafe@v1 }
  reuse: { uses: 'owner/repo/.github/workflows/test.yml@v2' }
`,
  });
  const result = checkRepository(root);
  assert.equal(result.count, 5);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join('\n'), /steps\[3\].uses/);
  assert.match(result.errors.join('\n'), /jobs.reuse.uses/);
});

test('follows local composite actions recursively and same-commit reusable workflows', (t) => {
  const root = fixture(t, {
    '.github/workflows/test.yml': `jobs:\n  reuse:\n    uses: ./.github/workflows/reuse.yaml\n  check:\n    steps:\n      - uses: ./.github/actions/check\n`,
    '.github/workflows/reuse.yaml': `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@${sha}\n`,
    '.github/actions/check/action.yaml': `runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/nested\n`,
    '.github/actions/nested/action.yml': 'runs:\n  using: composite\n  steps:\n    - uses: owner/unsafe@main\n    - uses: ./.github/actions/check\n',
  });
  const result = checkRepository(root);
  assert.equal(result.files, 4);
  assert.equal(result.count, 6);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /nested\/action.yml.*owner\/unsafe@main/);
});

test('accepts a repository containing only immutable external and existing local references', (t) => {
  const root = fixture(t, {
    '.github/workflows/test.yml': `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@${sha}\n      - uses: docker://alpine@sha256:${digest}\n      - uses: ./local\n`,
    'local/action.yml': `runs:\n  using: composite\n  steps:\n    - uses: owner/repo/subpath@${sha}\n`,
  });
  assert.deepEqual(checkRepository(root), { errors: [], count: 4, files: 2 });
});

test('fails on invalid YAML, duplicate keys, missing metadata and escaping symlinks', (t) => {
  const outside = fixture(t, { 'action.yml': 'runs: { using: node24 }' });
  const root = fixture(t, {
    '.github/workflows/invalid.yml': 'jobs: [\n',
    '.github/workflows/duplicate.yml': 'jobs: {}\njobs: {}\n',
    '.github/workflows/missing.yml': 'jobs:\n  check:\n    steps:\n      - uses: ./missing\n',
    '.github/workflows/escape.yml': 'jobs:\n  check:\n    steps:\n      - uses: ./escape\n',
  });
  symlinkSync(outside, path.join(root, 'escape'));
  const errors = checkRepository(root).errors.join('\n');
  assert.match(errors, /invalid.yml/);
  assert.match(errors, /duplicated mapping key/);
  assert.match(errors, /local action metadata not found/);
  assert.match(errors, /local reference escapes the repository/);
});
