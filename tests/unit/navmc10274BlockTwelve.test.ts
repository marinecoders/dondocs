/**
 * Block 12 of the NAVMC 10274 carries the counseling text, the proposed
 * action (the printed form has no box for it — fields run 1-12), and the
 * signature blocks in one paginating line stream. The form's own caption is
 * the layout spec: "type name of originator and sign 3 lines below text" —
 * each typed name sits on the third line below what precedes it, and the two
 * blank lines above it are that signer's signing space.
 *
 * Counseling actions routinely carry two or three signatures (originator, the
 * counseled Marine's acknowledgement, sometimes a witness), so the compose
 * model is a list — and pagination must never tear a signature block: a typed
 * name at the top of the continuation page with its signing space left behind
 * on the previous page cannot be signed.
 *
 * These pin composition and pagination; the rendered geometry is proved in
 * tests/integration/navmc10274-render.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  composeBlockTwelveLines,
  paginateBlockTwelve,
} from '@/services/pdf/navmc10274Generator';

const noSignatures: Array<{ statement: string[]; name: string }> = [];

describe('composeBlockTwelveLines', () => {
  it('places a lone signature name on the third line below the text', () => {
    const { lines } = composeBlockTwelveLines({
      supplementalInfo: ['Paragraph one.', 'Paragraph two.'],
      proposedAction: [],
      signatureBlocks: [{ statement: [], name: 'R. L. SMITH' }],
    });
    expect(lines).toEqual(['Paragraph one.', 'Paragraph two.', '', '', 'R. L. SMITH']);
  });

  it('appends the proposed action as a separated paragraph before signatures', () => {
    const { lines } = composeBlockTwelveLines({
      supplementalInfo: ['Text.'],
      proposedAction: ['Proposed/recommended action: NJP.'],
      signatureBlocks: [{ statement: [], name: 'R. L. SMITH' }],
    });
    expect(lines).toEqual([
      'Text.',
      '',
      'Proposed/recommended action: NJP.',
      '',
      '',
      'R. L. SMITH',
    ]);
  });

  it('stacks three signature blocks with statements in signing order', () => {
    const { lines, groups } = composeBlockTwelveLines({
      supplementalInfo: ['Counseling text.'],
      proposedAction: [],
      signatureBlocks: [
        { statement: [], name: 'R. L. SMITH' },
        { statement: ['I acknowledge receipt of this counseling.'], name: 'J. A. DOE' },
        { statement: ['Witnessed:'], name: 'M. B. JONES' },
      ],
    });
    expect(lines).toEqual([
      'Counseling text.',
      '',
      '',
      'R. L. SMITH',
      '',
      'I acknowledge receipt of this counseling.',
      '',
      '',
      'J. A. DOE',
      '',
      'Witnessed:',
      '',
      '',
      'M. B. JONES',
    ]);
    // Each group ends on its own typed name.
    expect(groups).toHaveLength(3);
    expect(lines[groups[0].end]).toBe('R. L. SMITH');
    expect(lines[groups[1].end]).toBe('J. A. DOE');
    expect(lines[groups[2].end]).toBe('M. B. JONES');
  });

  it('skips blocks that carry neither statement nor name', () => {
    const { lines, groups } = composeBlockTwelveLines({
      supplementalInfo: ['Text.'],
      proposedAction: [],
      signatureBlocks: [
        { statement: [], name: '' },
        { statement: [], name: 'R. L. SMITH' },
      ],
    });
    expect(lines).toEqual(['Text.', '', '', 'R. L. SMITH']);
    expect(groups).toHaveLength(1);
  });

  it('renders nothing extra when there are no signatures', () => {
    const { lines, groups } = composeBlockTwelveLines({
      supplementalInfo: ['Text.'],
      proposedAction: [],
      signatureBlocks: noSignatures,
    });
    expect(lines).toEqual(['Text.']);
    expect(groups).toHaveLength(0);
  });

  it('starts at the top when there is no text above the signature', () => {
    const { lines } = composeBlockTwelveLines({
      supplementalInfo: [],
      proposedAction: [],
      signatureBlocks: [{ statement: [], name: 'R. L. SMITH' }],
    });
    expect(lines).toEqual(['R. L. SMITH']);
  });
});

describe('paginateBlockTwelve', () => {
  const compose = (fillerLines: number) =>
    composeBlockTwelveLines({
      supplementalInfo: Array.from({ length: fillerLines }, (_, i) => `Line ${i + 1}.`),
      proposedAction: [],
      signatureBlocks: [
        { statement: [], name: 'R. L. SMITH' },
        { statement: ['I acknowledge receipt.'], name: 'J. A. DOE' },
      ],
    });

  it('leaves everything on the page when it fits', () => {
    const result = paginateBlockTwelve(compose(3), 29);
    expect(result.continuationLines).toEqual([]);
  });

  it('never tears a signature block across the boundary', () => {
    // Sweep filler so the naive split lands on every line of both signature
    // blocks at least once; whichever block straddles must move whole.
    for (let filler = 15; filler <= 29; filler++) {
      const composed = compose(filler);
      const { pageLines, continuationLines } = paginateBlockTwelve(composed, 29);
      const tornAck =
        pageLines.includes('I acknowledge receipt.') !== pageLines.includes('J. A. DOE');
      expect(tornAck, `filler=${filler}: statement and name split apart`).toBe(false);
      // A moved name always brings its signing gap: it is never the first
      // line of the continuation page.
      if (continuationLines.length > 0) {
        expect(continuationLines[continuationLines.length - 1]).not.toBe('');
      }
      for (const name of ['R. L. SMITH', 'J. A. DOE']) {
        if (continuationLines[0] === name) {
          throw new Error(`filler=${filler}: ${name} orphaned at top of continuation`);
        }
      }
      // Nothing lost or duplicated across the split.
      const joined = [...pageLines, ...continuationLines].filter((l) => l !== '');
      const original = composed.lines.filter((l) => l !== '');
      expect(joined).toEqual(original);
    }
  });

  it('splits plain text at capacity when no group straddles', () => {
    const composed = composeBlockTwelveLines({
      supplementalInfo: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`),
      proposedAction: [],
      signatureBlocks: noSignatures,
    });
    const { pageLines, continuationLines } = paginateBlockTwelve(composed, 29);
    expect(pageLines).toHaveLength(29);
    expect(continuationLines[0]).toBe('Line 30.');
  });
});

describe('digital signature field placements', () => {
  it('places a main-page field at the name line index within the page', () => {
    // lines: [text, '', '', SMITH]  → SMITH at index 3, on the main page.
    const composed = composeBlockTwelveLines({
      supplementalInfo: ['Counseling text.'],
      proposedAction: [],
      signatureBlocks: [{ statement: [], name: 'R. L. SMITH', style: 'digital' }],
    });
    const { fieldPlacements, pageLines } = paginateBlockTwelve(composed, 29);
    expect(fieldPlacements).toHaveLength(1);
    expect(fieldPlacements[0].page).toBe('main');
    // The placement's line index must point at the name in the page stream.
    expect(pageLines[fieldPlacements[0].nameLineInPage]).toBe('R. L. SMITH');
  });

  it('emits no field for a non-digital block', () => {
    const composed = composeBlockTwelveLines({
      supplementalInfo: ['Text.'],
      proposedAction: [],
      signatureBlocks: [{ statement: [], name: 'R. L. SMITH' }],
    });
    expect(paginateBlockTwelve(composed, 29).fieldPlacements).toEqual([]);
  });

  it('follows a block onto the continuation page — index resolves there, not on the main page', () => {
    // 23 filler lines force the second (digital) block to straddle → it moves
    // whole to the continuation page, and its field must resolve THERE.
    const composed = composeBlockTwelveLines({
      supplementalInfo: Array.from({ length: 23 }, (_, i) => `Line ${i + 1}.`),
      proposedAction: [],
      signatureBlocks: [
        { statement: [], name: 'R. L. SMITH', style: 'digital' },
        { statement: ['I acknowledge receipt.'], name: 'T. R. OAKES', style: 'digital' },
      ],
    });
    const { fieldPlacements, pageLines, continuationLines } = paginateBlockTwelve(composed, 29);
    const byName = (page: string[], p: { nameLineInPage: number }) => page[p.nameLineInPage];

    const main = fieldPlacements.filter((f) => f.page === 'main');
    const cont = fieldPlacements.filter((f) => f.page === 'continuation');
    expect(main).toHaveLength(1);
    expect(cont).toHaveLength(1);
    // Each placement indexes the correct name in its own page's stream — the
    // regression that would strand a field on the wrong page fails here.
    expect(byName(pageLines, main[0])).toBe('R. L. SMITH');
    expect(byName(continuationLines, cont[0])).toBe('T. R. OAKES');
  });
});
