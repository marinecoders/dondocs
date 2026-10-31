/** Reproduce synthetic SL-3 audit exports; never uses real equipment data. */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionSl3 } from '../../../tests/_helpers/companionSl3.ts';
import { sl3Fixture } from '../../../tests/_helpers/sl3Fixture.ts';
import { SL3_PREFACE } from '../../../src/data/techpub/sl3Preface.ts';
import { validateLetter } from '../../../companion/validateLetter.ts';
import { renderToFile } from '../../../companion/renderToFile.ts';

const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-checklist-'));
const inputs = [];
const results = [];
const cases = [
  'portrait', 'landscape', 'continuation', 'controlled', 'raster-text',
  'restricted-unclassified', 'export-controlled',
];
for (const name of cases) {
  const input = companionSl3();
  input.out = `${name}.pdf`;
  if (name === 'landscape') input.publication!.sl3!.orientation = 'landscape';
  if (name === 'continuation')
    input.publication!.sl3 = sl3Fixture(20).formData.sl3!;
  if (name === 'controlled' || name === 'export-controlled') {
    input.classification = {
      level: 'cui',
      cui: {
        controlledBy: 'EXAMPLE COMMAND',
        category: name === 'export-controlled' ? 'CTI/EXPT' : 'CTI',
        dissemination: 'NOFORN',
      },
    };
    input.publication!.distribution = {
      statement: 'D',
      reason: name === 'export-controlled'
        ? 'Export Controlled' : 'Software Documentation',
      date: '2026-10-30',
    };
    input.publication!.sl3!.technicalPortion = 'CUI';
    if (name === 'export-controlled') input.publication!.exportRestricted = true;
  }
  if (name === 'restricted-unclassified') {
    input.publication!.distribution = {
      statement: 'B', reason: 'Software Documentation', date: '2026-10-30',
    };
  }
  if (name === 'raster-text') {
    const id = 'B'.repeat(32);
    input.paragraphs = [{
      text: 'Audit Component Drawing', referenceId: id,
      figure: { fileId: 'audit-drawing' },
    }];
    input.publication!.sl3!.components![0].figureId = id;
    input.attachments = [{
      id: 'audit-drawing', name: 'labelled-illustration.png',
      mimeType: 'image/png',
      dataBase64: (await readFile(
        new URL('./labelled-illustration.png', import.meta.url),
      )).toString('base64'),
    }];
  }
  inputs.push({ name, input });
  const errors = validateLetter(input);
  results.push({ name, errors });
  if (!errors.length) await renderToFile(input, {}, root);
}
await writeFile(join(root, 'fixture-validation.json'), JSON.stringify(results, null, 2));
await writeFile(join(root, 'preface.json'), JSON.stringify(SL3_PREFACE, null, 2));
await writeFile(join(root, 'inputs.json'), JSON.stringify(inputs, null, 2));
console.log(JSON.stringify({ outputDirectory: root, results }, null, 2));
