import { readFile, writeFile } from 'node:fs/promises';
import { DOC_TYPE_CONFIG, FORM_TYPE_LABELS } from '../src/types/document';
import { LETTER_TEMPLATES } from '../src/data/templates';
import { ALL_DOC_TYPES, pairwiseMatrix, smokeMatrix, CARTESIAN_PER_DOCTYPE, CARTESIAN_TOTAL } from '../tests/_helpers/compileMatrix';

const root = new URL('../', import.meta.url);
const data = async (file: string, key: string): Promise<number> => {
  const value = JSON.parse(await readFile(new URL(`src/data/${file}`, root), 'utf8'));
  return value[key].length;
};
const n = (value: number) => value.toLocaleString('en-US');
const omitted = Object.keys(DOC_TYPE_CONFIG).filter(type => !(ALL_DOC_TYPES as readonly string[]).includes(type));
const lines = [
  '# Project inventory', '',
  'Generated with `npm run docs:inventory` from registries, bundled datasets and fixture builders. CI checks for drift. Counts describe this checkout, not regulatory qualification or executed test results.', '',
  '| Registry | Entries |', '|---|---:|',
  `| Configured formats (including aliases exposed by the app) | ${Object.keys(DOC_TYPE_CONFIG).length} |`,
  `| Built-in forms | ${Object.keys(FORM_TYPE_LABELS).length} |`,
  `| Content templates | ${LETTER_TEMPLATES.length} |`,
  `| References | ${n(await data('references.json', 'references'))} |`,
  `| Units | ${n(await data('units.json', 'units'))} |`,
  `| Office codes | ${n(await data('office-codes.json', 'codes'))} |`,
  `| SSIC codes | ${n(await data('ssic.json', 'codes'))} |`, '',
  '## Content templates', '',
  '| ID | Name | Format |', '|---|---|---|',
  ...LETTER_TEMPLATES.map(t => `| \`${t.id}\` | ${t.name} | \`${t.docType}\` |`), '',
  '## Compile fixture builders', '',
  '| Quantity | Count |', '|---|---:|',
  `| Matrix format entries | ${ALL_DOC_TYPES.length} |`,
  `| Pairwise fixtures per output path | ${n(pairwiseMatrix().length)} |`,
  `| Smoke fixtures | ${n(smokeMatrix().length)} |`,
  `| Cartesian fixtures per matrix format | ${n(CARTESIAN_PER_DOCTYPE)} |`,
  `| Full Cartesian fixtures per output path | ${n(CARTESIAN_TOTAL)} |`, '',
  `Matrix-excluded configured formats: ${omitted.map(type => `\`${type}\``).join(', ')}. These have dedicated tests; exclusion is not a claim that they are unsupported. Built-in/configured forms also have separate tests. The generic matrix is not the entire integration suite.`, '',
  'See [integration tests](../tests/integration/README.md), [Cartesian harness](../tests/cartesian/README.md) and [output capabilities](CAPABILITIES.md).', '',
];
const content = lines.join('\n');
const output = new URL('docs/PROJECT_INVENTORY.md', root);
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== content) throw new Error('Project inventory is stale. Run npm run docs:inventory.');
  console.log('Project inventory matches registries and fixture builders.');
} else {
  await writeFile(output, content);
  console.log('Wrote docs/PROJECT_INVENTORY.md.');
}
