import { WINDOW_ENVELOPE_PITCH } from '@/lib/windowEnvelope';

const WINDOW_ROW = /<w:bookmarkStart w:id="\d+" w:name="DonDocsWindowRow(\d+)I(\d+)"\/><w:bookmarkEnd w:id="\d+"\/>/;

function rowProperties(height: number, indent = 0): string {
  return `<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>${indent ? `<w:ind w:left="${indent * 20}"/>` : ''}</w:pPr>`;
}

/** Place the editable opening paragraphs on a fixed page grid. The full
 * letterhead retains its existing seal and text in a reserved first table row. */
export function applyWindowEnvelopeSpacing(xml: string, hasLetterheadSeal: boolean, topMargin: number): string {
  const first = WINDOW_ROW.exec(xml);
  if (!first) return xml;

  let nextTop = topMargin;
  if (hasLetterheadSeal) {
    nextTop = Number(first[1]);
    const height = `<w:trHeight w:val="${(nextTop - topMargin) * 20}" w:hRule="exact"/>`;
    xml = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/, table => table.replace(/<w:tr>([\s\S]*?)<\/w:tr>/, (_, row: string) => {
      const sized = row.includes('<w:trPr>')
        ? row.replace(/<w:trHeight\b[^>]*\/>/g, '').replace('</w:trPr>', `${height}</w:trPr>`)
        : `<w:trPr>${height}</w:trPr>${row}`;
      return `<w:tr>${sized}</w:tr>`;
    }));
  }

  return xml.replace(/(<w:p(?:\s[^>]*)?>)([\s\S]*?)<\/w:p>/g, (paragraph, open: string, contents: string) => {
    const marker = WINDOW_ROW.exec(contents);
    if (!marker) return paragraph;
    const top = Number(marker[1]);
    if (top < nextTop) throw new Error('Window-envelope Word opening rows overlap.');
    const spacing = top > nextTop ? `<w:p>${rowProperties(top - nextTop)}</w:p>` : '';
    nextTop = top + WINDOW_ENVELOPE_PITCH;
    const runs = contents.replace(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/, '').replace(WINDOW_ROW, '');
    return `${spacing}${open}${rowProperties(WINDOW_ENVELOPE_PITCH, Number(marker[2]))}${runs}</w:p>`;
  });
}
