import { describe, expect, it } from 'vitest';
import { configuredBatchMapping, configuredBatchRowsPreview, mapConfiguredBatchRow, MAX_CONFIGURED_BATCH_REPEAT_BYTES } from '@/lib/configuredFormBatch';
import { fixtureInstance } from '../_helpers/formFixture';

const values = { name: 'Recipient B', decision: 'yes' };
function form() {
  const instance = fixtureInstance();
  const group = instance.definition.rowGroups.roster;
  group.columns.active = { kind: 'boolean', label: 'Active' };
  group.columns.notes = { kind: 'text', label: 'Notes' };
  group.columns.multi = { kind: 'multipleChoice', label: 'Choices', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] };
  for (const row of group.rows) {
    row.push({ ...row[0], fieldId: 'active', box: { left: 300, top: row[0].box.top, width: 20, height: 18 } });
    row.push({ ...row[0], fieldId: 'notes', box: { left: 330, top: row[0].box.top, width: 80, height: 18 } });
    row.push({ ...row[0], fieldId: 'multi', box: { left: 430, top: row[0].box.top, width: 120, height: 18 } });
  }
  instance.rows.roster = [{ id: 'source-only', answers: { grade: 'e1', date: '2026-01-01', notes: 'SOURCE PERSON' } }];
  return instance;
}

describe('configured form repeating roster rows', () => {
  it('maps independent typed answers with stable retry IDs and reviewed labels', () => {
    const source = form();
    const raw = '[{"grade":"E-2","date":"2024-02-29","active":false,"notes":"  Preserve me  ","multi":["One","two"]},{"grade":"e1"}]';
    const first = mapConfiguredBatchRow(source, { ...values, roster: raw });
    const second = mapConfiguredBatchRow(source, { ...values, roster: raw });
    expect(first.issues).toEqual([]);
    expect(first.instance.rows).toEqual(second.instance.rows);
    expect(first.instance.rows.roster).toEqual([
      { id: 'batch_roster_0', answers: { grade: 'e2', date: '2024-02-29', active: false, notes: '  Preserve me  ', multi: ['one', 'two'] } },
      { id: 'batch_roster_1', answers: { grade: 'e1' } },
    ]);
    expect(configuredBatchRowsPreview(source.definition, 'roster', raw)).toContain('Grade: E-2 (e2)');
    expect(configuredBatchRowsPreview(source.definition, 'roster', raw)).toContain('Choices: One (one); Two (two)');
    expect(source.rows.roster[0].answers.notes).toBe('SOURCE PERSON');
    first.instance.rows.roster[0].answers.notes = 'Changed';
    expect(source.rows.roster[0].answers.notes).toBe('SOURCE PERSON');
  });

  it.each(['', '  ', '[]'])('never inherits source rows for blank or empty input %j', raw => {
    const source = form(), result = mapConfiguredBatchRow(source, { ...values, roster: raw });
    expect(result.issues).toEqual([]);
    expect(result.instance.rows.roster ?? []).toEqual([]);
    expect(JSON.stringify(result.instance.rows)).not.toContain('SOURCE PERSON');
  });

  it.each([
    ['{}', /JSON array/], ['null', /JSON array/], ['[1]', /answer object/], ['[[]]', /answer object/],
    ['[{"grade":"e1"},{"grade":"e1"},{"grade":"e1"},{"grade":"e1"}]', /at most 3/],
    ['[{"grade":"unknown"}]', /unambiguous/], ['[{"grade":"e1","date":"2026-02-29"}]', /valid date/],
    ['[{}]', /Grade.*required/], ['[{"grade":"e1","other":"value"}]', /unknown column/],
    ['[{"grade":2}]', /expected a string/], ['[{"grade":"e1","active":"yes"}]', /expected true or false/],
    ['[{"grade":"e1","multi":"one"}]', /array of option strings/], ['[{"grade":"e1","multi":[true]}]', /array of option strings/],
    ['[{"grade":"e1","multi":["one","One"]}]', /only once/],
    ['[{"grade":"e1","grade":"e2"}]', /Duplicate row column/],
    ['[{"grade":"e1","gr\\u0061de":"e2"}]', /Duplicate row column/],
    ['[{"grade":"e1","__proto__":"unsafe"}]', /unknown column/],
  ])('rejects invalid groups with no partial group: %s', (raw, error) => {
    const source = form(), result = mapConfiguredBatchRow(source, { ...values, roster: raw });
    expect(result.issues.join()).toMatch(error);
    expect(configuredBatchRowsPreview(source.definition, 'roster', raw)).toBeUndefined();
  });

  it('allows quoted punctuation in text without confusing duplicate-key detection', () => {
    const result = mapConfiguredBatchRow(form(), { ...values, roster: JSON.stringify([{ grade: 'e1', notes: 'text , "grade": { [] } 😀', multi: ['one'] }]) });
    expect(result.issues).toEqual([]);
    expect(result.instance.rows.roster[0].answers.notes).toContain('😀');
  });

  it('supports forms containing only repeating groups and gives each group unique row IDs', () => {
    const source = form();
    source.definition.fields = {};source.definition.placements = [];source.definition.sections = [];source.answers = {};
    source.definition.rowGroups.second = structuredClone(source.definition.rowGroups.roster);
    expect(configuredBatchMapping(source).fields.map(field => field.id)).toEqual(['roster', 'second']);
    const result = mapConfiguredBatchRow(source, { roster: '[{"grade":"e1"}]', second: '[{"grade":"e2"}]' });
    expect(result.issues).toEqual([]);
    expect(result.instance.rows.roster[0].id).not.toBe(result.instance.rows.second[0].id);
  });

  it('keeps repeating signatures blank and refuses mapping or retained signatures', () => {
    const source = form();
    source.definition.rowGroups.roster.columns.signature = { kind: 'signature', label: 'Row signature', requiredAt: 'sign' };
    expect(mapConfiguredBatchRow(source, { ...values, roster: '[{"grade":"e1","signature":""}]' }).issues.join()).toContain('sign after export');
    source.rows.roster[0].answers.signature = 'Someone';
    expect(configuredBatchMapping(source).issues.join()).toContain('clear the signature');
  });

  it('rejects oversized input before JSON parsing', () => {
    const result = mapConfiguredBatchRow(form(), { ...values, roster: 'x'.repeat(MAX_CONFIGURED_BATCH_REPEAT_BYTES + 1) });
    expect(result.issues.join()).toContain('256 KiB');
  });
});

it('enforces total repeating-row and input-byte budgets across groups', () => {
  const source = form();
  const group = source.definition.rowGroups.roster;
  group.rows = Array.from({ length: 150 }, () => structuredClone(group.rows[0]));
  source.definition.rowGroups.second = structuredClone(group);
  const raw = JSON.stringify(Array(150).fill({ grade: 'e1' }));
  expect(mapConfiguredBatchRow(source, { ...values, roster: raw, second: raw }).issues.join()).toContain('at most 200 repeating rows');
  const many = form(), inputs: Record<string, string> = { ...values };
  for (let index = 0; index < 5; index++) {
    const id = `large_${index}`;
    many.definition.rowGroups[id] = structuredClone(many.definition.rowGroups.roster);
    inputs[id] = JSON.stringify([{ grade: 'e1', notes: 'x'.repeat(220_000) }]);
  }
  expect(mapConfiguredBatchRow(many, inputs).issues).toEqual(['A form supports at most 1 MiB of repeating-row input.']);
});

it('counts UTF-8 bytes and bounds total supplied repeat answers', () => {
  expect(mapConfiguredBatchRow(form(), { ...values, roster: JSON.stringify([{ grade: 'e1', notes: '😀'.repeat(70_000) }]) }).issues.join()).toContain('256 KiB');
  const source = form(), group = source.definition.rowGroups.roster;
  for (let index = 0; index < 11; index++) {
    const id = `extra_${index}`;
    group.columns[id] = { kind: 'text', label: id };
    for (const row of group.rows) row.push({ ...row[0], fieldId: id });
  }
  group.rows = Array.from({ length: 200 }, () => structuredClone(group.rows[0]));
  const answers = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`extra_${index}`, 'x']));
  expect(mapConfiguredBatchRow(source, { ...values, roster: JSON.stringify(Array(200).fill({ grade: 'e1', ...answers })) }).issues.join()).toContain('at most 2000 answers');
});


it('counts supplied blank answers toward the form-wide answer budget across groups', () => {
  const source = form(), group = source.definition.rowGroups.roster;
  for (let index = 0; index < 11; index++) {
    const id = `extra_${index}`;
    group.columns[id] = { kind: 'text', label: id };
    for (const row of group.rows) row.push({ ...row[0], fieldId: id });
  }
  group.rows = Array.from({ length: 100 }, () => structuredClone(group.rows[0]));
  source.definition.rowGroups.second = structuredClone(group);
  const answers = { grade: 'e1', ...Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`extra_${index}`, '  '])) };
  const raw = JSON.stringify(Array(100).fill(answers));
  expect(mapConfiguredBatchRow(source, { ...values, roster: raw }).issues).toEqual([]);
  expect(mapConfiguredBatchRow(source, { ...values, roster: raw, second: raw }).issues.join()).toContain('at most 2000 repeating-row answers');
});


it('enforces the repeating-cell byte budget for whitespace-only blank input', () => {
  const source = form();
  expect(mapConfiguredBatchRow(source, { ...values, roster: ' '.repeat(MAX_CONFIGURED_BATCH_REPEAT_BYTES) }).issues).toEqual([]);
  expect(mapConfiguredBatchRow(source, { ...values, roster: ' '.repeat(MAX_CONFIGURED_BATCH_REPEAT_BYTES + 1) }).issues.join()).toContain('256 KiB');
});
