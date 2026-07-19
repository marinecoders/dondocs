import { describe, it, expect } from 'vitest';
import { suggestRouting } from '@/lib/suggestRouting';
import { ACTION_ROUTING } from '@/data/actionRouting';

describe('suggestRouting — detection from Nature of Action text', () => {
  it('routes a dependency action to the dependents category', () => {
    const [top] = suggestRouting('Request BAH-with-dependents rate for newly added dependent');
    expect(top.id).toBe('dependents');
  });

  it('routes a reenlistment/SRB action to the career planner', () => {
    const [top] = suggestRouting('Request reenlistment and SRB for retention');
    expect(top.id).toBe('reenlistment');
  });

  it('routes a TAD request to the TAD category', () => {
    const [top] = suggestRouting('Request TAD travel via DTS');
    expect(top.id).toBe('tad');
  });

  it('routes a records correction to HQMC MMSB', () => {
    const [top] = suggestRouting('Request OMPF records correction to DD214');
    expect(top).toMatchObject({ id: 'records', level: 'hqmc' });
  });

  it('returns nothing for blank input', () => {
    expect(suggestRouting('')).toEqual([]);
    expect(suggestRouting('   ')).toEqual([]);
  });

  it('returns nothing when no keyword matches', () => {
    expect(suggestRouting('Miscellaneous request with no routing cues')).toEqual([]);
  });

  it('ranks the more specific match first when several apply', () => {
    // Two dependents cues vs one pay cue → dependents leads.
    const routes = suggestRouting('Update DEERS dependent information and pay');
    expect(routes[0].id).toBe('dependents');
    expect(routes.map((r) => r.id)).toContain('pay');
  });
});

describe('suggestRouting — whole-word matching (no false positives)', () => {
  it('does not fire "eas" inside "please" or "pay" inside "display"', () => {
    expect(suggestRouting('Please display the current roster')).toEqual([]);
  });

  it('does not fire "leave" inside "cleaves"', () => {
    expect(suggestRouting('The unit cleaves to standard')).toEqual([]);
  });
});

describe('actionRouting — data integrity', () => {
  it('every route has a stable id, category, destination, and at least one keyword', () => {
    for (const r of ACTION_ROUTING) {
      expect(r.id).toMatch(/^[a-z_]+$/);
      expect(r.category).toBeTruthy();
      expect(r.destination).toBeTruthy();
      expect(r.keywords.length).toBeGreaterThan(0);
      expect(['local', 'hqmc']).toContain(r.level);
    }
  });

  it('ids are unique', () => {
    const ids = ACTION_ROUTING.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
