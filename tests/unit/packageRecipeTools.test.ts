import { expect, it } from 'vitest';
import { NAVY_RANKS, USMC_RANKS } from '@/data/ranks';
import { enlistedGradeRange } from '@/lib/packageRankConditions';
import { writtenCorrespondence, program, question } from '@/lib/packageRecipeMembers';
import { evaluatePackageTemplateCondition } from '@/lib/packageTemplateProgram';

it('evaluates free-text pay grades against the service and question a recipe declares', () => {
  function matches(id: string, service: typeof USMC_RANKS, value?: string, min = 1, max = 9) {
    return evaluatePackageTemplateCondition(program([question(id, 'Rank')]), {
      version: 1, groups: {}, values: value ? { [id]: value } : {},
    }, enlistedGradeRange(id, service, min, max));
  }
  expect(matches('marine', USMC_RANKS, '  cpl/e4 ', 1, 4)).toBe(true);
  expect(matches('marine', USMC_RANKS, 'Cpl/E5')).toBe(false);
  expect(matches('marine', USMC_RANKS, 'SgtMajMarCor', 5, 9)).toBe(true);
  expect(matches('sailor', NAVY_RANKS, 'MCPON E-9')).toBe(true);
  expect(matches('sailor', NAVY_RANKS, 'Corporal')).toBe(false);
  expect(matches('sailor', NAVY_RANKS)).toBe(false);
});

it('creates editable letters and linked endorsements that require written content', async () => {
  const basic = await writtenCorrespondence({ key: 'request', label: 'Transfer request' });
  expect(basic).toMatchObject({ role: 'supporting-document', completion: { writtenContent: true },
    draft: { docType: 'naval_letter', formData: { subject: 'TRANSFER REQUEST' } } });
  for (const docType of ['same_page_endorsement', 'new_page_endorsement']) {
    const endorsement = await writtenCorrespondence({ key: 'forward', label: 'Forwarding endorsement', docType, endorses: basic.key });
    expect(endorsement).toMatchObject({ role: 'endorsement', endorses: 'request', completion: { writtenContent: true } });
  }
});
