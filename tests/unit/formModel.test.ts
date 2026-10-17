import { describe, it, expect } from 'vitest';
import { adaptLegacyForm, compileFormDefinition, diagnosticText, formErrorSections, migrateLegacyAnswers, parseFormInstance, validateAnswers } from '@/services/forms/model';
import { fixtureDefinition, fixtureInstance } from '../_helpers/formFixture';

describe('form contract', () => {
  it('keeps a negative answer distinct from an unanswered question', () => {
    const d = fixtureDefinition(); d.fields.a.requiredAt = 'export';
    expect(validateAnswers(d, { name: '000123', decision: 'no', a: false }, {})).toEqual([]);
    expect(validateAnswers(d, { name: '000123', decision: 'no' }, {}).map(i => i.path)).toEqual(['a']);
  });
  it('rejects malformed geometry, references, options and unsupported behavior', () => {
    for (const change of [
      (d: ReturnType<typeof fixtureDefinition>) => { d.placements[0].page = 1.5; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.placements[0].box.width = -1; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.rowGroups.roster.rows[2][0].box.top = 2; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.fields.decision.options![1].id = 'yes'; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.placements[2].optionId = 'unknown'; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.sections[0].fields = []; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.sections[0].id = 'type'; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.rowGroups.type = d.rowGroups.roster; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.rowGroups.name = d.rowGroups.roster; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.formId = 'navmc_10274'; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.placements[0].dateFormat = 'mdy'; },
      (d: ReturnType<typeof fixtureDefinition>) => { d.placements[0].fieldId = 'toString'; },
    ]) { const d = fixtureDefinition(); change(d); expect(() => compileFormDefinition(d)).toThrow(); }
    expect(() => compileFormDefinition({ ...fixtureDefinition(), script: 'calculate()' })).toThrow();
  });
  it('reports inherited-property names in imported answers without treating them as fields', () => {
    const instance = fixtureInstance();
    instance.answers = { ...instance.answers, constructor: 'saved input' };
    instance.rows = { constructor: [] };
    const diagnostics = validateAnswers(instance.definition, instance.answers, instance.rows);
    expect(diagnostics.map(issue => issue.code)).toEqual(['unknown-answer', 'unknown-group']);
    expect(diagnostics.map(issue => diagnosticText(instance.definition, issue))).toEqual(['Saved answer: Unknown field', 'Saved answer: Unknown row group']);
    expect(formErrorSections(instance)).toEqual(['type']);
  });
  it('validates row capacity, dates, choices, IDs and restored input', () => {
    const instance = fixtureInstance();
    instance.rows.roster = [{ id: 'r', answers: { grade: 'invalid', date: '2026-02-30' } }, { id: 'r', answers: {} }];
    expect(validateAnswers(instance.definition, instance.answers, instance.rows).map(i => i.code)).toEqual(expect.arrayContaining(['option', 'date', 'row-id', 'required']));
    expect(parseFormInstance(instance).rows).toEqual(instance.rows);
    instance.rows.roster = Array.from({ length: 4 }, (_, i) => ({ id: String(i), answers: { grade: 'e1' } }));
    expect(validateAnswers(instance.definition, instance.answers, instance.rows).some(i => i.code === 'capacity')).toBe(true);
  });
  it('adapts legacy radio widgets and refuses conflicting legacy selections', () => {
    const f = { type: 'radio' as const, group: 'decision', page: 1, box: { left: 20, top: 200, width: 12, height: 12 } };
    const d = adaptLegacyForm({ id: 'legacy', label: 'Legacy', directory: 'legacy', pages: ['page1.pdf'], sections: [{ title: 'Page 1', editor: 'checklist', fields: ['yes', 'no'] }], fields: { yes: { ...f, label: 'Yes', required: true }, no: { ...f, label: 'No', box: { ...f.box, left: 50 } } } });
    expect(Object.keys(d.fields)).toHaveLength(1);
    expect(migrateLegacyAnswers(d, { no: true }, {}).answers).toEqual({ radio_0: 'no' });
    expect(() => migrateLegacyAnswers(d, { yes: true, no: true }, {})).toThrow(/conflicting/);
  });
});
