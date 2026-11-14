import { describe, expect, it } from 'vitest';
import { compareSessions, diffSessions } from '@/lib/sessionDiff';
import { createBlankSession } from '@/stores/documentStore';
import { captureChangeReport, prepareChangeReport, renderChangeReport } from '@/lib/changeReport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import type { Paragraph } from '@/types/document';

const paragraph = (id: string, text = `${id} content`): Paragraph => ({ id, text, level: 0 });
const session = (paragraphs: Paragraph[]) => ({ ...createBlankSession(), paragraphs });
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

describe('paragraph identity comparisons', () => {
  it('reports a move without turning unchanged paragraphs into replacement prose', () => {
    const before = session([paragraph('alpha'), paragraph('bravo'), paragraph('charlie')]);
    const after = { ...before, paragraphs: [before.paragraphs[2], before.paragraphs[0], before.paragraphs[1]] };
    const comparison = compareSessions(before, after);
    expect(comparison.changes).toEqual([{ field: 'Paragraphs › 3 → 1 › Movement', before: 'Position 3', after: 'Position 1', kind: 'move' }]);
    expect(comparison.notices.join(' ')).toContain('automatic renumbering');
    expect(comparison.notices.join(' ')).toContain('one minimum reordering');
    expect(JSON.stringify(comparison)).not.toContain('charlie');
    expect(diffSessions(after, before)).toEqual([{ field: 'Paragraphs › 1 → 3 › Movement', before: 'Position 1', after: 'Position 3', kind: 'move' }]);
  });

  it('keeps edits and structured properties attached to the moved identity', () => {
    const before = session([paragraph('alpha'), paragraph('bravo'), { ...paragraph('charlie', 'Original 🪸 café'), header: 'Original heading' }]);
    const after = { ...before, paragraphs: [{ ...before.paragraphs[2], text: 'Revised 🪸 café', header: 'Revised heading', level: 1 }, ...before.paragraphs.slice(0, 2)] };
    const changes = diffSessions(before, after);
    expect(changes.filter(change => change.kind === 'move')).toHaveLength(1);
    expect(changes).toEqual(expect.arrayContaining([
      { field: 'Paragraphs › 3 → 1 › Text', before: 'Original 🪸 café', after: 'Revised 🪸 café' },
      { field: 'Paragraphs › 3 → 1 › Header', before: 'Original heading', after: 'Revised heading' },
      { field: 'Paragraphs › 3 → 1 › Level', before: '0', after: '1' },
    ]));
  });

  it('distinguishes identical text by identity and does not invent a center move during reversal', () => {
    const before = session(['alpha', 'bravo', 'charlie'].map(id => paragraph(id, 'Same text')));
    const after = { ...before, paragraphs: [...before.paragraphs].reverse() };
    const changes = diffSessions(before, after);
    expect(changes).toHaveLength(2);
    expect(changes.every(change => change.kind === 'move')).toBe(true);
    expect(changes.some(change => change.before === change.after)).toBe(false);
    expect(changes.some(change => change.before === 'Position 2')).toBe(false);
  });

  it('describes changed relative order at an unchanged position without claiming a move 3 to 3', () => {
    const before = session(['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(id => paragraph(id)));
    const after = { ...before, paragraphs: [3, 4, 2, 0, 1].map(index => before.paragraphs[index]) };
    const changes = diffSessions(before, after);
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ field: 'Paragraphs › 3 › Relative order', before: 'Position 3', after: 'Position 3 (relative order changed)', kind: 'context' });
    expect(changes.filter(change => change.kind === 'move')).toHaveLength(2);
    expect(changes.some(change => change.field.includes('3 → 3'))).toBe(false);
  });

  it('treats insertion and deletion shifts as structure, with complete added/removed values', () => {
    const before = session([paragraph('alpha'), paragraph('bravo')]);
    const inserted = { ...before, paragraphs: [paragraph('new', 'Inserted <text> 🪸'), ...before.paragraphs] };
    const changes = diffSessions(before, inserted);
    expect(changes.filter(change => change.kind === 'insert')).toHaveLength(1);
    expect(changes.some(change => change.after === 'Inserted <text> 🪸')).toBe(true);
    expect(changes.some(change => change.kind === 'move')).toBe(false);
    expect(changes.some(change => change.before === 'alpha content' || change.before === 'bravo content')).toBe(false);
    const removal = diffSessions(inserted, before);
    expect(removal.filter(change => change.kind === 'remove')).toHaveLength(1);
    expect(removal.some(change => change.before === 'Inserted <text> 🪸')).toBe(true);
    expect(removal.some(change => change.kind === 'move')).toBe(false);
    expect(diffSessions(session([]), before).filter(change => change.kind === 'insert')).toHaveLength(2);
    expect(diffSessions(before, session([])).filter(change => change.kind === 'remove')).toHaveLength(2);
  });

  it('keeps replacement identities distinct when they occur among retained nodes', () => {
    const before = session([paragraph('keep'), paragraph('removed', 'Same text')]);
    const after = { ...before, paragraphs: [before.paragraphs[0], paragraph('replacement', 'Same text')] };
    const kinds = diffSessions(before, after).map(change => change.kind);
    expect(kinds).toContain('insert');expect(kinds).toContain('remove');expect(kinds).not.toContain('move');
  });

  it.each(['missing', 'duplicate', 'invalid', 'unrelated'] as const)('uses explicit positional fallback for %s identities', kind => {
    const before = session([paragraph('alpha'), paragraph('bravo')]);
    const after = structuredClone(before);
    if (kind === 'missing') delete after.paragraphs[0].id;
    if (kind === 'duplicate') after.paragraphs[1].id = 'alpha';
    if (kind === 'invalid') after.paragraphs[0].id = 'not a valid identity';
    if (kind === 'unrelated') after.paragraphs.forEach((p, i) => { p.id = `new-${i}`; });
    const result = compareSessions(before, after);
    expect(result.changes).toEqual([]);
    expect(result.notices.join(' ')).toContain('compared by position');
    after.paragraphs.reverse();
    expect(compareSessions(before, after).changes.filter(change => change.field.endsWith('Text'))).toHaveLength(2);
    expect(compareSessions(before, after).changes.some(change => change.kind === 'move')).toBe(false);
  });

  it('does not add paragraph identity warnings to configured-form comparisons', () => {
    const before = { ...session([paragraph('alpha')]), documentCategory: 'forms' as const };
    const after = structuredClone(before);delete after.paragraphs[0].id;
    expect(compareSessions(before, after)).toEqual({ changes: [], notices: [] });
  });

  it.each([null, undefined])('falls back safely when a historical paragraph entry is %s', missing => {
    const before = session([paragraph('alpha'), paragraph('bravo')]);
    const after = structuredClone(before);after.paragraphs[0] = missing as never;
    const comparison = compareSessions(before, after);
    expect(comparison.notices.join(' ')).toContain('compared by position');
    expect(comparison.changes.some(change => change.kind === 'move')).toBe(false);
  });

  it('handles long retained sequences without a quadratic comparison table', () => {
    const before = session(Array.from({ length: 12_000 }, (_, index) => paragraph(`node-${index}`)));
    const after = { ...before, paragraphs: [before.paragraphs.at(-1)!, ...before.paragraphs.slice(0, -1)] };
    expect(diffSessions(before, after)).toEqual([{ field: 'Paragraphs › 12000 → 1 › Movement', before: 'Position 12000', after: 'Position 1', kind: 'move' }]);
  });

  it('finds a minimum reordering across every permutation of five retained paragraphs', () => {
    const before = session(['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(id => paragraph(id)));
    const permutations = (values: number[]): number[][] => values.length
      ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(tail => [value, ...tail])) : [[]];
    for (const order of permutations([0, 1, 2, 3, 4])) {
      // Independent oracle: enumerate every possible stationary subsequence.
      let longest = 0;
      for (let mask = 0; mask < 32; mask++) {
        const positions = [0, 1, 2, 3, 4].filter(index => mask & (1 << index)).map(index => order.indexOf(index));
        if (positions.every((position, index) => index === 0 || position > positions[index - 1])) longest = Math.max(longest, positions.length);
      }
      const changes = diffSessions(before, { ...before, paragraphs: order.map(index => before.paragraphs[index]) });
      expect(changes).toHaveLength(5 - longest);
      expect(changes.every(change => (change.kind === 'move' || change.kind === 'context') && change.before !== change.after)).toBe(true);
    }
  });
});

describe('movement in sanitized change reports', () => {
  it('uses private identities without exposing them or requesting marking review for comparison notes', () => {
    const before = session([paragraph('private-alpha'), paragraph('private-bravo'), paragraph('private-charlie', 'Original 🪸')]);
    const after = { ...before, paragraphs: [{ ...before.paragraphs[2], text: 'Revised <text> 🪸' }, ...before.paragraphs.slice(0, 2)] };
    const report = prepareChangeReport(captureChangeReport(
      { label: 'Before', title: 'Saved', session: before }, { label: 'After', title: 'Current', session: after }, '2026-11-14T00:00:00.000Z'), policy);
    expect(report.changes.filter(change => change.kind === 'move')).toHaveLength(1);
    expect(report.changes).toContainEqual({ field: 'Paragraphs › 3 → 1 › Text', before: 'Original 🪸', after: 'Revised <text> 🪸' });
    const html = renderChangeReport(report);
    for (const id of ['private-alpha', 'private-bravo', 'private-charlie']) {
      expect(html).not.toContain(id);expect(JSON.stringify(report)).not.toContain(id);
    }
    expect(html).toContain('Revised &lt;text&gt; 🪸');
    expect(html).toContain('2 comparison items.');
    expect(report.marking).not.toContain('MARKING REVIEW REQUIRED');
    expect(report.notices.join(' ')).toContain('one minimum reordering');
  });
});
