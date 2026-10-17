import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { compileFormDefinition, type FormDefinition, type FormInstance } from '@/services/forms/model';

export const fixtureDefinition = (): FormDefinition => compileFormDefinition({
  schemaVersion: 2, formId: 'fixture', label: 'Fixture form', definitionRevision: 'v1', templateRevision: 'p1', directory: 'fixture',
  pages: [{ file: 'page1.pdf', width: 612, height: 792 }],
  fields: {
    name: { kind: 'identifier', label: 'Name', requiredAt: 'export' },
    decision: { kind: 'singleChoice', label: 'Decision', requiredAt: 'export', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
    a: { kind: 'boolean', label: 'A' }, b: { kind: 'boolean', label: 'B' }, c: { kind: 'boolean', label: 'C' },
    signature: { kind: 'signature', label: 'Signature', requiredAt: 'sign' },
  },
  placements: [
    { fieldId: 'name', appearance: 'text', page: 1, box: { left: 40, top: 740, width: 200, height: 18 } },
    { fieldId: 'name', appearance: 'text', page: 1, box: { left: 40, top: 710, width: 200, height: 18 } },
    { fieldId: 'decision', optionId: 'yes', appearance: 'mark', page: 1, box: { left: 40, top: 680, width: 12, height: 12 } },
    { fieldId: 'decision', optionId: 'no', appearance: 'mark', page: 1, box: { left: 80, top: 680, width: 12, height: 12 } },
    ...['a', 'b', 'c'].map((fieldId, i) => ({ fieldId, appearance: 'mark', page: 1, box: { left: 120 + i * 40, top: 680, width: 12, height: 12 } })),
  ],
  sections: [{ id: 'identity', title: 'Identity', fields: ['name', 'signature'] }, { id: 'decision', title: 'Checks', fields: ['a', 'b', 'c', 'decision'], editor: 'checklist' }],
  rowGroups: { roster: { title: 'Roster', columns: { grade: { kind: 'singleChoice', label: 'Grade', requiredAt: 'export', options: [{ id: 'e1', label: 'E-1' }, { id: 'e2', label: 'E-2' }] }, date: { kind: 'date', label: 'Date' } }, rows: [600, 570, 529].map(top => [
    { fieldId: 'grade', appearance: 'text', page: 1, box: { left: 40, top, width: 100, height: 18 } },
    { fieldId: 'date', appearance: 'text', page: 1, box: { left: 160, top, width: 100, height: 18 } },
  ]) } },
});
export const fixtureInstance = (): FormInstance => ({ definition: fixtureDefinition(), answers: { name: '000123', decision: 'yes' }, rows: {}, answerRevision: 0 });
export async function fixturePage() {
  const doc = await PDFDocument.create(); doc.addPage([612, 792]);
  const bytes = await doc.save();
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
