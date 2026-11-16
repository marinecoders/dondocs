import { describe, expect, it } from 'vitest';
import { applyConfiguredBatchRow, configuredBatchMapping, configuredBatchSelectionPreview, mapConfiguredBatchRow } from '@/lib/configuredFormBatch';
import { fixtureInstance } from '../_helpers/formFixture';
import type { FormInstance } from '@/services/forms/model';
import type { SerializedSession } from '@/stores/documentStore';

function scalarForm(): FormInstance {
  const instance = fixtureInstance();
  instance.definition.rowGroups = {};
  for (const [id, kind] of [['date', 'date'], ['amount', 'decimal']] as const) {
    instance.definition.fields[id] = { kind, label: id };
    instance.definition.sections[0].fields.push(id);
    instance.definition.placements.push({ fieldId: id, appearance: 'text', overflow: 'error', page: 1, box: { left: 40, top: id === 'date' ? 620 : 590, width: 200, height: 18 } });
  }
  return instance;
}

describe('configured form roster mapping', () => {
  it('converts typed values without copying source answers or changing identifiers', () => {
    const form = scalarForm();
    form.answers.a = true;
    const result = mapConfiguredBatchRow(form, { name: '0000000123', decision: 'No', a: 'false', date: '2024-02-29', amount: '-12.50' });
    expect(result.issues).toEqual([]);
    expect(result.instance.answers).toEqual({ name: '0000000123', decision: 'no', a: false, date: '2024-02-29', amount: '-12.50' });
    expect(result.instance.answers.signature).toBeUndefined();
    expect(form.answers).toEqual({ name: '000123', decision: 'yes', a: true });
    result.instance.definition.label = 'Changed';
    expect(form.definition.label).toBe('Fixture form');
  });

  it('reports exact row requirements, invalid dates, decimals, choices, booleans and unknown targets', () => {
    const mapped = mapConfiguredBatchRow(scalarForm(), { date: '2026-02-29', amount: '1,234', a: 'sometimes', decision: 'maybe', unknown: 'value' });
    expect(mapped.issues.join('\n')).toMatch(/Name.*required/);
    expect(mapped.issues.join('\n')).toMatch(/date.*valid date/);
    expect(mapped.issues.join('\n')).toMatch(/amount.*decimal/);
    expect(mapped.issues.join('\n')).toContain('A: Enter yes, no, true, or false');
    expect(mapped.issues.join('\n')).toContain('Unknown roster field: unknown');
    expect(mapped.issues.join('\n')).toContain('Decision: Enter an option ID');
    expect(mapped.instance.answers.name).toBeUndefined();
  });

  it('leaves optional answers empty and never inherits another person', () => {
    const result = mapConfiguredBatchRow(scalarForm(), { name: 'Recipient B', decision: 'yes' });
    expect(result.issues).toEqual([]);
    expect(result.instance.answers).toEqual({ name: 'Recipient B', decision: 'yes' });
    expect(mapConfiguredBatchRow(scalarForm(), {}).issues.join()).toContain('Name is required');
  });

  it('supports repeated groups while rejecting populated signature answers', () => {
    expect(configuredBatchMapping(fixtureInstance()).issues).toEqual([]);
    expect(configuredBatchMapping(fixtureInstance()).fields.find(field => field.id === 'roster')?.kind).toBe('rows');
    const signed = scalarForm();signed.answers.signature = 'Someone';
    expect(configuredBatchMapping(signed).issues.join()).toContain('clear the signature');
  });

  it('requires exact IDs when option labels are ambiguous', () => {
    const form = scalarForm();
    form.definition.fields.decision.options = [{ id: 'yes', label: 'Same' }, { id: 'no', label: 'Same' }];
    expect(mapConfiguredBatchRow(form, { name: 'A', decision: 'Same' }).issues.join()).toContain('unambiguous');
    expect(mapConfiguredBatchRow(form, { name: 'A', decision: 'no' }).issues).toEqual([]);
  });

  it('creates an independent configured session and refuses invalid rows before export', () => {
    const source: SerializedSession = { documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm: scalarForm(), formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1 };
    const mapped = applyConfiguredBatchRow(source, { name: 'B', decision: 'yes' });
    expect(mapped.genericForm?.answers.name).toBe('B');
    expect(source.genericForm?.answers.name).toBe('000123');
    expect(() => applyConfiguredBatchRow(source, {})).toThrow('Name is required');
  });
});

describe('multiple-selection roster answers', () => {
  function form(required = true): FormInstance {
    const instance = scalarForm();
    instance.definition.fields.decision.kind = 'multipleChoice';
    if (!required) delete instance.definition.fields.decision.requiredAt;
    instance.answers.decision = ['yes'];
    return instance;
  }

  it('maps JSON IDs and unique labels to explicit independent selections', () => {
    const source = form();
    expect(configuredBatchMapping(source).issues).toEqual([]);
    expect(configuredBatchMapping(source).fields.find(field => field.id === 'decision')?.guidance).toContain('["yes","no"]');
    const result = mapConfiguredBatchRow(source, { name: 'B', decision: '["YES","no"]' });
    expect(result.issues).toEqual([]);
    expect(result.instance.answers.decision).toEqual(['yes', 'no']);
    expect(configuredBatchSelectionPreview(source.definition.fields.decision, '["YES","no"]')).toBe('Yes (yes); No (no)');
    (result.instance.answers.decision as string[]).push('other');
    expect(source.answers.decision).toEqual(['yes']);
  });

  it.each([
    'yes,no', '"yes"', '{}', 'null', '[true]', '[1]', '[null]', '[{}]',
    '["yes",]', '["unknown"]', '["yes","yes"]', '["yes","YES"]', '["yes","no","yes"]',
  ])('rejects invalid selections atomically: %s', raw => {
    const result = mapConfiguredBatchRow(form(), { name: 'B', decision: raw });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.instance.answers.decision).toBeUndefined();
    expect(configuredBatchSelectionPreview(form().definition.fields.decision, raw)).toBeUndefined();
  });

  it('does not split punctuation or coerce option IDs', () => {
    const source = form();
    source.definition.fields.decision.options = [{ id: 'a,b', label: 'One, two' }, { id: 'with"quote', label: 'Quoted' }];
    source.definition.placements = source.definition.placements.map(placement => placement.fieldId === 'decision'
      ? { ...placement, optionId: placement.optionId === 'yes' ? 'a,b' : 'with"quote' } : placement);
    const result = mapConfiguredBatchRow(source, { name: 'B', decision: '["a,b","with\\"quote"]' });
    expect(result.issues).toEqual([]);
    expect(result.instance.answers.decision).toEqual(['a,b', 'with"quote']);
  });

  it('rejects ambiguous labels while exact IDs take precedence over labels', () => {
    const source = form();
    source.definition.fields.decision.options = [{ id: 'yes', label: 'Same' }, { id: 'no', label: 'same' }];
    expect(mapConfiguredBatchRow(source, { name: 'B', decision: '["Same"]' }).issues.join()).toContain('unambiguous');
    source.definition.fields.decision.options = [{ id: 'yes', label: 'no' }, { id: 'no', label: 'yes' }];
    expect(mapConfiguredBatchRow(source, { name: 'B', decision: '["yes"]' }).instance.answers.decision).toEqual(['yes']);
  });

  it.each(['', '[]'])('requires a selection for export-required fields: %j', raw => {
    expect(mapConfiguredBatchRow(form(), { name: 'B', decision: raw }).issues.join()).toContain('Decision is required');
  });

  it('keeps blank and explicit empty optional selections separate from saved source answers', () => {
    const source = form(false);
    const blank = mapConfiguredBatchRow(source, { name: 'B', decision: '  ' });
    expect(blank.issues).toEqual([]);
    expect(blank.instance.answers.decision).toBeUndefined();
    const empty = mapConfiguredBatchRow(source, { name: 'B', decision: '[]' });
    expect(empty.issues).toEqual([]);
    expect(empty.instance.answers.decision).toEqual([]);
    expect(configuredBatchSelectionPreview(source.definition.fields.decision, '[]')).toBe('None');
    expect(source.answers.decision).toEqual(['yes']);
  });
});

describe('retained configured batch validation', () => {
  it.each(['rows', 'answers', 'answerRevision'] as const)('rejects a recovered source missing %s without throwing from mapping', async missing => {
    const { recoverBatch } = await import('@/stores/batchStore');
    const genericForm = Object.fromEntries(Object.entries(scalarForm()).filter(([key]) => key !== missing));
    const recovered = recoverBatch(JSON.parse(JSON.stringify({ source: {
      documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm,
      formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1,
    } })));
    const mapping = configuredBatchMapping(recovered.source!.genericForm!);
    expect(mapping.fields).toEqual([]);
    expect(mapping.issues.join()).toContain('incomplete or invalid');
    expect(() => applyConfiguredBatchRow(recovered.source!, { name: 'Recipient B', decision: 'yes' })).toThrow('incomplete or invalid');
  });

  it.each([
    { answers: null }, { answers: [] }, { rows: null }, { rows: [] }, { answerRevision: -1 },
  ])('rejects malformed saved instance containers without changing the form definition (%j)', replacement => {
    const form = scalarForm();
    const definition = structuredClone(form.definition);
    const malformed = JSON.parse(JSON.stringify({ ...form, ...replacement }));
    expect(configuredBatchMapping(malformed)).toMatchObject({ fields: [], issues: [expect.stringContaining('incomplete or invalid')] });
    expect(form.definition).toEqual(definition);
  });

  it('keeps complete legacy configured jobs available for mapping and independent row answers', async () => {
    const { recoverBatch } = await import('@/stores/batchStore');
    const recovered = recoverBatch(JSON.parse(JSON.stringify({ source: {
      documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm: scalarForm(),
      formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1,
    } })));
    expect(configuredBatchMapping(recovered.source!.genericForm!).issues).toEqual([]);
    expect(applyConfiguredBatchRow(recovered.source!, { name: 'Recipient B', decision: 'no' }).genericForm?.answers)
      .toEqual({ name: 'Recipient B', decision: 'no' });
    expect(recovered.source!.genericForm!.answers.name).toBe('000123');
  });
});

it('allows structurally valid source answers to be incomplete because each roster row supplies its own answers', () => {
  const form = scalarForm();
  form.answers = {};
  expect(configuredBatchMapping(form).issues).toEqual([]);
  const mapped = mapConfiguredBatchRow(form, { name: 'Recipient B', decision: 'yes' });
  expect(mapped.issues).toEqual([]);
  expect(mapped.instance.answers).toEqual({ name: 'Recipient B', decision: 'yes' });
  expect(form.answers).toEqual({});
});
