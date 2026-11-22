import JSZip from 'jszip';

/**
 * Turns the Lua filter's leading indent markers into real `w:ind` attributes.
 *
 * `dondocs.lua` cannot emit OpenXML from an inline, so `\dondocs*indent{Xin}`
 * arrives as a run of marker characters at the head of a paragraph — six per
 * inch. Each macro uses a distinct character so this pass can tell which kind
 * of indent was meant:
 *
 *   U+00A0 nbsp    \dondocsindent       → w:left     (the whole block moves)
 *   U+2003 em      \dondocsfirstindent  → w:firstLine (only the first line)
 *   U+2007 figure  \dondocshangindent   → w:left + w:hanging (only the runover)
 *
 * The hanging variant is what a Ref:/Encl: entry needs: the designator keeps
 * its column and a title too long for one line wraps under the entry's text,
 * per Ch 7 ¶10c and Figure 7-1.
 *
 * Exported as a test seam. It is pure string-to-string, and the DOCX compile
 * harness deliberately does not run the JSZip post-pass, so without this the
 * conversion has no coverage at all.
 */
export function applyMemoAddressIndents(xml: string): string {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, paragraph => {
    const marker = paragraph.match(/w:name="DonDocsMemoIndent([HB])(\d+)"/);
    if (!marker) return paragraph;
    const twips = Math.min(9360, Number(marker[2]));
    const indent = `<w:ind w:left="${twips}"${marker[1] === 'H' ? ` w:hanging="${twips}"` : ''}/>`;
    if (paragraph.includes('<w:pPr>')) {
      return paragraph.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_, properties: string) =>
        `<w:pPr>${properties.replace(/<w:ind\b[^>]*\/>/g, '')}${indent}</w:pPr>`);
    }
    return paragraph.replace(/(<w:p(?:\s[^>]*)?>)(?:<w:pPr\s*\/>)?/, `$1<w:pPr>${indent}</w:pPr>`);
  });
}

export function applyIndentMarkers(xml: string): string {
  const kinds: { char: string; ind: (t: number) => string; per?: number }[] = [
    { char: '\u00A0', ind: (t: number) => `<w:ind w:left="${t}"/>` },
    // 72 markers per inch — see the note in dondocs.lua. The other two kinds
    // still run at 6, which is all their whole-inch values ever needed.
    { char: '\u2003', ind: (t: number) => `<w:ind w:firstLine="${t}"/>`, per: 72 },
    { char: '\u2007', ind: (t: number) => `<w:ind w:left="${t}" w:hanging="${t}"/>` },
  ];

  for (const kind of kinds) {
    const re = new RegExp(`<w:t(?:\\s[^>]*)?>(${kind.char}+)`, 'g');
    const hits: { tStart: number; runLen: number; matchLen: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      hits.push({ tStart: m.index, runLen: m[1].length, matchLen: m[0].length });
    }

    // Back to front, so each splice leaves earlier indices valid.
    for (let i = hits.length - 1; i >= 0; i--) {
      const hit = hits[i];
      const twips = Math.round((hit.runLen / (kind.per ?? 6)) * 1440);

      const before = xml.substring(0, hit.tStart);
      const pStart = before.lastIndexOf('<w:p>');
      if (pStart === -1) continue;
      // Markers only ever open a paragraph. Further in, the same character is the
      // author's: two spaces typed after bold or a variable start their own run.
      if (/<w:t[\s>]/.test(before.substring(pStart))) continue;
      const hasPPr = before.lastIndexOf('<w:p><w:pPr>') === pStart;

      // Drop the markers themselves — they are instructions, not text.
      const runEnd = hit.tStart + hit.matchLen;
      xml = xml.substring(0, runEnd - hit.runLen) + xml.substring(runEnd);

      const indEl = kind.ind(twips);
      if (hasPPr) {
        const at = pStart + '<w:p><w:pPr>'.length;
        xml = xml.substring(0, at) + indEl + xml.substring(at);
      } else {
        const at = pStart + '<w:p>'.length;
        xml = xml.substring(0, at) + `<w:pPr>${indEl}</w:pPr>` + xml.substring(at);
      }
    }
  }
  return xml;
}

/** Apply the browser's native paragraph layout instructions in companion Word. */
export async function formatParagraphIndents(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes), document = zip.file('word/document.xml');
  if (!document) throw new Error('Word output is missing its document part.');
  zip.file('word/document.xml', applyMemoAddressIndents(applyIndentMarkers(await document.async('string'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
