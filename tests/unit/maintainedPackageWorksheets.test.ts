import { expect, it } from 'vitest';
import { renderForm } from '@/services/forms/render';
import { evidenceSubmissionWorksheet, trainingActivityWorksheet, trainingCostWorksheet, trainingParticipationWorksheet } from '@/lib/maintainedPackageWorksheets';

it('pins deterministic clean worksheet pages and renders all maintained variants through the existing form renderer', async () => {
  const pages = [await trainingParticipationWorksheet('remote'), await trainingParticipationWorksheet('in-person'),
    await trainingCostWorksheet(), await evidenceSubmissionWorksheet(), await trainingActivityWorksheet()];
  for (const { definition, bytes } of pages) {
    const answers = Object.fromEntries(Object.entries(definition.fields).map(([id, field]) => [id,
      field.kind === 'date' ? '2026-11-17' : field.kind === 'decimal' ? '125.50' : field.kind === 'identifier' ? '000042'
        : field.kind === 'singleChoice' ? field.options![0].id : 'Fictional training example']));
    const rendered = await renderForm({ definition, answers, rows: {}, answerRevision: 0 }, 'export', async () => new Uint8Array(bytes));
    expect(rendered.diagnostics).toEqual([]); expect(rendered.bytes.byteLength).toBeGreaterThan(1000);
    expect(JSON.stringify(definition)).not.toContain('Fictional training example');
  }
  expect((await trainingParticipationWorksheet('remote')).definition).toEqual(pages[0].definition);
});
