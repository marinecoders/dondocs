import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { emptySl4, newSl4Part } from '@/data/techpub/sl4';
import { sl4Example } from '@/data/techpub/sl4Examples';
import { buildSl4Indexes, sl4IndexPanels } from '@/lib/sl4References';

describe('SL-4 derived cross-references', () => {
  it('places every occurrence in the required indexes, retaining repeated parts', () => {
    const indexes = buildSl4Indexes(sl4Example());
    expect(indexes.partII.map((r) => r.itemNumber)).toEqual([1, 2]);
    expect(indexes.partIII.map((r) => r.itemNumber)).toEqual([3, 4, 5]);
    expect(indexes.partIV.map((r) => r.itemNumber)).toEqual([2, 1, 4, 5, 3]);
    expect(indexes.partV.map((r) => [r.circuitSymbol, r.itemNumber])).toEqual([['A1', 2], ['R1', 4], ['R2', 5]]);
    expect(indexes.partIV.filter((r) => r.partNumber === 'TRAIN-RES')).toHaveLength(2);
  });

  it('sorts NSNs without hyphens and resolves equal keys with CAGE then item number', () => {
    const data = emptySl4();
    data.rows = [
      { ...newSl4Part('a'), nsn: '5905-00-000-0001', cage: 'ZZ999' },
      { ...newSl4Part('b'), nsn: '5305000000001', cage: 'ZZ999' },
      { ...newSl4Part('c'), nsn: '5905000000001', cage: 'AA999' },
      { ...newSl4Part('d'), nsn: '5905000000001', cage: 'AA999' },
    ];
    expect(buildSl4Indexes(data).partIII.map((r) => r.rowId)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('keeps leading zeros, punctuation, Unicode and original case in display text', () => {
    const data = emptySl4();
    data.rows = ['001', '01', 'A-02', 'a-01', 'A10', 'A2', 'épreuve'].map((partNumber, i) => ({ ...newSl4Part(String(i)), partNumber }));
    expect(buildSl4Indexes(data).partIV.map((r) => r.partNumber)).toEqual(['001', '01', 'a-01', 'A-02', 'A10', 'A2', 'épreuve']);
  });

  it('treats whitespace-only identifiers as unassigned', () => {
    const data = emptySl4();
    data.rows = [{ ...newSl4Part('a'), nsn: '  ', partNumber: ' ' }];
    const indexes = buildSl4Indexes(data);
    expect(indexes.partII).toHaveLength(1);
    expect(indexes.partIII).toHaveLength(0);
    expect(indexes.partIV).toHaveLength(0);
  });

  it('rebuilds item numbers after insertion, deletion and reordering without changing source records', () => {
    const data = emptySl4();
    data.rows = [{ ...newSl4Part('a'), partNumber: 'PN-A' }, { ...newSl4Part('b'), partNumber: 'PN-B' }];
    const before = structuredClone(data);
    const indexes = buildSl4Indexes(data);
    expect(data).toEqual(before);
    data.rows.unshift(newSl4Part('inserted'));
    expect(buildSl4Indexes(data).partIV.find((r) => r.rowId === 'b')?.itemNumber).toBe(3);
    data.rows = [data.rows[2], data.rows[0]];
    expect(buildSl4Indexes(data).partIV).toEqual([expect.objectContaining({ rowId: 'b', itemNumber: 1 })]);
    expect(indexes.partIV.find((r) => r.rowId === 'b')?.itemNumber).toBe(2);
  });

  it('carries row markings into every derived record and emits multiple symbols per part', () => {
    const data = sl4Example();
    Object.assign(data.rows[4], { portionMarking: 'S', circuitSymbols: ['R1', 'R3'] });
    const indexes = buildSl4Indexes(data);
    expect(indexes.partIII.find((r) => r.rowId === 'resistor')?.portionMarking).toBe('S');
    expect(indexes.partIV.find((r) => r.rowId === 'resistor')?.portionMarking).toBe('S');
    expect(indexes.partV.filter((r) => r.rowId === 'resistor').map((r) => r.portionMarking)).toEqual(['S', 'S']);
    data.circuitIndex.mode = 'omitted_excessive';
    expect(buildSl4Indexes(data).partV).toEqual([]);
    data.circuitIndex.mode = 'not_applicable';
    expect(buildSl4Indexes(data).partV).toEqual([]);
  });

  it('refuses ambiguous stable IDs', () => {
    const data = emptySl4(); data.rows = [newSl4Part('a'), newSl4Part('a')];
    expect(() => buildSl4Indexes(data)).toThrow('unique');
  });

  it('partitions generated records by NSN presence without losing or inventing items', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { maxLength: 200 }), (assigned) => {
      const data = emptySl4();
      data.rows = assigned.map((hasNsn, i) => ({ ...newSl4Part(String(i)), nsn: hasNsn ? '5305-00-000-0001' : '', partNumber: i % 2 ? 'TRAIN-PN' : '' }));
      const indexes = buildSl4Indexes(data);
      const all = [...indexes.partII, ...indexes.partIII];
      expect(all.map((r) => r.itemNumber).sort((a, b) => a - b)).toEqual(assigned.map((_, i) => i + 1));
      expect(indexes.partII.every((r) => !assigned[r.itemNumber - 1])).toBe(true);
      expect(indexes.partIII.every((r) => assigned[r.itemNumber - 1])).toBe(true);
      expect(indexes.partIV).toHaveLength(assigned.filter((_, i) => i % 2).length);
    }), { seed: 441023, numRuns: 100 });
  });
});

describe('SL-4 repeated index panels', () => {
  it.each([2, 3] as const)('flows down %i panels before starting another page', (panels) => {
    const records = Array.from({ length: panels * 55 + 1 }, (_, i) => i + 1);
    const pages = sl4IndexPanels(records, 55, panels);
    expect(pages).toHaveLength(2);
    expect(pages[0][0]).toEqual(records.slice(0, 55));
    expect(pages[0][1][0]).toBe(56);
    expect(pages[1][0]).toEqual([panels * 55 + 1]);
    expect(pages.flat(2)).toEqual(records);
    expect(pages[1].slice(1).flat()).toEqual([]);
  });

  it('has no fake records for an empty index and supports measured smaller capacities', () => {
    expect(sl4IndexPanels([], 55, 2)).toEqual([]);
    expect(sl4IndexPanels([1, 2, 3, 4, 5], 2, 2)).toEqual([[[1, 2], [3, 4]], [[5], []]]);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid panel capacity %s', (capacity) => {
    expect(() => sl4IndexPanels([1], capacity, 2)).toThrow('capacity');
  });
});
