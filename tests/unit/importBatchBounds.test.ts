// @vitest-environment node
import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('validates manifest identities before protected-folder lookups or skips', () => {
  const root = mkdtempSync(join(tmpdir(), 'dondocs-import-bounds-'));
  try {
    for (const directory of ['scripts', 'docs', 'cache', 'bin', 'public/templates/safe', 'public/outside']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    copyFileSync('scripts/import-batch.sh', join(root, 'scripts/import-batch.sh'));
    writeFileSync(join(root, 'public/templates/index.json'), JSON.stringify({ templates: [{ directory: 'safe', builtin: true }] }));
    writeFileSync(join(root, 'public/outside/boxes.json'), '{}');
    writeFileSync(join(root, 'public/templates/boxes.json'), '{}');
    writeFileSync(join(root, 'bin/curl'), '#!/bin/sh\necho "Unexpected network request in validation test" >&2\nexit 99\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` };
    const generated = execFileSync('python3', ['-c', "import runpy; print(runpy.run_path('scripts/form-names.py')['folder_name']('NAVMC 10274', 'ADMINISTRATIVE ACTION'))"], { encoding: 'utf8' }).trim();
    mkdirSync(join(root, 'public/templates', generated));
    writeFileSync(join(root, 'public/templates', generated, 'boxes.json'), '{}');
    const manifest = join(root, 'manifest.tsv');
    for (const [row, message] of [
      ['invalid/id\tsafe\n', '[fail-id]'],
      ['.\tsafe\n', '[fail-id]'],
      ['valid\t../outside\n', '[fail-dir]'],
      ['valid\t.\n', '[fail-dir]'],
      ['valid\t..\\outside\n', '[fail-dir]'],
      ['valid\tbad\u0001name\n', '[fail-dir]'],
    ]) {
      writeFileSync(manifest, row);
      const result = spawnSync('bash', [join(root, 'scripts/import-batch.sh'), manifest, join(root, 'cache')], { encoding: 'utf8', timeout: 5_000, env });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(message);
      expect(result.stdout).not.toContain('[protected]');
    }
    writeFileSync(manifest, 'valid\tsafe\n');
    const output = execFileSync('bash', [join(root, 'scripts/import-batch.sh'), manifest, join(root, 'cache')], { encoding: 'utf8', timeout: 5_000, env });
    expect(output).toContain('[protected]');
    expect(output).toContain('failed=0');
    writeFileSync(manifest, `valid\t${generated}\n`);
    const namedOutput = execFileSync('bash', [join(root, 'scripts/import-batch.sh'), manifest, join(root, 'cache')], { encoding: 'utf8', timeout: 5_000, env });
    expect(namedOutput).toContain(`[protected] ${generated}`);
    expect(namedOutput).toContain('failed=0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
