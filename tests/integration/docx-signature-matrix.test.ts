import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { prepareDocxImages } from '@/services/docx/imageAssets';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { ALL_DOC_TYPES, buildBaseline } from '../_helpers/compileMatrix';
import { docxImageFixture } from '../_helpers/docxImageFixture';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const supported = ALL_DOC_TYPES.filter(type => !DOC_TYPE_CONFIG[type].pdfOnly
  && DOC_TYPE_CONFIG[type].signature !== 'dual' && type !== 'information_memorandum'
  && !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(type));

describe.skipIf(!hasPandoc)('signature image preservation across Word layouts', () => {
  it.each(supported)('embeds the exact signature and its accessibility text in %s', async docType => {
    const { signature } = await docxImageFixture();
    const store = buildBaseline(docType);
    store.formData.signatureType = 'image';
    store.formData.signatureImage = { name: 'signature.png', size: signature.length, data: signature.toString('base64') };
    const media = await prepareDocxImages(store, async () => { throw new Error('Inline signature must not read another resource.'); });
    const compiled = await compileGeneratedDocxFixture(generateFlatLatex(store), store.formData, media);
    expect(compiled.ok, compiled.log).toBe(true);
    const output = await postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), { docType, ...store.formData });
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    const document = await zip.file('word/document.xml')!.async('string');
    expect(document).toContain('descr="Handwritten signature image"');
    expect(document).toContain('cx="1371600" cy="342900"');
    expect(document).not.toContain('blob:');
    const parser = new DOMParser();
    const drawing = [...parser.parseFromString(document, 'application/xml').getElementsByTagName('wp:docPr')]
      .find(node => node.getAttribute('descr') === 'Handwritten signature image');
    const embed = drawing?.parentElement?.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed');
    expect(embed).toBeTruthy();
    const relationships = parser.parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'application/xml');
    const relation = [...relationships.getElementsByTagName('Relationship')].find(node => node.getAttribute('Id') === embed);
    expect(relation?.getAttribute('TargetMode')).not.toBe('External');
    const target = relation?.getAttribute('Target');
    expect(target).toMatch(/^media\//);
    expect((await zip.file(`word/${target}`)!.async('nodebuffer')).equals(signature)).toBe(true);
  });
});
