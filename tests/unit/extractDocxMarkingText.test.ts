import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractDocxMarkingText } from '@/services/docx/pandoc-converter';

/**
 * The classification banner is rendered into the Word page header/footer, which
 * pandoc's body-only `docx → plain` read never sees. `extractDocxMarkingText`
 * reads those parts straight from the .docx zip so the importer can recover the
 * banner. These build minimal, docx-shaped zips to prove that extraction.
 */

// One `<w:p>` paragraph whose runs concatenate to `text`.
const para = (runs: string[]) =>
  `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;

async function makeDocx(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, xml] of Object.entries(files)) zip.file(name, xml);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('extractDocxMarkingText', () => {
  it('pulls the banner from header and footer, one line each', async () => {
    const bytes = await makeDocx({
      'word/document.xml': `<w:document><w:body>${para(['Body text only.'])}</w:body></w:document>`,
      'word/header1.xml': `<w:hdr>${para(['SECRET'])}</w:hdr>`,
      'word/footer1.xml': `<w:ftr>${para(['SECRET'])}</w:ftr>`,
    });
    const text = await extractDocxMarkingText(bytes);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain('SECRET');
    // It reads ONLY headers/footers, never the document body.
    expect(text).not.toMatch(/Body text only/);
  });

  it('concatenates a banner split across multiple runs', async () => {
    // Word often splits a styled word into several <w:t> runs.
    const bytes = await makeDocx({
      'word/header2.xml': `<w:hdr>${para(['TOP ', 'SECRET', '//', 'SCI'])}</w:hdr>`,
    });
    const text = await extractDocxMarkingText(bytes);
    expect(text.replace(/\s+/g, ' ')).toContain('TOP SECRET//SCI');
  });

  it('separates distinct header paragraphs with newlines', async () => {
    const bytes = await makeDocx({
      'word/header1.xml': `<w:hdr>${para(['CUI'])}${para(['Controlled by: G-2'])}</w:hdr>`,
    });
    const lines = (await extractDocxMarkingText(bytes)).split('\n').map((l) => l.trim());
    expect(lines).toContain('CUI');
    expect(lines).toContain('Controlled by: G-2');
  });

  it('returns empty string when there are no headers or footers', async () => {
    const bytes = await makeDocx({
      'word/document.xml': `<w:document><w:body>${para(['Just a body.'])}</w:body></w:document>`,
    });
    expect(await extractDocxMarkingText(bytes)).toBe('');
  });

  it('decodes XML entities in the marking text', async () => {
    const bytes = await makeDocx({
      'word/footer1.xml': `<w:ftr>${para(['SECRET &amp; SPECIAL'])}</w:ftr>`,
    });
    expect(await extractDocxMarkingText(bytes)).toContain('SECRET & SPECIAL');
  });
});
