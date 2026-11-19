import { describe, expect, it } from 'vitest';
import { inspectEnclosureCitations } from '@/lib/enclosureCitations';

const one = { first: 1, count: 1, inherited: false };

describe('explicit enclosure citation clauses', () => {
  it.each(['See enclosures (1)-(2).', 'See enclosures (1) through (2).', 'See **enclosures** (1)–(2).'])('checks the complete bounded range: %s', text => {
    expect(inspectEnclosureCitations(text, one)).toEqual([expect.objectContaining({
      title: 'Check enclosure range (1)–(2)', message: expect.stringContaining('enclosure (2)'),
    })]);
  });

  it('checks semicolon lists alongside comma and conjunction lists', () => {
    const issues = inspectEnclosureCitations('See enclosures (1); (2), (3); and (4).', one);
    expect(issues.map(issue => issue.title)).toEqual(['Check enclosure (2)', 'Check enclosure (3)', 'Check enclosure (4)']);
  });

  it('checks huge safe ranges arithmetically and leaves unsafe integers for manual review', () => {
    const range = inspectEnclosureCitations('See enclosures (1)-(9007199254740991).', one);
    expect(range).toHaveLength(1);
    expect(range[0].message).toContain('enclosure (2)');
    for (const text of ['See enclosure (9007199254740992).', 'See enclosures (1)-(999999999999999999999999999999999999).']) {
      expect(inspectEnclosureCitations(text, one)).toEqual([expect.objectContaining({ title: 'Review the enclosure citation' })]);
    }
  });

  it('accepts inherited ranges but identifies missing new members', () => {
    const list = { first: 5, count: 1, inherited: true };
    expect(inspectEnclosureCitations('See enclosures (1) through (5).', list)).toEqual([]);
    expect(inspectEnclosureCitations('See enclosures (1) through (6).', list)[0].message).toContain('enclosure (6)');
  });

  it.each(['enclosures (2)-(1)', 'enclosures (1) through 2', 'enclosures (1): (2)', 'enclosure (1a)', 'enclosures (1)-(2)-(3)'])('reports unverifiable syntax instead of silently passing it: %s', text => {
    expect(inspectEnclosureCitations(text, { first: 1, count: 2, inherited: false }))
      .toEqual([expect.objectContaining({ title: 'Review the enclosure citation', message: expect.stringContaining('manually') })]);
  });

  it.each(['"enclosures (1)-(2)"', '`enclosures (1); (2)`', 'https://example.test/enclosure(2)', 'enclosure "example" (2)', 'enclosures (1) through `(2)`'])('preserves protected literals and boundaries: %s', text => {
    expect(inspectEnclosureCitations(text, one)).toEqual([]);
  });
  it.each(['Send enclosure (1) to the recipient.', 'See enclosure (1) - it explains the process.', 'Read enclosure (1) through the normal review process.'])('does not treat ordinary following prose as a numeric range: %s', text => {
    expect(inspectEnclosureCitations(text, one)).toEqual([]);
  });

  it('retains a visible missing starting citation when a protected endpoint is ignored', () => {
    expect(inspectEnclosureCitations('See enclosures (2) through `(3)`.', one).map(issue => issue.title))
      .toEqual(['Check enclosure (2)']);
  });

});
