import { expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureChangeReport, prepareChangeReport, renderChangeReport } from '@/lib/changeReport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { fixtureInstance } from '../_helpers/formFixture';

it('retains changes in distinct configured row groups that share a display title', () => {
  const before = createBlankSession();
  before.documentCategory = 'forms';
  before.genericForm = fixtureInstance();
  before.formType = before.genericForm.definition.formId;
  before.genericForm.definition.rowGroups.second = structuredClone(before.genericForm.definition.rowGroups.roster);
  before.genericForm.rows = {
    roster: [{ id: 'first-row', answers: { grade: 'e1', date: 'FIRST_GROUP_OLD' } }],
    second: [{ id: 'second-row', answers: { grade: 'e2', date: 'SECOND_GROUP_UNCHANGED' } }],
  };
  const after = structuredClone(before);
  after.genericForm!.rows.roster[0].answers.date = 'FIRST_GROUP_NEW';
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const report = prepareChangeReport(captureChangeReport(
    { label: 'Saved', title: 'Before', session: before },
    { label: 'Current', title: 'After', session: after },
    '2026-11-13T12:00:00.000Z',
  ), policy);
  const html = renderChangeReport(report);
  expect(html).toContain('FIRST_GROUP_OLD');
  expect(html).toContain('FIRST_GROUP_NEW');
});
