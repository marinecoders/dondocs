import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { planReferenceChange, type ReferenceSource } from '@/lib/referenceCitations';
import { referenceLetterAt } from '@/lib/referenceLetters';

describe('reference target preservation', () => {
  it('preserves every repeated citation target across permutations and label-length changes', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 36 }),
      fc.integer({ min: 0, max: 25 }),
      fc.array(fc.nat(), { minLength: 36, maxLength: 36 }),
      (count, offset, priorities) => {
        const references = Array.from({ length: count }, (_, index) => ({
          letter: referenceLetterAt(index + offset), title: 'Same title', url: `https://example.com/source/${index}`,
        }));
        const targets = [...references, ...references.slice().reverse()];
        const source: ReferenceSource = {
          documentCategory: 'correspondence', documentMode: 'compliant',
          docType: offset ? 'same_page_endorsement' : 'naval_letter',
          formData: { startingReferenceLetter: referenceLetterAt(offset) }, references,
          paragraphs: [{ text: targets.map((ref, index) => `Use reference (${index % 2 ? ref.letter.toUpperCase() : ref.letter}).`).join(' '), level: 0 }],
          copyTos: [], distributions: [],
        };
        const order = references.map((_, index) => index).sort((a, b) => priorities[a] - priorities[b]);
        const plan = planReferenceChange(source, order);
        expect(plan.blockers).toEqual([]);
        expect(plan.advisories).toEqual([]);
        const text = plan.patch.paragraphs?.[0].text ?? source.paragraphs[0].text;
        const labels = [...text.matchAll(/reference \(([^)]+)\)/gi)].map(match => match[1].toLowerCase());
        expect(labels.map(label => plan.references.find(ref => ref.letter === label)?.url)).toEqual(targets.map(ref => ref.url));
        expect(source.references).toEqual(references);
      },
    ), { numRuns: 250, seed: 20261113 });
  });

  it('flags an inherited bare label when a new local sequence would claim it', () => {
    const source: ReferenceSource = {
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'same_page_endorsement',
      formData: { startingReferenceLetter: 'g' }, references: [{ letter: 'g', title: 'Local directive' }],
      paragraphs: [{ text: 'Follow (a), then reference (g).', level: 0 }], copyTos: [], distributions: [],
    };
    const plan = planReferenceChange(source, [0], 0);
    expect([...plan.blockers, ...plan.advisories].join(' ')).toContain('(a)');
  });

  it.each([
    'He wrote "Follow reference (b).\nKeep this quotation unchanged."',
    "He wrote 'Follow reference (b).\nKeep this quotation unchanged.'",
    'Read HTTPS://example.com/ref(b)',
  ])('blocks rewriting a citation inside a protected literal: %s', text => {
    const source: ReferenceSource = {
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formData: {},
      references: [{ letter: 'a', title: 'Alpha' }, { letter: 'b', title: 'Bravo' }],
      paragraphs: [{ text, level: 0 }], copyTos: [], distributions: [],
    };
    expect(planReferenceChange(source, [1, 0]).blockers.length).toBeGreaterThan(0);
  });
});
