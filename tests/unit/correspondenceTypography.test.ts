import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { buildBaseline } from '../_helpers/compileMatrix';

describe('correspondence type size', () => {
  const render = correspondenceRenderer();
  it.each(['times', 'courier'].flatMap(family => [10, 11, 12].map(size => [family, size] as const)))('%s %ipt uses the selected face size', async (family, size) => {
    const store = buildBaseline('naval_letter');
    Object.assign(store.formData, { fontFamily: family, fontSize: `${size}pt` });
    store.paragraphs = [{ level: 0, text: 'FONTPROBE Training coordination requirements.' }];
    const pdf = await getDocument({ data: await render(store), useSystemFonts: false }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const probe = content.items.find(item => 'str' in item && item.str.includes('FONTPROBE'));
      expect(probe && 'height' in probe ? probe.height : 0).toBeCloseTo(size * 72 / 72.27, 1);
    } finally { await pdf.destroy(); }
  }, 60_000);
});

describe('Word single spacing', () => {
  it.each([10, 11, 12])('%ipt keeps single spacing in defaults and inherited text/image styles', async size => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p/><w:sectPr/></w:body></w:document>');
    zip.file('word/styles.xml', `<w:styles><w:docDefaults/><w:style w:styleId="BodyText"><w:pPr><w:spacing w:line="200" w:lineRule="auto"/></w:pPr></w:style><w:style w:styleId="Compact"><w:pPr><w:spacing w:after="0" w:line="220" w:lineRule="exact"/></w:pPr></w:style></w:styles>`.replace('<w:docDefaults/>', '<w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults>'));
    const result = await postProcessDocx(await zip.generateAsync({ type: 'blob' }), { fontSize: `${size}pt`, fontFamily: 'times' });
    const output = await JSZip.loadAsync(result);
    const styles = await output.file('word/styles.xml')!.async('string');
    expect(styles.match(/w:line="240" w:lineRule="auto"/g)).toHaveLength(3);
    expect(styles).toContain(`w:sz w:val="${size * 2}"`);
    expect(styles).not.toMatch(/w:line="(?:200|220)"/);
  });
});
