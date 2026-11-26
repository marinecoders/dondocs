import { expect, it } from 'vitest';
import { groupIntakeReviewBlockers, packageQuestionFindings } from '@/lib/packageQuestionFindings';
import type { PackageRevision } from '@/lib/actionPackages';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';

it('shares a correction for one decision and preserves an independent decision', () => {
  const members = ['orders', 'receipt', 'approval'].map((key, index) => ({ key, when: { op: 'equals', questionId: index === 2 ? 'approved' : 'travel', value: true } }));
  const template = { members, program: { questions: ['travel', 'approved'].map(id => ({ id, label: id, kind: 'boolean', required: true })), participantGroups: [], requirements: [] } } as unknown as PackageTemplateV2;
  const revision = { templateState: { answers: { version: 1, values: {}, groups: {} }, instances: members.map(m => ({ memberId: m.key, memberKey: m.key, condition: 'unknown' })) } } as PackageRevision;
  const targets = packageQuestionFindings(template, revision);
  expect(targets.get('orders')).toEqual(targets.get('receipt'));
  expect(targets.get('orders')?.label).toBe('travel');
  expect(targets.get('approval')?.label).toBe('approved');
});

it('lists one exact question with all affected documents and preserves independent failures', () => {
  const instances = ['first', 'second', 'third'].map(memberId => ({ key: memberId, memberId, label: memberId }));
  const revision = { templateState: { instances }, documentNames: { second: 'Second copy' } } as unknown as PackageRevision;
  const target = { key: 'question-a', label: 'Travel approved?' };
  const findings = instances.map(slot => ({ memberId: slot.memberId, message: 'Resolve ' + slot.label }));
  const groups = groupIntakeReviewBlockers(revision, new Map([['first', target], ['second', target]]), findings);
  expect(groups).toEqual([{ label: target.label, questionKey: target.key, documents: ['first', 'Second copy'] },
    { label: 'Resolve third', slotKey: 'third', documents: [] }]);
});
