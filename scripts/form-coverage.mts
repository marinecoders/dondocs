import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { compileFormDefinition } from '../src/services/forms/model';
import { measurePlacements } from './form-quality';
const root = resolve('public/templates');
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
let failed = 0;
let measured = 0;
for (const row of index.templates) {
  if (row.status !== 'published' || row.renderer !== 'generic') continue;
  const directory = join(root, row.directory);
  const d = compileFormDefinition(JSON.parse(readFileSync(join(directory, 'form.json'), 'utf8')));
  const report = await measurePlacements(d, directory);
  measured++;
  console.log(JSON.stringify({ id: row.id, ...report }));
  if (report.failures.length || !report.tested) failed++;
}
console.log(`${measured} published forms measured; ${failed} failed. Placement consistency is not a substitute for review.`);
process.exitCode = failed || !measured ? 1 : 0;
