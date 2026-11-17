import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { prepareTaggedCorrespondence, taggedCorrespondenceIssues, type TaggedCorrespondenceSource } from '@/services/pdf/accessibility/correspondence';
import { finishTaggedPdf, type PdfSemanticNode, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';

function deepestLetter(): TaggedCorrespondenceSource {
  return { docType: 'standard_letter', formData: { subject: 'Paragraph hierarchy', date: '16 Nov 26', from: 'Training Office', to: 'Example Marine', signatureType: 'none' },
    paragraphs: Array.from({ length: 6 }, (_, level) => ({ level, text: `Native paragraph level ${level}.` })),
    references: [], enclosures: [], copyTos: [], distributions: [] };
}

const flatten = (nodes: readonly PdfSemanticNode[], depth = 0): { node: PdfSemanticNode; depth: number }[] =>
  nodes.flatMap(node => [{ node, depth }, ...flatten(node.children ?? [], depth + 1)]);

/** Keep the actual preparation tree and its leaf identities while supplying
 * the small marked stream that a compiler must hand to the PDF finisher. */
async function compiledLeaves(plan: PdfTaggingPlan): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const point = (id: number, begin: boolean) => `/DDTag << /N <${plan.nonce}> /I ${id} /B ${begin} >> DP\n`;
  const content = flatten(plan.nodes).filter(({ node }) => !node.children?.length)
    .map(({ node }) => point(node.id, true) + 'BT /F1 12 Tf 50 700 Td (Native content) Tj ET\n' + point(node.id, false)).join('');
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(content)));
  return pdf.save();
}

describe('qualified native paragraph depth', () => {
  it('finishes every leaf of the actual accepted level-zero-through-five projection', async () => {
    const source = deepestLetter();
    expect(taggedCorrespondenceIssues(source)).toEqual([]);
    const { plan } = prepareTaggedCorrespondence(source);
    const nodes = flatten(plan.nodes);
    expect(Math.max(...nodes.map(({ depth }) => depth))).toBe(18);
    const result = await finishTaggedPdf(await compiledLeaves(plan), plan);
    expect(result.associatedChunks).toBe(nodes.filter(({ node }) => !node.children?.length).length);
  });

  it('keeps a finite depth bound beyond the qualified native hierarchy', async () => {
    const { plan } = prepareTaggedCorrespondence(deepestLetter());
    const nextId = Math.max(...flatten(plan.nodes).map(({ node }) => node.id)) + 1;
    const excessive: PdfTaggingPlan = { ...plan, nodes: [{ id: nextId, role: 'Sect', children: plan.nodes }] };
    await expect(finishTaggedPdf(await compiledLeaves(plan), excessive)).rejects.toThrow(/structure identity/);
  });
});
