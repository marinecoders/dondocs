/**
 * The Document Finder is a branching interview that maps a user's answers to one
 * or more recommended document types. Its whole job is coverage: a clerk who
 * doesn't know what they need must still be steerable to ANY of the 19 types.
 *
 * A prior version of the decision tree silently stranded four types —
 * joint_letter, joint_memorandum, navmc_10274, navmc_118_11 — unreachable across
 * all answer combinations. These tests enumerate every reachable answer path
 * (respecting the conditional skips in the flow) and assert that:
 *   - every one of the 19 catalogued types is recommended somewhere,
 *   - the four formerly-dead types each get a high-confidence path,
 *   - every recommended id is real, every leaf returns 1-3 results, and the
 *     first result is always the high-confidence "best match".
 * If a future edit re-orphans a type, this fails instead of shipping a finder
 * that quietly can't reach it.
 */
import { describe, it, expect } from 'vitest';
import {
  getNextQuestion,
  getRecommendations,
} from '@/components/modals/documentFinderLogic';
import { DOCUMENT_TYPE_GUIDES } from '@/data/documentGuide';

type Answers = Record<string, string>;
interface Leaf {
  answers: Answers;
  results: ReturnType<typeof getRecommendations>;
}

/**
 * Depth-first walk of the interview: at each node ask getNextQuestion for the
 * next question, branch on each of its options, and record getRecommendations
 * once the interview is exhausted (getNextQuestion → null). This visits exactly
 * the answer paths a real user can produce, including skipped questions.
 */
function enumerateLeaves(answers: Answers = {}): Leaf[] {
  const q = getNextQuestion(answers);
  if (!q) return [{ answers, results: getRecommendations(answers) }];
  return q.options.flatMap((opt) =>
    enumerateLeaves({ ...answers, [q.id]: opt.value })
  );
}

const ALL_IDS = DOCUMENT_TYPE_GUIDES.map((g) => g.id);
const leaves = enumerateLeaves();
const everyResult = leaves.flatMap((l) => l.results);
const recommendedIds = new Set(everyResult.map((r) => r.docType));
const highIds = new Set(
  everyResult.filter((r) => r.confidence === 'high').map((r) => r.docType)
);

describe('document finder — coverage', () => {
  it('enumerates a non-trivial answer space', () => {
    // Sanity: the DFS actually explores many distinct paths (guards against an
    // accidental early-return that would make the other assertions vacuous).
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('the catalogue has all 19 expected types', () => {
    expect(ALL_IDS).toHaveLength(19);
  });

  it('every catalogued document type is reachable', () => {
    const unreachable = ALL_IDS.filter((id) => !recommendedIds.has(id));
    expect(unreachable).toEqual([]);
  });

  it('the four formerly-dead types each have a high-confidence path', () => {
    for (const id of ['joint_letter', 'joint_memorandum', 'navmc_10274', 'navmc_118_11']) {
      expect(highIds.has(id)).toBe(true);
    }
  });

  it('never recommends an id that is not in the catalogue', () => {
    const known = new Set(ALL_IDS);
    const bogus = [...recommendedIds].filter((id) => !known.has(id));
    expect(bogus).toEqual([]);
  });
});

describe('document finder — result invariants', () => {
  it('every completed interview returns 1 to 3 results', () => {
    for (const leaf of leaves) {
      expect(leaf.results.length).toBeGreaterThanOrEqual(1);
      expect(leaf.results.length).toBeLessThanOrEqual(3);
    }
  });

  it('the first result is always the high-confidence best match', () => {
    for (const leaf of leaves) {
      expect(leaf.results[0].confidence).toBe('high');
    }
  });

  it('every best-match reason cites a SECNAV chapter or MCO', () => {
    // High-confidence picks must justify themselves with doctrine; the medium
    // "alternative" reasons are phrased as guidance ("Use X instead if …").
    for (const r of everyResult.filter((x) => x.confidence === 'high')) {
      expect(r.reason).toMatch(/^Per (Ch \d+|MCO P1070\.12K):/);
    }
  });
});

describe('document finder — key branches', () => {
  const recs = (a: Answers) => getRecommendations(a).map((r) => r.docType);

  it('Marine Corps form → Page 11 entry yields NAVMC 118(11)', () => {
    expect(recs({ category: 'usmc_form', formType: 'page11' })[0]).toBe('navmc_118_11');
  });

  it('Marine Corps form → admin action yields NAVMC 10274', () => {
    expect(recs({ category: 'usmc_form', formType: 'adminAction' })[0]).toBe('navmc_10274');
  });

  it('for-the-record yields an MFR and does not inject a USMC form', () => {
    const r = recs({ category: 'record' });
    expect(r[0]).toBe('mfr');
    expect(r).not.toContain('navmc_118_11');
  });

  it('two commands co-signing outgoing correspondence → joint letter', () => {
    const r = recs({
      category: 'correspondence',
      recipient: 'military',
      jointSignature: 'yes',
      purpose: 'request',
      routing: 'via',
      formality: 'formal',
    });
    expect(r[0]).toBe('joint_letter');
  });

  it('two commands co-signing an internal position → joint memorandum', () => {
    const r = recs({
      category: 'correspondence',
      recipient: 'military',
      jointSignature: 'yes',
      purpose: 'inform',
      routing: 'internal',
      formality: 'formal',
    });
    expect(r[0]).toBe('joint_memorandum');
  });

  it('agreement committing resources → MOA over MOU', () => {
    const r = recs({ category: 'correspondence', recipient: 'military', jointSignature: 'no', purpose: 'agreement', resources: 'yes' });
    expect(r[0]).toBe('moa');
    expect(r).toContain('mou');
  });

  it('agreement framing roles → MOU over MOA', () => {
    const r = recs({ category: 'correspondence', recipient: 'military', jointSignature: 'no', purpose: 'agreement', resources: 'no' });
    expect(r[0]).toBe('mou');
    expect(r).toContain('moa');
  });

  it('civilian recipient → business letter', () => {
    expect(recs({ category: 'correspondence', recipient: 'civilian', purpose: 'request', routing: 'direct', formality: 'formal' })[0]).toBe('business_letter');
  });

  it('formal internal information → Memorandum For leads', () => {
    const r = recs({ category: 'correspondence', recipient: 'military', jointSignature: 'no', purpose: 'inform', routing: 'internal', formality: 'formal' });
    expect(r[0]).toBe('mf');
  });
});
