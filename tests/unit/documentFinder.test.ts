/**
 * The Document Finder is a branching interview that maps a user's answers to one
 * or more recommended document types. Its whole job is coverage: a clerk who
 * doesn't know what they need must still be steerable to ANY supported type.
 *
 * A prior version of the decision tree silently stranded four types —
 * joint_letter, joint_memorandum, navmc_10274, navmc_118_11 — unreachable across
 * all answer combinations. These tests enumerate every reachable answer path
 * (respecting the conditional skips in the flow) and assert that:
 *   - every catalogued type is recommended somewhere,
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
  splitReason,
  DOC_DIFFERENTIATORS,
  QUESTIONS,
} from '@/components/modals/documentFinderLogic';
import { DOC_TYPE_LABELS, FORM_TYPE_LABELS } from '@/types/document';
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

const AUTHORITIES: Record<string, string> = {
  naval_letter: 'Ch 7', standard_letter: 'Ch 7', business_letter: 'Ch 11',
  multiple_address_letter: 'Ch 8', joint_letter: 'Ch 7', joint_memorandum: 'Ch 7',
  same_page_endorsement: 'Ch 9', new_page_endorsement: 'Ch 9',
  mfr: 'Ch 10', mf: 'MCO 5216.20B',
  plain_paper_memorandum: 'Ch 10', letterhead_memorandum: 'Ch 10', decision_memorandum: 'Ch 10',
  moa: 'Ch 10, para 10-2.6', mou: 'Ch 10, para 10-2.6',
  executive_memorandum: 'Ch 12', executive_correspondence: 'Ch 12',
  standard_memorandum: 'Ch 12', action_memorandum: 'Ch 12', information_memorandum: 'Ch 12',
  navmc_118_11: 'MCO P1070.12K', navmc_10274: 'MCO 5216.19A',
  sl3: 'MCO 5215.17D', sl4: 'MCO 5215.17D', tm_ietm_front_matter: 'MCO 5215.17D', i_type: 'MCO 5215.17D',
};

describe('document finder — coverage', () => {
  it('enumerates a non-trivial answer space', () => {
    // Sanity: the DFS actually explores many distinct paths (guards against an
    // accidental early-return that would make the other assertions vacuous).
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('the catalogue matches every supported format', () => {
    expect([...ALL_IDS].sort()).toEqual([...Object.keys(DOC_TYPE_LABELS), ...Object.keys(FORM_TYPE_LABELS)].sort());
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

  it('each headquarters format has a high-confidence path', () => {
    for (const id of ['standard_memorandum', 'action_memorandum', 'information_memorandum']) {
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

  it('every cited recommendation names the authority for that document type', () => {
    expect(Object.keys(AUTHORITIES).sort()).toEqual([...ALL_IDS].sort());
    for (const r of everyResult) {
      const { cite } = splitReason(r.reason);
      if (r.confidence === 'high' || cite !== null) {
        expect(cite, `${r.docType}: ${r.reason}`).toBe(AUTHORITIES[r.docType]);
      }
    }
  });

  it.each(['yes', 'no', 'unsure'])('the agreement resources=%s path cites paragraph 10-2.6', (resources) => {
    const results = getRecommendations({ category: 'correspondence', purpose: 'agreement', resources });
    expect(splitReason(results[0].reason).cite).toBe('Ch 10, para 10-2.6');
  });

  it('the format guide agrees with the finder authorities', () => {
    for (const guide of DOCUMENT_TYPE_GUIDES) {
      const authority = AUTHORITIES[guide.id];
      const prefix = authority.startsWith('Ch ')
        ? `SECNAV M-5216.5, Chapter ${authority.slice(3).split(',')[0]}`
        : authority;
      expect(guide.reference, guide.id).toContain(prefix);
    }
  });

  it('does not attribute a resource or legal-binding distinction to Chapter 10', () => {
    const agreementText = [
      QUESTIONS.resources.help,
      DOC_DIFFERENTIATORS.moa, DOC_DIFFERENTIATORS.mou,
      ...['yes', 'no', 'unsure'].flatMap((resources) => getRecommendations({
        category: 'correspondence', purpose: 'agreement', resources,
      }).map((result) => result.reason)),
      ...DOCUMENT_TYPE_GUIDES.filter((guide) => ['moa', 'mou'].includes(guide.id))
        .flatMap((guide) => [guide.summary, ...guide.keyFeatures]),
    ].join(' ');
    expect(agreementText).not.toMatch(/more binding|more formal and binding|lower-commitment|without committing resources|no resources|less formal than an MOA|does not commit specific resources/i);
    expect(QUESTIONS.resources.help).toContain('Both formats can document commitments');
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
