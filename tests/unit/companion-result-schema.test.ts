/**
 * The published result contract.
 *
 * Each tool's `outputSchema` must accept what the tool actually returns, and
 * a unit match must be usable, unchanged, as the `unit` of a letter request.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LETTER_TEMPLATES } from '../../src/data/templates';
import { lookupUnits } from '../../companion/unitLookup';
import { letterSchema } from '../../companion/letterSchema';
import { renderResult, templateListResult, templateResult, unitLookupResult } from '../../companion/resultSchema';

describe('the published result schemas', () => {
  it('accept every bundled template, in full and as a summary', () => {
    for (const template of LETTER_TEMPLATES) {
      expect(templateResult.safeParse(template).success, template.id).toBe(true);
    }
    const summaries = LETTER_TEMPLATES.map(({ id, name, category, description }) => ({ id, name, category, description }));
    expect(templateListResult.safeParse({ templates: summaries }).success).toBe(true);
  });

  it('accept a unit lookup result, whose matches are letter-ready units', async () => {
    const result = await lookupUnits('marine innovation unit');
    expect(result.total).toBeGreaterThan(1);
    expect(unitLookupResult.safeParse(result).success).toBe(true);
    for (const match of result.matches) {
      const request = { docType: 'naval_letter', subject: 'S', paragraphs: [{ text: 'x' }], unit: match.unit };
      expect(letterSchema.safeParse(request).success, match.unit.name).toBe(true);
    }
  });

  it('carry a DOD directory entry with its department, so the letterhead heading follows', async () => {
    const result = await lookupUnits('DEFENSE INFORMATION SCHOOL');
    expect(result.matches[0].unit.department).toBe('dod');
    expect(unitLookupResult.safeParse(result).success).toBe(true);
  });

  it('accept a render result and refuse a format the renderer cannot produce', () => {
    expect(renderResult.safeParse({ format: 'pdf', path: '/out/letter.pdf', bytes: 12_345 }).success).toBe(true);
    expect(renderResult.safeParse({ format: 'docx', path: '/out/letter.docx', bytes: 0 }).success).toBe(true);
    expect(renderResult.safeParse({ format: 'odt', path: '/out/letter.odt', bytes: 1 }).success).toBe(false);
  });
});
