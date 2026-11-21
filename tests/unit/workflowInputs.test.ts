// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface Workflow { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }
const yaml = createRequire(import.meta.url)('js-yaml') as { load(source: string): Workflow };

function runStep(file: string, job: string, name: string, command: string, env: Record<string, string>, setup?: (root: string) => void) {
  const workflow = yaml.load(readFileSync(file, 'utf8'));
  const script = workflow.jobs[job].steps.find(step => step.name === name)?.run;
  expect(script).toBeTruthy();
  const root = mkdtempSync(join(tmpdir(), 'dondocs-workflow-inputs-'));
  try {
    setup?.(root);
    writeFileSync(join(root, command), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv[2] === 'release' && process.argv[3] === 'view') process.exit(1);\n`, { mode: 0o755 });
    const result = spawnSync('bash', ['-c', script!], {
      cwd: root, encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, ...env, PATH: `${root}:${process.env.PATH}`, TEST_CALLS: join(root, 'calls.jsonl') },
    });
    expect(result.error).toBeUndefined();
    const calls = existsSync(join(root, 'calls.jsonl')) ? readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [];
    return { status: result.status, stderr: result.stderr, calls, injected: existsSync(join(root, 'injected')), notes: existsSync(join(root, 'notes.md')) ? readFileSync(join(root, 'notes.md'), 'utf8') : '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('passes cartesian inputs as individual arguments and rejects shell syntax', () => {
  const env = { INPUT_DOC_TYPE: 'naval_letter', INPUT_PATH: 'docx', INPUT_LIMIT: '20', INPUT_START: '5', INPUT_SHARD: '1/2' };
  const run = (inputs: Record<string, string>) => runStep('.github/workflows/cartesian.yml', 'cartesian-manual', 'run cartesian', 'npm', inputs);
  const valid = run(env);
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.calls).toEqual([['run', 'test:cartesian', '--', '--doc-type=naval_letter', '--path=docx', '--limit=20', '--start=5', '--shard=1/2']]);
  expect(run({ ...env, INPUT_DOC_TYPE: 'all', INPUT_LIMIT: '', INPUT_START: '0', INPUT_SHARD: '' }).calls).toEqual([['run', 'test:cartesian', '--', '--path=docx']]);
  for (const key of Object.keys(env)) {
    const invalid = run({ ...env, [key]: '$(touch injected)' });
    expect(invalid.status).toBe(1);
    expect(invalid.calls).toEqual([]);
    expect(invalid.injected).toBe(false);
  }
});

it('creates the release for its exact version and SHA, and rejects an injected version', () => {
  const run = (version: string) => runStep('.github/workflows/release.yml', 'release', "Create release if it doesn't exist", 'gh', { RELEASE_VERSION: version, RELEASE_SHA: 'a'.repeat(40) }, root => {
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.3.189]\n\nFixed worker asset reads.\n\n## [1.3.188]\nOlder notes.\n');
  });
  const valid = run('1.3.189');
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.calls).toEqual([
    ['release', 'view', 'v1.3.189'],
    ['release', 'create', 'v1.3.189', '--target', 'a'.repeat(40), '--title', 'v1.3.189', '--notes-file', 'notes.md', 'dist-mcpb/dondocs-1.3.189.mcpb', 'dist-mcpb/dondocs-1.3.189.mcpb.sha256'],
  ]);
  expect(valid.notes.trim()).toBe('Fixed worker asset reads.');
  const draft = run('1.3.0');
  expect(draft.status, draft.stderr).toBe(0);
  expect(draft.calls[1]).toContain('--draft');
  expect(draft.notes.trim()).toBe('Release v1.3.0');
  const invalid = run('1.3.189$(touch injected)');
  expect(invalid.status).toBe(1);
  expect(invalid.calls).toEqual([]);
  expect(invalid.injected).toBe(false);
});
