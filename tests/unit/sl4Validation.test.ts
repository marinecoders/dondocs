import { describe, expect, it } from 'vitest';
import { newSl4Part, sl4Schema, type Sl4Data } from '@/data/techpub/sl4';
import { sl4Example } from '@/data/techpub/sl4Examples';
import { sl4ContentFindings, sl4HierarchyFindings } from '@/lib/sl4Validation';
import { buildSl4Indexes } from '@/lib/sl4References';

const codes = (data: Sl4Data) => sl4ContentFindings(data).map((finding) => finding.code);

describe('SL-4 validation', () => {
  it('rejects template prompts inside circuit-symbol arrays', () => {
    const data = sl4Example();
    const part = data.rows.find(row => row.kind === 'part')!;
    if (part.kind === 'part') part.circuitSymbols = ['{{SYMBOL}}'];
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({
      code: 'template-prompt', path: ['rows', 1, 'circuitSymbols', 0],
    }));
  });
  it('rejects duplicate definition IDs independently of their displayed terms', () => {
    const data = sl4Example();
    data.definitions = [
      { id: 'duplicate', term: 'ABC', meaning: 'First definition', portionMarking: 'U' },
      { id: 'duplicate', term: 'DEF', meaning: 'Second definition', portionMarking: 'U' },
    ];
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({ code: 'duplicate-block', path: ['definitions'] }));
  });
  it('requires S/A to refer to first appearance, not a chain of repeated items', () => {
    const data = sl4Example();
    data.rows.push({ ...newSl4Part('third'), nomenclature: 'RESISTOR', nsn: '5905-00-000-0001', quantityPerApplication: '1', relationship: { kind: 'same_as', itemIds: ['resistor-repeat'] } });
    expect(codes(data)).toContain('same-as-first');
  });

  it('finds an earlier matching part even if the S/A target has no S/A relationship', () => {
    const data = sl4Example();
    const repeated = data.rows.find((row) => row.id === 'resistor-repeat')!;
    if (repeated.kind === 'part') delete repeated.relationship;
    data.rows.push({ ...newSl4Part('third'), nomenclature: 'RESISTOR', nsn: '5905-00-000-0001', quantityPerApplication: '1', relationship: { kind: 'same_as', itemIds: ['resistor-repeat'] } });
    expect(codes(data)).toContain('same-as-first');
  });

  it('scopes S/A to the major combination identified by a heading', () => {
    const data = sl4Example();
    data.rows.push({ kind: 'heading', id: 'other-combination', text: 'SECOND MAJOR COMBINATION', majorCombination: true, portionMarking: 'U' });
    data.rows.push({ ...newSl4Part('other-resistor'), nomenclature: 'RESISTOR', nsn: '5905-00-000-0001', quantityPerApplication: '1', relationship: { kind: 'same_as', itemIds: ['resistor'] } });
    expect(codes(data)).toContain('same-as-combination');
    const last = data.rows.at(-1)!;
    if (last.kind === 'part') delete last.relationship;
    expect(codes(data)).not.toContain('same-as-combination');
  });

  it('does not allow a new major combination to continue a previous parent group', () => {
    const rows = [newSl4Part('parent'), { kind: 'heading' as const, id: 'new', text: 'NEW COMBINATION', majorCombination: true, portionMarking: 'U' as const }, { ...newSl4Part('child'), parentId: 'parent' }];
    expect(sl4HierarchyFindings(rows).map((finding) => finding.code)).toContain('parent-order');
  });

  it('restricts a consolidated equipment quantity to first appearance in the list', () => {
    const data = sl4Example();
    Object.assign(data.rows.at(-1)!, { quantityPerEquipment: '2' });
    expect(codes(data)).toContain('equipment-quantity-repeat');
    // The first equipment total remains author supplied, never recalculated.
    expect(data.rows.find((row) => row.id === 'resistor')).toHaveProperty('quantityPerEquipment', '2');
  });

  it('requires equipment total for a confirmed maintenance part, and leaves non-maintenance totals blank', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { maintenancePart: true, quantityPerEquipment: '' });
    expect(codes(data)).toContain('equipment-quantity-required');
    Object.assign(data.rows[2], { maintenancePart: false, quantityPerEquipment: '1' });
    expect(codes(data)).toContain('non-maintenance-total');
    Object.assign(data.rows[2], { maintenancePart: undefined, quantityPerEquipment: '' });
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({ code: 'maintenance-review', severity: 'warning' }));
  });

  it('rejects source placeholders in required and optional publication text', () => {
    const data = sl4Example();
    data.sourceManual = '[SOURCE MANUAL]';
    data.notes[0].text = 'INSERT NOMENCLATURE HERE';
    expect(codes(data)).toContain('template-prompt');
    expect(sl4ContentFindings(data).find((finding) => finding.path.join('.') === 'notes.0.text')?.code).toBe('template-prompt');
  });

  it('rejects impossible revision dates instead of treating any nonempty text as complete', () => {
    const data = sl4Example();
    data.revisions = [{ id: 'r', revision: 'A', date: '2026-02-29', description: 'Training revision', enteredBy: 'Training office', portionMarking: 'U' }];
    expect(codes(data)).toContain('revision-date');
    data.revisions[0].date = '2028-02-29';
    expect(codes(data)).not.toContain('revision-date');
  });

  it('checks figure assignments against an explicit illustration inventory when supplied', () => {
    const data = sl4Example();
    data.endItemFigureId = 'end-item';
    Object.assign(data.rows[2], { figureId: 'component' });
    expect(sl4ContentFindings(data, { figureIds: [] }).filter((finding) => finding.code === 'missing-figure')).toHaveLength(2);
    expect(sl4ContentFindings(data, { figureIds: ['end-item', 'component'] }).filter((finding) => finding.code === 'missing-figure')).toHaveLength(0);
  });

  it('normalizes references consistently with trimmed stable IDs', () => {
    const data = sl4Schema.parse({ rows: [{ ...newSl4Part('parent'), id: ' parent ' }, { ...newSl4Part('child'), parentId: ' parent ' }] });
    expect(sl4HierarchyFindings(data.rows)).toEqual([]);
  });

  it('requires an S/A annotation for a known duplicated part within a major combination', () => {
    const data = sl4Example();
    const row = data.rows.at(-1)!;
    if (row.kind === 'part') delete row.relationship;
    expect(codes(data)).toContain('same-as-required');
  });

  it('reports official-name casing without changing technical descriptions', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { nomenclature: 'Board, USB training circuit', description: 'Use USB and Type C connectors.' });
    expect(sl4ContentFindings(data)).toContainEqual(expect.objectContaining({ code: 'nomenclature-case', severity: 'warning' }));
    expect(data.rows[2]).toHaveProperty('description', 'Use USB and Type C connectors.');
  });

  it('rejects leftover source identifier masks and duplicate illustration IDs', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { cage: 'XXXXX' });
    expect(codes(data)).toContain('template-prompt');
    expect(sl4ContentFindings(data, { figureIds: ['drawing', 'drawing'] }).map((finding) => finding.code)).toEqual(expect.arrayContaining(['duplicate-figure', 'end-item-figure']));
  });

  it('refuses ambiguous IDs across headings and parts when deriving cross-references', () => {
    const data = sl4Example();
    data.rows[0].id = 'resistor';
    expect(() => buildSl4Indexes(data)).toThrow('unique');
  });

  it('does not emit malformed NSNs or ambiguous circuit-symbol links in generated indexes', () => {
    const data = sl4Example();
    Object.assign(data.rows[2], { nsn: 'NOT-AN-NSN' });
    expect(() => buildSl4Indexes(data)).toThrow('NSN');
    Object.assign(data.rows[2], { nsn: '', circuitSymbols: ['R1'] });
    expect(() => buildSl4Indexes(data)).toThrow('circuit');
  });
});
