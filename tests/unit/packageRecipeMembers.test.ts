import { expect, it } from 'vitest';
import { correspondenceMember, writtenCorrespondence, documentSource, documentSourceCondition, equals, program, question } from '@/lib/packageRecipeMembers';
import { evaluatePackageTemplateCondition } from '@/lib/packageTemplateProgram';

it('selects drafting or an incoming original only when the document is applicable', async () => {
  const active = equals('forward', true);
  const intake = program([question('forward', 'Forward?', 'boolean'), documentSource('letter', 'Letter source', active)]);
  const draft = documentSourceCondition(active, 'letter', 'draft');
  const original = documentSourceCondition(active, 'letter', 'original');
  for (const [forward, choice, expected] of [
    [false, 'original', [false, false]], [true, undefined, [true, false]],
    [true, 'draft', [true, false]], [true, 'original', [false, true]],
  ] as const) {
    const answers = { version: 1 as const, values: { forward, ...(choice && { letter: choice }) }, groups: {} };
    expect([draft, original].map(rule => evaluatePackageTemplateCondition(intake, answers, rule))).toEqual(expected);
  }
  const member = await correspondenceMember({ key: 'letter', label: 'Forwarding document', role: 'endorsement', docType: 'new_page_endorsement', when: draft });
  expect(member).toMatchObject({ key: 'letter', role: 'endorsement', when: draft, draft: { docType: 'new_page_endorsement' } });
});

it('creates correspondence with the editor defaults for its type and rejects unknown types', async () => {
  const options = { key: 'order', label: 'Order', role: 'supporting-document' } as const;
  const member = await correspondenceMember({ ...options, docType: 'marine_corps_order' });
  expect(member.draft).toMatchObject({ timestamp: 0, formData: { fontFamily: 'courier', docType: 'marine_corps_order' } });
  await expect(correspondenceMember({ ...options, docType: 'missing-type' })).rejects.toThrow('correspondence type');
  const linked = await correspondenceMember({ ...options, docType: 'naval_letter', facts: { unitLine1: 'organization' } });
  expect(linked.links?.[0].target).toMatchObject({ field: 'unitLine1', docType: 'naval_letter' });
});

it('can require an authority signature on a written package letter', async () => {
  const options = { key: 'letter', label: 'Authorization' };
  expect((await writtenCorrespondence(options)).completion).toEqual({ writtenContent: true });
  expect((await writtenCorrespondence({ ...options, requireAuthoritySignature: true })).completion).toEqual({
    writtenContent: true, expectedForm: { id: 'package_correspondence', edition: '1' }, signatureFields: ['Signing_authority'],
  });
});
