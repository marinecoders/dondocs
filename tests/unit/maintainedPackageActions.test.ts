import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { maintainedPackageAction, maintainedPackageActions } from '@/lib/maintainedPackageActions';
import { listActionPackages } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';

afterEach(() => vi.unstubAllGlobals());

it('qualifies clean maintained actions without installing case records or assets', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(await readFile('public' + new URL(url, 'https://test.invalid').pathname))));
  const records = await listActionPackages(), assets = await idbGetAllAttachments();
  const templates = await Promise.all(maintainedPackageActions.map(action => maintainedPackageAction(action.id)));
  expect(templates).toHaveLength(maintainedPackageActions.length);
  for (const template of templates) {
    expect(template.version).toBe(2); expect(template.program.questions.length).toBeGreaterThan(0);
    expect(JSON.stringify(template)).not.toContain('{{');
    for (const member of template.members) if (member.kind === 'native') {
      expect(member.links?.length).toBeGreaterThan(0);
      expect(member.draft.timestamp).toBe(0);
      const form = member.draft.formData as Record<string, unknown>;
      expect(form.sigLast ?? '').toBe('');
    }
  }
  const training = templates.find(template => template.id === 'dondocs_training_participation')!;
  expect(training.program.participantGroups).toEqual([{ id: 'participants', label: 'Participants', role: 'subject', min: 1, max: 10 }]);
  expect(training.members.find(member => member.key === 'remote-participant')?.when).toEqual({ op: 'equals', questionId: 'attendance', value: 'remote' });
  expect(training.members.find(member => member.key === 'cost-estimate')?.when).toEqual({ op: 'equals', questionId: 'includeEstimate', value: true });
  expect(await listActionPackages()).toEqual(records); expect(await idbGetAllAttachments()).toEqual(assets);
});

it('returns owned starters so one caller cannot change later actions', async () => {
  const first = await maintainedPackageAction('administrative-request');
  first.program.questions[0].label = 'Caller mutation'; first.name = 'Changed locally';
  const second = await maintainedPackageAction('administrative-request');
  expect(second.name).toBe('Administrative request'); expect(second.program.questions[0].label).toBe('Requester');
});
