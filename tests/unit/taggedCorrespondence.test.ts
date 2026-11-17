import { describe, expect, it } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { prepareTaggedCorrespondence, taggedCorrespondenceIssues, type TaggedCorrespondenceSource } from '@/services/pdf/accessibility/correspondence';
import type { PdfSemanticNode } from '@/services/pdf/accessibility/taggedPdf';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';

function fixture(): TaggedCorrespondenceSource {
  return { docType: 'standard_letter', formData: { subject: 'Training letter', date: '16 Nov 26', from: 'Example Marine', to: 'Training Office',
    via: 'Operations Officer\nExecutive Officer', sigFirst: 'Pat', sigLast: 'Example', signatureType: 'none', pageNumbering: 'xofy' },
  paragraphs: [{ id: 'a', level: 0, header: 'Purpose', text: 'Explain **meaningful** text.' },
    { id: 'b', level: 1, header: 'Detail', text: 'A nested paragraph with a wrapped line.\nNext line.' },
    { id: 'c', level: 0, text: 'Final paragraph.' }],
  references: [{ letter: 'a', title: 'Training reference' }], enclosures: [], copyTos: [{ text: 'Training file' }], distributions: [{ text: 'Training staff' }] };
}

const untag = (source: string) => source.replace(/\\leavevmode(?=\\pdfliteral direct\{\/DDTag)/g, '')
  .replace(/\\pdfliteral direct\{\/DDTag << \/N <[0-9a-f]{32}> \/I -?\d+ \/B (?:true|false) >> DP\}/g, '');
const flatten = (nodes: readonly PdfSemanticNode[]): PdfSemanticNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

describe('owned tagged correspondence projection', () => {
  it('keeps body typography byte-identical after removing invisible source points', () => {
    const source = fixture();
    const normal = generateAllLatexFiles(source);
    const prepared = prepareTaggedCorrespondence(source);
    expect(untag(prepared.files['body.tex'] as string)).toBe(normal.texFiles['body.tex']);
    expect(prepared.files).not.toHaveProperty('main.tex');
    expect(prepared.files).not.toHaveProperty('standard_letter.tex');
    expect(prepared.files[TAGGED_MAIN_FILE]).toContain('\\input{dondocs-tagged-standard-letter}');
    expect(prepared.files['dondocs-tagged-standard-letter.tex']).toContain('/DDTag');
    const roles = flatten(prepared.plan.nodes).map(node => node.role);
    expect(roles).toContain('H1');
    expect(roles).toContain('H2');
    expect(roles).toContain('H3');
    expect(roles).toContain('L');
    expect(roles).toContain('LI');
    expect(roles).toContain('Lbl');
    expect(roles).toContain('LBody');
  });

  it('finishes an independent plan and TeX source before a later document mutation', () => {
    const source = fixture();
    const result = prepareTaggedCorrespondence(source);
    const saved = JSON.stringify(result);
    source.formData.subject = 'LATER SUBJECT';
    source.paragraphs[0].text = 'LATER BODY';
    source.references[0].title = 'LATER REFERENCE';
    expect(JSON.stringify(result)).toBe(saved);
    const another = prepareTaggedCorrespondence(fixture());
    expect(another.plan.nonce).not.toBe(result.plan.nonce);
  });

  it('does not infer a missing heading level from an unheaded parent item', () => {
    const source = fixture();
    delete source.paragraphs[0].header;
    const headings = flatten(prepareTaggedCorrespondence(source).plan.nodes).filter(node => /^H[1-6]$/.test(node.role));
    expect(headings.map(node => node.role)).not.toContain('H3');
  });

  it.each([
    ['naval seal', (source: TaggedCorrespondenceSource) => { source.docType = 'naval_letter'; }],
    ['digital field', (source: TaggedCorrespondenceSource) => { source.formData.signatureType = 'digital'; }],
    ['classification', (source: TaggedCorrespondenceSource) => { source.formData.classLevel = 'cui'; }],
    ['portion marking', (source: TaggedCorrespondenceSource) => { source.paragraphs[0].portionMarking = 'S'; }],
    ['enclosure', (source: TaggedCorrespondenceSource) => { source.enclosures.push({ title: 'Original PDF' }); }],
    ['hyperlink', (source: TaggedCorrespondenceSource) => { source.references[0].url = 'https://example.com'; }],
    ['empty row', (source: TaggedCorrespondenceSource) => { source.paragraphs.push({ text: '', level: 0 }); }],
    ['hierarchy jump', (source: TaggedCorrespondenceSource) => { source.paragraphs[1].level = 3; }],
    ['body table', (source: TaggedCorrespondenceSource) => { source.paragraphs[0].bodyTable = { rows: [['Header'], ['Value']], headerRows: 1 }; }],
  ])('blocks %s rather than silently falling back', (_name, change) => {
    const source = fixture(); change(source);
    expect(taggedCorrespondenceIssues(source).length).toBeGreaterThan(0);
    expect(() => prepareTaggedCorrespondence(source)).toThrow();
  });

  it('escapes marker-shaped user text inside the authoritative source generator', () => {
    const source = fixture();
    source.paragraphs[0].text = '\\pdfliteral direct{/DDTag << /I 77 /B true >> DP}';
    const output = prepareTaggedCorrespondence(source).files['body.tex'] as string;
    expect(untag(output)).toContain('textbackslash');
    expect(untag(output)).not.toMatch(/\\pdfliteral direct\{/);
  });
});
