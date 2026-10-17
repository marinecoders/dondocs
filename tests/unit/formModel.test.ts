import { describe, it, expect } from 'vitest';
import { adaptLegacyForm, compileFormDefinition, diagnosticText, formErrorSections, migrateLegacyAnswers, parseFormInstance, validateAnswers } from '@/services/forms/model';
import { migrateForm } from '@/services/forms/documents';
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
  it('requires explicit migration mappings and leaves the original unchanged', () => {
    const instance = fixtureInstance();
    const d = fixtureDefinition(); d.definitionRevision = 'v2';
    expect(() => migrateForm(instance, d, { from: 'v1', to: 'v2', fields: { name: 'name' } })).toThrow(/decision/);
    const next = migrateForm(instance, d, { from: 'v1', to: 'v2', fields: { name: 'name', decision: 'decision' } });
    expect(next.definition.definitionRevision).toBe('v2');
    expect(instance.definition.definitionRevision).toBe('v1');
  });
  it('maps row columns and options explicitly, preserving row identity and refusing smaller rosters', () => {
    const instance = fixtureInstance();
    instance.rows.roster = [{ id: 'first', answers: { grade: 'e1' } }, { id: 'last', answers: { grade: 'e2' } }];
    const d = fixtureDefinition(); d.definitionRevision = 'v2';
    const mapping = { from: 'v1', to: 'v2', fields: { name: 'name', decision: 'decision' }, rowGroups: { roster: { to: 'roster', columns: { grade: 'grade' }, options: { grade: { e1: 'e2', e2: 'e1' } } } } };
    expect(migrateForm(instance, d, mapping).rows.roster).toEqual([{ id: 'first', answers: { grade: 'e2' } }, { id: 'last', answers: { grade: 'e1' } }]);
    expect(instance.rows.roster[0].answers.grade).toBe('e1');
    d.rowGroups.roster.rows = d.rowGroups.roster.rows.slice(0, 1);
    expect(() => migrateForm(instance, d, mapping)).toThrow(/holds 1 rows/);
  });

});
