/**
 * The DOCX same-page endorsement carries its serial and date (SECNAV
 * M-5216.5 Ch 9, Fig 9-1).
 *
 * Fig 9-1 puts "Ser 019/870" / "23 Apr 15" right-aligned between the rule
 * that separates the endorsement from the basic letter and the endorsement
 * line — Ch 9 ¶2.1a's same-page omission list covers the SSIC, subject, and
 * basic letter's identification symbols, not the endorsement's own date. The
 * PDF template prints them (\printDateAndTitle in same_page_endorsement.tex);
 * the flat generator emitted only the rule + endorsement line, so the DOCX
 * shipped an undated endorsement.
 */
import { describe, it, expect } from 'vitest';
import { generateFlatLatex } from '@/services/latex/flat-generator';

function store(formData: Record<string, string>) {
  return {
    docType: 'same_page_endorsement',
    formData: {
      docType: 'same_page_endorsement',
      from: 'Commander, Sea Based Anti-Submarine Warfare Wing, Atlantic',
      to: 'Commander, Fleet Forces Command',
      endorsementOrdinal: 'FIRST',
      sigFirst: 'Robert',
      sigLast: 'GABEL',
      ...formData,
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'Forwarded, recommending approval.', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

describe('same-page endorsement serial and date in DOCX', () => {
  it('emits serial and date right-aligned above the endorsement line (Fig 9-1)', () => {
    const tex = generateFlatLatex(store({ serial: 'Ser 019/870', date: '23 Apr 15' }));

    // Right-aligned block — the tabularx{Xr} idiom, since dondocs.lua drops
    // \hfill — with serial above date, before the endorsement line.
    const block = tex.match(/\\begin\{tabularx\}\{\\textwidth\}\{@\{\}Xr@\{\}\}([\s\S]*?)\\end\{tabularx\}/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/Ser 019\/870[\s\S]*23 Apr 15/);
    expect(tex.indexOf('23 Apr 15')).toBeLessThan(tex.indexOf('FIRST ENDORSEMENT'));
  });

  it('drops the serial row alone when only the date is set', () => {
    const tex = generateFlatLatex(store({ date: '23 Apr 15' }));
    expect(tex).toContain('23 Apr 15');
    expect(tex).not.toContain('Ser');
  });

  it('emits no empty block when the endorser hand-dates at signature', () => {
    const tex = generateFlatLatex(store({}));
    // No id block between the rule and the endorsement line.
    const between = tex.slice(tex.indexOf('\\rule'), tex.indexOf('FIRST ENDORSEMENT'));
    expect(between).not.toContain('tabularx');
  });
});
