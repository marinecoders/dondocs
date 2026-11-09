import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { inspectFormGeometry } from './form-geometry-lib';
const root = resolve('public/templates');
const baseline = JSON.parse(await readFile(resolve('data/form-geometry-baseline.json'), 'utf8')) as { version: number; failures: Record<string, string> };
if (baseline.version !== 1 || !baseline.failures || typeof baseline.failures !== 'object') throw new Error('Invalid geometry baseline');
const report = await inspectFormGeometry(root);
const unexpected = Object.entries(report.failures).filter(([key, error]) => baseline.failures[key] !== error);
const stale = Object.keys(baseline.failures).filter(key => report.failures[key] !== baseline.failures[key]);
console.log(`Checked ${report.checked} published form definitions; ${Object.keys(report.failures).length} geometry failures.`);
if (unexpected.length || stale.length) {
  for (const [key, error] of unexpected) console.error(`${key}: ${error}`);
  for (const key of stale) console.error(`Remove repaired or changed baseline entry: ${key}`);
  process.exitCode = 1;
}
