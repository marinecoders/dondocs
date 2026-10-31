/** Reproduce the final section comparison with synthetic equipment and artwork. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { companionSl3 } from '../../../../tests/_helpers/companionSl3.ts';
import { sl3Fixture } from '../../../../tests/_helpers/sl3Fixture.ts';
import { validateLetter } from '../../../../companion/validateLetter.ts';
import { renderToFile } from '../../../../companion/renderToFile.ts';

const root = resolve(process.argv[2] ?? '/tmp/dondocs-sl3-final-review');
await mkdir(root, { recursive: true });
const art = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="white"/><rect x="200" y="180" width="800" height="240" rx="30" fill="none" stroke="black" stroke-width="8"/><path d="M400 180V420M800 180V420" stroke="black" stroke-width="8"/></svg>';
const png = await sharp(Buffer.from(art)).png().toBuffer();
const cases = [];
for (const orientation of ['portrait', 'landscape'] as const) {
  const input = companionSl3();
  input.out = `complete-${orientation}.pdf`;
  const data = sl3Fixture(26).formData.sl3!;
  input.publication!.sl3 = data;
  input.publication!.endItems![0].tamcn = 'B2565';
  data.orientation = orientation;
  data.rowsPerSheet = 8;
  data.technicalData = 'Synthetic training kit. Weight: 5 pounds. The ZED indicator is used for training only. Verify actual equipment characteristics against the source technical manual.';
  data.configurationReference = 'Synthetic TFSMS comparison record, 30 October 2026';
  data.showModel = true;
  data.showFigureReference = true;
  data.fieldingPlanReference = 'Synthetic Fielding Plan, 30 October 2026';
  data.notes = [{ id: 'note-19', text: 'Inventory the parent assembly and its components together.', portionMarking: 'U' }];
  data.definitions = [{ id: 'zed', term: 'ZED', meaning: 'Synthetic training indicator', portionMarking: 'U' }];
  for (const [i, item] of data.components.entries()) {
    item.category = i < 18 ? 'ssri' : i < 22 ? 'collateral' : 'uuri';
    item.description = 'removable training assembly';
    item.partNumber = `TRAINING-${String(i + 1).padStart(3, '0')}`;
    item.cage = 'TEST1';
    item.model = 'T1';
    item.figureReference = 'A1';
  }
  Object.assign(data.components[0], { tamcn: 'B2483', primaryTamcn: 'B2565', configurationRatio: '1:1', serialized: true });
  data.components[15].parentId = data.components[14].id;
  data.components[16].parentId = data.components[15].id;
  data.components[14].noteIds = ['note-19'];
  const end = 'A'.repeat(32), component = 'B'.repeat(32);
  data.endItemFigureId = end;
  data.components[0].figureId = component;
  input.paragraphs = [
    { referenceId: end, text: 'Tool Kit, Training', figure: { fileId: 'drawing' } },
    { referenceId: component, text: 'Training Adapter', figure: { fileId: 'drawing' } },
  ];
  data.artwork = [end, component].map((figureId) => ({
    figureId, lettering: 'labels', labels: [{ id: `${figureId}-label`, text: 'TRAINING ASSEMBLY', x: 50, y: 15 }],
  }));
  input.attachments = [{ id: 'drawing', name: 'synthetic-training.png', mimeType: 'image/png', dataBase64: png.toString('base64') }];
  const errors = validateLetter(input);
  if (errors.length) throw new Error(errors.join('\n'));
  const rendered = await renderToFile(input, {}, root);
  cases.push({ orientation, input, output: rendered.path });
}
await writeFile(join(root, 'complete-inputs.json'), JSON.stringify(cases, null, 2) + '\n');
console.log(JSON.stringify({ root, outputs: cases.map(({ output }) => output) }));
