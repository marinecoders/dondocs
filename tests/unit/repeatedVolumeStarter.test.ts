import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { capturePackageTemplate } from '@/lib/packageTemplateLibrary';
import { prepareConditionalPackage, copyPreparedConditionalPackageRecord } from '@/lib/packageConditional';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { volumeOutline, publicationVolumeErrors, resolveVolumeReferences } from '@/lib/publicationVolume';
import { volumeFixture } from '../_helpers/volumeFixture';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

it('gives each repeated volume independent target identities while preserving its internal references and source', async () => {
  const source = { ...createBlankSession(), ...volumeFixture(), timestamp: 100 };
  const before = structuredClone(source);
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 0, capturedAt: 100 }, source), 'Synthetic volume', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage('Source'), [member]);
  const starter = await capturePackageTemplate(record, record.currentRevisionId, 'Repeated volume starter');
  const main = starter.members[0];
  const template: PackageTemplateV2 = { ...starter, version: 2,
    program: { revision: '1', questions: [], participantGroups: [{ id: 'people', label: 'Synthetic participants', role: 'subject', min: 0, max: 2 }], requirements: [] },
    members: [{ ...main, key: 'main' }, { ...structuredClone(main), key: 'person-volume', role: 'supporting-document', repeatGroupId: 'people' }],
  };
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  const count = (await listActionPackages()).length;
  const plan = await prepareConditionalPackage({ template, answers: { version: 1, values: {}, groups: { people: [{ id: 'alex', label: 'Alex', answers: {} }, { id: 'blair', label: 'Blair', answers: {} }] } } }, policy);
  expect(plan.ready, JSON.stringify(plan.issues)).toBe(true);
  const copies = getPackageRevision(copyPreparedConditionalPackageRecord(plan).record).members;
  expect(copies).toHaveLength(3);
  const identities = new Set<string>();
  for (const copy of copies) {
    if (copy.kind !== 'native') throw new Error('Expected a native volume');
    expect(publicationVolumeErrors(copy.session.formData.volume, copy.session.paragraphs)).toEqual([]);
    expect(resolveVolumeReferences(copy.session.paragraphs[0].text, copy.session.formData.volume!, copy.session.paragraphs)).toContain('2.1.1');
    for (const id of [...volumeOutline(copy.session.formData.volume!).map(node => node.id), ...copy.session.paragraphs.map(block => block.id!)]) {
      expect(identities.has(id)).toBe(false);
      identities.add(id);
    }
  }
  expect(await listActionPackages()).toHaveLength(count);
  expect(source).toEqual(before);
});
