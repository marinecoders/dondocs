// @vitest-environment node
import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('validates manifest identities before protected-folder lookups or skips', () => {
  const root = mkdtempSync(join(tmpdir(), 'dondocs-import-bounds-'));
  try {
    for (const directory of ['scripts', 'docs', 'cache', 'public/templates/safe', 'public/outside']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    copyFileSync('scripts/import-batch.sh', join(root, 'scripts/import-batch.sh'));
    writeFileSync(join(root, 'public/templates/index.json'), JSON.stringify({ templates: [{ directory: 'safe', builtin: true }] }));
    writeFileSync(join(root, 'public/outside/boxes.json'), '{}');
    const manifest = join(root, 'manifest.tsv');
    for (const [row, message] of [
      ['invalid/id\tsafe\n', '[fail-id]'],
      ['valid\t../outside\n', '[fail-dir]'],
    ]) {
      writeFileSync(manifest, row);
      const result = spawnSync('bash', [join(root, 'scripts/import-batch.sh'), manifest, join(root, 'cache')], { encoding: 'utf8', timeout: 5_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(message);
      expect(result.stdout).not.toContain('[protected]');
    }
    writeFileSync(manifest, 'valid\tsafe\n');
    const output = execFileSync('bash', [join(root, 'scripts/import-batch.sh'), manifest, join(root, 'cache')], { encoding: 'utf8', timeout: 5_000 });
    expect(output).toContain('[protected]');
    expect(output).toContain('failed=0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
