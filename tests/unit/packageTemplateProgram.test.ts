import { describe, expect, it } from 'vitest';
import { evaluatePackageTemplateCondition, evaluatePackageTemplateProgram, packageTemplateAnswersSchema,
  packageTemplateConditionSchema, packageTemplateProgramSchema, validatePackageTemplateProgramMembers,
  type PackageTemplateAnswers, type PackageTemplateCondition, type PackageTemplateProgram } from '@/lib/packageTemplateProgram';

const answers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
const program = (): PackageTemplateProgram => ({ revision: '1.0', participantGroups: [{ id: 'people', label: 'People', role: 'subject', min: 0, max: 3 }],
  questions: [{ id: 'approved', label: 'Approved', kind: 'boolean', required: true },
    { id: 'where', label: 'Location', kind: 'text', required: true, when: { op: 'equals', questionId: 'approved', value: true } },
    { id: 'person_name', label: 'Name', kind: 'identifier', required: true, groupId: 'people' }], requirements: [] });
const equals = (questionId: string, value: string | boolean): PackageTemplateCondition => ({ op: 'equals', questionId, value });

describe('bounded declarative template programs', () => {
  it('parses question declarations without defaults or case data and owns the result', () => {
    const source = program(), parsed = packageTemplateProgramSchema.parse(source); source.questions[0].label = 'Changed';
    expect(parsed.questions[0].label).toBe('Approved');
    expect(() => packageTemplateProgramSchema.parse({ ...program(), answers: answers() })).toThrow();
    expect(() => packageTemplateProgramSchema.parse({ ...program(), questions: [{ ...program().questions[0], default: false }] })).toThrow();
  });
  it('rejects unknown, cross-group and cyclic visibility references', () => {
    const unknown = program(); unknown.questions[1].when = equals('absent', true); expect(() => packageTemplateProgramSchema.parse(unknown)).toThrow(/Unknown/);
    const cross = program(); cross.questions[1].when = { op: 'answered', questionId: 'person_name' }; expect(() => packageTemplateProgramSchema.parse(cross)).toThrow(/outside/);
    const cycle = program(); cycle.questions[0].when = { op: 'answered', questionId: 'where' }; expect(() => packageTemplateProgramSchema.parse(cycle)).toThrow(/cycle/);
  });
  it('validates option IDs, literal types, identities and participant capacities', () => {
    const choice = program(); choice.questions = [{ id: 'choice', label: 'Choice', kind: 'choice', required: false, options: [{ id: 'a', label: 'A' }] },
      { id: 'dependent', label: 'Dependent', kind: 'text', required: false, when: equals('choice', 'missing') }];
    expect(() => packageTemplateProgramSchema.parse(choice)).toThrow(/incompatible/);
    choice.questions[1].when = equals('choice', 'a'); expect(() => packageTemplateProgramSchema.parse(choice)).not.toThrow();
    choice.questions[0].options!.push({ id: 'a', label: 'Duplicate' }); expect(() => packageTemplateProgramSchema.parse(choice)).toThrow(/duplicate options/);
    const invalid = program(); invalid.questions[1].when = equals('approved', 'false'); expect(() => packageTemplateProgramSchema.parse(invalid)).toThrow(/incompatible/);
    for (const id of ['constructor', '__proto__', 'prototype']) { const value = program(); value.questions[0].id = id; expect(() => packageTemplateProgramSchema.parse(value)).toThrow(/Reserved/); }
    const reversed = program(); reversed.participantGroups[0].min = 3; reversed.participantGroups[0].max = 1; expect(() => packageTemplateProgramSchema.parse(reversed)).toThrow(/reversed/);
  });
  it('bounds AST depth, node breadth and cycles before recursive validation', () => {
    let deep: PackageTemplateCondition = equals('approved', true);
    for (let i = 0; i < 9; i++) deep = { op: 'not', condition: deep };
    expect(() => packageTemplateConditionSchema.parse(deep)).toThrow(/8 levels/);
    const loop: Record<string, unknown> = { op: 'not' }; loop.condition = loop;
    expect(() => packageTemplateConditionSchema.parse(loop)).toThrow(/circular/);
    expect(() => packageTemplateConditionSchema.parse({ op: 'all', conditions: [] })).toThrow();
    expect(() => packageTemplateConditionSchema.parse({ op: 'equals', questionId: 'approved', value: true, path: 'formData.signature' })).toThrow();
  });
  it('rejects oversized combined programs and answer materialization instead of truncating', () => {
    const value = program();
    const rule: PackageTemplateCondition = { op: 'all', conditions: Array.from({ length: 3 }, () => ({ op: 'all', conditions: Array.from({ length: 20 }, () => ({ op: 'answered', questionId: 'approved' })) })) };
    value.questions.push(...Array.from({ length: 40 }, (_, index) => ({ id: `dependent_${index}`, label: 'Dependent', kind: 'text' as const, required: false, when: structuredClone(rule) })));
    expect(() => packageTemplateProgramSchema.parse(value)).toThrow(/2048/);
    expect(() => packageTemplateAnswersSchema.parse({ ...answers(), values: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`field_${index}`, 'x'])) })).toThrow(/200 values/);
    expect(() => packageTemplateAnswersSchema.parse({ ...answers(), values: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field_${index}`, 'x'.repeat(10000)])) })).toThrow(/256 KB/);
    const repeated = program();repeated.questions = Array.from({ length: 80 }, (_, index) => ({ id: `person_${index}`, label: 'Person value', kind: 'text', required: false, groupId: 'people' }));
    const input = answers();input.groups.people = Array.from({ length: 3 }, (_, index) => ({ id: `person_${index}`, label: 'Person', answers: {} }));
    expect(() => evaluatePackageTemplateProgram(repeated, input)).toThrow(/200 question instances/);
  });
  it('validates member and operation requirement reference scopes', () => {
    const value = program(); value.requirements = [{ id: 'evidence', label: 'Evidence', kind: 'document', operations: ['pdf'], memberKey: 'support', repeatGroupId: 'people' }];
    expect(validatePackageTemplateProgramMembers(value, [{ key: 'support' }])).toContain('Requirement evidence and its member must use the same participant group.');
    expect(validatePackageTemplateProgramMembers(value, [{ key: 'support', repeatGroupId: 'people' }])).toEqual([]);
    value.requirements[0].operations = ['pdf', 'pdf']; expect(() => packageTemplateProgramSchema.parse(value)).toThrow(/repeats/);
    value.requirements[0].kind = 'confirmation'; expect(() => packageTemplateProgramSchema.parse(value)).toThrow(/confirmation/);
  });
});

describe('fresh scoped intake evaluation', () => {
  it('keeps unanswered booleans distinct from explicit false and never seeds defaults', () => {
    const input = answers(), value = program();
    expect(evaluatePackageTemplateProgram(value, input).issues.some(issue => issue.code === 'required-answer')).toBe(true);
    expect(evaluatePackageTemplateCondition(value, input, { op: 'answered', questionId: 'approved' })).toBe(false);
    expect(evaluatePackageTemplateCondition(value, input, equals('approved', false))).toBe('unknown');
    input.values.approved = '';
    expect(evaluatePackageTemplateProgram(value, input).issues.some(issue => issue.code === 'invalid-answer')).toBe(true);
    expect(evaluatePackageTemplateCondition(value, input, { op: 'answered', questionId: 'approved' })).toBe('unknown');
    input.values.approved = false;
    expect(evaluatePackageTemplateCondition(value, input, equals('approved', false))).toBe(true);
    const output = evaluatePackageTemplateProgram(value, input); expect(output.ready).toBe(true); expect(output.answers.values).toEqual({ approved: false });
  });
  it('implements three-valued logic with decisive false/true outcomes', () => {
    const input = answers(); input.values.approved = false; const value = program();
    const absent = equals('where', 'Missing'), no = equals('approved', true), yes = equals('approved', false);
    expect(evaluatePackageTemplateCondition(value, input, { op: 'all', conditions: [absent, no] })).toBe(false);
    expect(evaluatePackageTemplateCondition(value, input, { op: 'any', conditions: [absent, yes] })).toBe(true);
    expect(evaluatePackageTemplateCondition(value, input, { op: 'not', condition: absent })).toBe('unknown');
  });
  it('retains inactive invalid answers for inspection without using them to select branches', () => {
    const input = answers(); input.values = { approved: false, where: 'SECRET retained hidden value' };
    const output = evaluatePackageTemplateProgram(program(), input);
    expect(output.answers.values.where).toBe('SECRET retained hidden value');
    expect(output.issues).toContainEqual(expect.objectContaining({ code: 'inactive-answer', questionId: 'where' }));
    expect(evaluatePackageTemplateCondition(program(), input, equals('where', 'SECRET retained hidden value'))).toBe('unknown');
    input.values.approved = 'false'; expect(evaluatePackageTemplateCondition(program(), input, equals('approved', false))).toBe('unknown');
    expect(evaluatePackageTemplateProgram(program(), input).issues.some(issue => issue.code === 'invalid-answer')).toBe(true);
  });
  it('retains invalid hidden dates without treating them as a branch answer', () => {
    const value = program(); value.questions[1].kind = 'date'; const input = answers(); input.values = { approved: false, where: 'not-a-date' };
    const result = evaluatePackageTemplateProgram(value, input);
    expect(result.ready).toBe(true); expect(result.answers.values.where).toBe('not-a-date');
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true);
    expect(evaluatePackageTemplateCondition(value, input, equals('where', '2028-02-29'))).toBe('unknown');
    input.values.approved = true; expect(evaluatePackageTemplateProgram(value, input).issues.some(issue => issue.code === 'invalid-answer')).toBe(true);
    input.values.where = '2027-02-29'; expect(evaluatePackageTemplateProgram(value, input).ready).toBe(false);
    input.values.where = '2028-02-29'; expect(evaluatePackageTemplateProgram(value, input).ready).toBe(true);
  });
  it('evaluates repeated people by stable IDs rather than array positions', () => {
    const input = answers(); input.values.approved = false;
    input.groups.people = [{ id: 'first', label: 'First person', answers: { person_name: '0001' } }, { id: 'second', label: 'Second person', answers: { person_name: '0002' } }];
    const scope = { groupId: 'people', participantId: 'first' }, rule = equals('person_name', '0001');
    expect(evaluatePackageTemplateCondition(program(), input, rule, scope)).toBe(true);
    input.groups.people.reverse(); expect(evaluatePackageTemplateCondition(program(), input, rule, scope)).toBe(true);
    expect(evaluatePackageTemplateCondition(program(), input, rule, { ...scope, participantId: 'missing' })).toBe('unknown');
    const output = evaluatePackageTemplateProgram(program(), input); input.groups.people[0].answers.person_name = 'Caller mutation';
    expect(output.answers.groups.people[0].answers.person_name).toBe('0002');
    expect(() => evaluatePackageTemplateCondition(program(), input, rule)).toThrow(/outside/);
  });
  it('preserves lexical zero and identifiers, reports missing people and rejects foreign answer keys', () => {
    const value = program(); value.participantGroups[0].min = 1;
    value.questions.push({ id: 'amount', label: 'Amount', kind: 'decimal', required: true });
    const input = answers(); input.values = { approved: false, amount: '0.00' };
    expect(evaluatePackageTemplateProgram(value, input).issues.some(issue => issue.code === 'participant-count')).toBe(true);
    input.groups.people = [{ id: 'person', label: 'Person', answers: { person_name: '0000001' } }];
    expect(evaluatePackageTemplateProgram(value, input).ready).toBe(true);
    input.values.foreign = 'Unknown'; expect(() => evaluatePackageTemplateProgram(value, input)).toThrow(/Unknown global/);
    delete input.values.foreign; input.groups.people[0].answers.approved = true; expect(() => evaluatePackageTemplateProgram(value, input)).toThrow(/does not belong/);
    expect(() => packageTemplateAnswersSchema.parse({ ...answers(), groups: { people: [{ id: 'same', label: 'A', answers: {} }, { id: 'same', label: 'B', answers: {} }] } })).toThrow(/unique/);
  });
});
