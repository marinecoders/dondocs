import { performance } from 'node:perf_hooks';
import { PDFDocument } from 'pdf-lib';
import { renderForm } from '../src/services/forms/render';
import { compileFormDefinition } from '../src/services/forms/model';
const pdf = await PDFDocument.create();
pdf.addPage([612, 792]);
const bytes = await pdf.save();
for (const count of [50, 250, 1000]) {
  const fields = Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, { kind: 'identifier', label: `Field ${i}` }]));
  const definition = compileFormDefinition({
    schemaVersion: 2, formId: 'benchmark', label: 'Synthetic render benchmark', directory: 'benchmark', definitionRevision: '1', templateRevision: '1',
    pages: Array.from({ length: Math.ceil(count / 50) }, (_, i) => ({ file: `page${i + 1}.pdf`, width: 612, height: 792 })),
    fields, placements: Object.keys(fields).map((fieldId, i) => ({ fieldId, appearance: 'text', page: Math.floor(i / 50) + 1, box: { left: 40, top: 760 - i % 50 * 14, width: 180, height: 12 } })),
    rowGroups: {}, sections: [{ id: 'all', title: 'Fields', fields: Object.keys(fields) }],
  });
  const instance = { definition, answers: Object.fromEntries(Object.keys(fields).map(key => [key, '000042'])), rows: {}, answerRevision: 0 };
  await renderForm(instance, 'export', async () => bytes);
  const samples: number[] = [];
  let outputSize = 0;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = await renderForm(instance, 'export', async () => bytes);
    samples.push(performance.now() - start);
    outputSize = result.bytes.length;
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ placements: count, pages: definition.pages.length, medianMs: +samples[2].toFixed(1), outputBytes: outputSize }));
}
