import { describe, expect, it } from 'vitest';
import { emptySl4, newSl4Part, numberedSl4Parts, sl4Portions, sl4Schema } from '@/data/techpub/sl4';
import { sl4Example } from '@/data/techpub/sl4Examples';
import { sl4ContentFindings, sl4HierarchyFindings } from '@/lib/sl4Validation';

const errors = (data: ReturnType<typeof emptySl4>) => sl4ContentFindings(data).filter((finding) => finding.severity === 'error');

describe('SL-4 draft content', () => {
  it('keeps optional unassigned identifiers blank and separate quantities independent', () => {
    const part = newSl4Part('part');
    expect([part.smr, part.nsn, part.cage, part.partNumber, part.quantityPerEquipment]).toEqual(['', '', '', '', '']);
    part.quantityPerApplication = '6';
    expect(part.quantityPerEquipment).toBe('');
    expect(part.mandatoryReplacement).toBe(false);
    expect(part.economicReplacement).toBe(false);
  });

  it('roundtrips every field and stable relationship without persisting item numbers', () => {
    const data = sl4Example();
    data.revisions = [{ id: 'revision', revision: 'A', date: '2026-10-31', description: 'Fictional revision', enteredBy: 'Training office', portionMarking: 'U' }];
    expect(sl4Schema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(data.rows.some((row) => 'itemNumber' in row)).toBe(false);
    expect(errors(data)).toEqual([]);
    expect(sl4ContentFindings(data)).toEqual([]);
  });

  it('does not accept an independently persisted index or obsolete inventory field', () => {
    expect(sl4Schema.safeParse({ ...emptySl4(), partII: [] }).success).toBe(false);
    expect(sl4Schema.safeParse({ rows: [{ ...newSl4Part('a'), quantity: '4' }] }).success).toBe(false);
  });

  it('numbers only parts and derives new numbers after reorder or delete', () => {
    const rows = [newSl4Part('a'), { kind: 'blank' as const, id: 'blank' }, newSl4Part('b')];
    expect(numberedSl4Parts(rows).map((part) => [part.id, part.itemNumber])).toEqual([['a', 1], ['b', 2]]);
    expect(numberedSl4Parts([...rows].reverse()).map((part) => [part.id, part.itemNumber])).toEqual([['b', 1], ['a', 2]]);
    expect(numberedSl4Parts(rows.slice(1)).map((part) => [part.id, part.itemNumber])).toEqual([['b', 1]]);
    expect(rows[0]).not.toHaveProperty('itemNumber');
  });

  it('projects marked text from metadata, headings, parts, notes, CAGE and revisions', () => {
    const data = sl4Example();
    data.contextPortion = 'S';
    data.rows[0] = { kind: 'heading', id: 'h', text: 'Section', portionMarking: 'C' };
    data.rows.push({ ...newSl4Part('secret-part'), portionMarking: 'S' });
    data.notes[0].portionMarking = 'TS';
    data.cages[0].portionMarking = 'CUI';
    data.revisions = [{ id: 'rev', revision: 'A', date: '', description: 'Revision', enteredBy: 'Office', portionMarking: 'S' }];
    const projected = sl4Portions(data);
    expect(projected.find((p) => p.text === data.sourceManual)?.portionMarking).toBe('S');
    for (const [text, marking] of [['Section', 'C'], ['secret-part', 'S'], ['training-note', 'TS'], ['training-entity', 'CUI'], ['Revision', 'S']])
      expect(projected.find((p) => p.text.includes(text))?.portionMarking).toBe(marking);
  });
});

describe('SL-4 content findings', () => {
  it('accepts optional missing ordering identifiers without importing SL-3 rules', () => {
    const data = sl4Example();
    const part = data.rows.find((row) => row.kind === 'part')!;
    if (part.kind !== 'part') throw new Error('Missing example part');
    Object.assign(part, { smr: '', nsn: '', cage: '', partNumber: '' });
    expect(errors(data)).toEqual([]);
    expect(sl4ContentFindings(data).map((finding) => finding.code)).toContain('ordering-data');
  });

  it('retains MAN and ECO together without inventing mutually exclusive code rules', () => {
    const data = sl4Example();
    const part = data.rows[1];
    if (part.kind !== 'part') throw new Error('Missing part');
    part.mandatoryReplacement = part.economicReplacement = true;
    part.smr = 'UNVERIFIED';
    expect(errors(data)).toEqual([]);
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({ code: 'smr-review', severity: 'warning' }));
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1e309', '2 parts'])('rejects invalid per-application quantity %s', (quantity) => {
    const data = sl4Example();
    Object.assign(data.rows[1], { quantityPerApplication: quantity });
    expect(errors(data).map((finding) => finding.code)).toContain('application-quantity');
  });

  it('accepts fractional quantities without calculating consolidated totals', () => {
    const data = sl4Example();
    Object.assign(data.rows[1], { quantityPerApplication: '0.5', quantityPerEquipment: '3.5' });
    expect(errors(data)).toEqual([]);
    Object.assign(data.rows[1], { quantityPerEquipment: 'Infinity' });
    expect(errors(data).map((finding) => finding.code)).toContain('equipment-quantity');
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '', '31 October 2026'])('rejects invalid cut-off date %s', (date) => {
    const data = sl4Example(); data.cutoffDate = date;
    expect(errors(data).map((finding) => finding.code)).toContain('cutoff-date');
  });

  it('accepts a leap-year cut-off date', () => {
    const data = sl4Example(); data.cutoffDate = '2028-02-29';
    expect(errors(data)).toEqual([]);
  });

  it('reports incomplete fields and malformed optional identifiers with editor paths', () => {
    const data = sl4Example();
    Object.assign(data.rows[1], { nomenclature: '', unit: '', nsn: '123', cage: 'LONG-CAGE' });
    data.sourceManual = data.standaloneRationale = '';
    expect(errors(data).map((finding) => finding.code)).toEqual(expect.arrayContaining(['nomenclature', 'unit', 'nsn', 'cage', 'source-manual', 'standalone-rationale']));
    expect(errors(data).find((finding) => finding.code === 'nsn')?.path).toEqual(['rows', 1, 'nsn']);
  });

  it('detects invalid parents, noncontiguous subtrees and duplicate IDs', () => {
    const a = newSl4Part('a'), b = newSl4Part('b'), c = { ...newSl4Part('c'), parentId: 'a' };
    expect(sl4HierarchyFindings([a, b, c]).map((f) => f.code)).toContain('parent-order');
    expect(sl4HierarchyFindings([a, c, b])).toEqual([]);
    expect(sl4HierarchyFindings([a, a]).map((f) => f.code)).toContain('duplicate-row');
    expect(sl4HierarchyFindings([{ ...a, parentId: 'missing' }]).map((f) => f.code)).toContain('parent-order');
    expect(sl4HierarchyFindings([{ ...a, parentId: 'a' }]).map((f) => f.code)).toContain('parent-order');
  });

  it('retains a valid nested top-down sequence and rejects a stranded grandchild', () => {
    const a = newSl4Part('a'), b = { ...newSl4Part('b'), parentId: 'a' }, c = { ...newSl4Part('c'), parentId: 'b' }, d = { ...newSl4Part('d'), parentId: 'a' };
    expect(sl4HierarchyFindings([a, b, c, d])).toEqual([]);
    expect(sl4HierarchyFindings([a, b, d, c]).map((f) => f.code)).toContain('parent-order');
  });

  it('rejects a dangling heading even when blank rows follow it', () => {
    expect(sl4HierarchyFindings([{ kind: 'heading', id: 'h', text: 'Heading', portionMarking: 'U' }, { kind: 'blank', id: 'b' }]).map((f) => f.code)).toContain('orphan-heading');
  });

  it('rejects stale, self, duplicate and forward same-as references', () => {
    const data = sl4Example();
    const last = data.rows.at(-1)!;
    if (last.kind !== 'part') throw new Error('Missing part');
    last.relationship = { kind: 'same_as', itemIds: ['missing'] };
    expect(errors(data).map((f) => f.code)).toContain('related-item');
    last.relationship.itemIds = [last.id];
    expect(errors(data).map((f) => f.code)).toContain('related-item');
    last.relationship.itemIds = ['resistor', 'resistor'];
    expect(errors(data).map((f) => f.code)).toEqual(expect.arrayContaining(['duplicate-related-item', 'same-as-count']));
    Object.assign(data.rows[1], { relationship: { kind: 'same_as', itemIds: [last.id] } });
    expect(errors(data).map((f) => f.code)).toContain('same-as-order');
  });

  it('permits forward fabrication references but detects cycles', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { relationship: { kind: 'fabricated_from', itemIds: ['resistor'] } });
    expect(errors(data)).toEqual([]);
    Object.assign(data.rows[4], { relationship: { kind: 'assembled_from', itemIds: ['board'] } });
    expect(errors(data).map((f) => f.code)).toContain('relationship-cycle');
  });

  it('checks a long fabrication dependency chain without recursive stack overflow', () => {
    const data = sl4Example();
    data.rows = Array.from({ length: 12_000 }, (_, i) => ({ ...newSl4Part(String(i)), nomenclature: 'PART', quantityPerApplication: '1', ...(i ? { relationship: { kind: 'fabricated_from' as const, itemIds: [String(i - 1)] } } : {}) }));
    data.circuitIndex.mode = 'not_applicable';
    expect(errors(data)).toEqual([]);
  });

  it('checks kit contents without sorting or mutating them', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { nomenclature: 'Z BOARD' });
    const before = structuredClone(data);
    expect(errors(data).map((f) => f.code)).toContain('kit-sequence');
    expect(data).toEqual(before);
    Object.assign(data.rows[4], { isKit: true });
    expect(errors(data).map((f) => f.code)).toContain('empty-kit');
  });

  it('distinguishes an inapplicable circuit index from an excessive-quantity omission', () => {
    const data = sl4Example();
    data.circuitIndex.mode = 'not_applicable';
    expect(errors(data).map((f) => f.code)).toContain('circuit-applicability');
    data.circuitIndex.mode = 'omitted_excessive';
    expect(errors(data).map((f) => f.code)).toContain('circuit-omission');
    data.circuitIndex.reason = 'Training example: symbols are delivered in the maintenance manual.';
    expect(errors(data)).toEqual([]);
  });

  it('rejects ambiguous and empty symbols and an empty included index', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { circuitSymbols: ['r1', ''] });
    expect(errors(data).filter((f) => f.code === 'circuit-symbol')).toHaveLength(2);
    for (const row of data.rows) if (row.kind === 'part') row.circuitSymbols = [];
    expect(errors(data).map((f) => f.code)).toContain('empty-circuit-index');
  });

  it('finds missing entity data, conflicting CAGE codes and incomplete records', () => {
    const data = sl4Example();
    data.cages.push({ ...data.cages[0], id: 'another', code: 'zz999' });
    data.notes.push({ ...data.notes[0], text: '' });
    data.revisions.push({ id: 'rev', revision: 'A', date: '', description: '', enteredBy: '', portionMarking: 'U' });
    expect(errors(data).map((f) => f.code)).toEqual(expect.arrayContaining(['cage-directory', 'duplicate-block', 'empty-note', 'revision-entry']));
    data.cages = [];
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({ code: 'missing-entity', severity: 'warning' }));
  });
});
