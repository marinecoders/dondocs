import { LAYOUT } from './layout-config';
import JSZip from 'jszip';

const TITLE_LETTERHEAD_MARKER = /<w:bookmarkStart\b[^>]*\bw:name="DonDocsTitleLetterhead\d+"/;

/**
 * Apply font color and sizes to the first letterhead and repeated title letterheads.
 *
 * Per SECNAV M-5216.5 App C §2a:
 *   Department line: 10pt bold, colored (PMS 288 navy blue or black)
 *   Activity/unit name: 8pt, colored (NOT bold — App C §1d(2))
 *   Other lines (division, address): 8pt, colored
 *
 * Detection: The first <w:tbl> in the document is the letterhead.
 * Bold runs (<w:b/>) get 10pt (20 half-points); non-bold get 8pt (16 half-points).
 * All runs in the letterhead table get the letterhead color.
 */
export function applyLetterheadStyling(xml: string, colorHex: string, firstTableOffset = 0, dla = false): string {
  // Find the first <w:tbl> in the document using index-based search
  // to correctly handle nested tables (the lazy regex approach can
  // stop at an inner </w:tbl> instead of the outer one).
  const tblOpenTag = '<w:tbl>';
  const tblCloseTag = '</w:tbl>';
  const firstTblStart = xml.indexOf(tblOpenTag, firstTableOffset);
  if (firstTblStart === -1) return xml;

  // Find the matching </w:tbl> by counting nesting depth
  let depth = 0;
  let searchFrom = firstTblStart;
  let tblEnd = -1;
  while (searchFrom < xml.length) {
    const nextOpen = xml.indexOf(tblOpenTag, searchFrom + (depth === 0 ? tblOpenTag.length : 1));
    const nextClose = xml.indexOf(tblCloseTag, searchFrom + 1);
    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Found a nested <w:tbl> before the next </w:tbl>
      depth++;
      searchFrom = nextOpen;
    } else {
      // Found a </w:tbl>
      if (depth === 0) {
        tblEnd = nextClose + tblCloseTag.length;
        break;
      }
      depth--;
      searchFrom = nextClose;
    }
  }
  if (tblEnd === -1) return xml;

  let tblInner = xml.substring(firstTblStart + tblOpenTag.length, tblEnd - tblCloseTag.length);

  // Apply to tables that are a letterhead: either standard (has an image/drawing)
  // or joint (text-only but contains "DEPARTMENT" in the text content).
  const hasDrawing = tblInner.includes('<w:drawing>') || tblInner.includes('<wp:inline>');
  const hasDeptText = tblInner.includes('DEPARTMENT');
  const isDlaTable = dla && tblInner.includes('DEFENSE LOGISTICS AGENCY');
  const isTitleOnly = TITLE_LETTERHEAD_MARKER.test(tblInner);
  if (!hasDrawing && !hasDeptText && !isTitleOnly && !isDlaTable) {
    return xml;
  }

  // Joint letterheads (no seal image, text-only) are always black — per SECNAV M-5216.5
  // Ch 7 Fig 7-4, joint letters use plain bond with typed command titles. The joint letter
  // UI has no color picker, so the stored letterheadColor is a stale value from a previous
  // doc type. Override to black for joint letterheads.
  const isJointLetterhead = !hasDrawing && hasDeptText && !isTitleOnly && !isDlaTable;
  if (isJointLetterhead) {
    colorHex = '000000';
  }

  // Process each run in the letterhead table:
  // - Add color to all runs that have text
  // - Add font size based on bold status: bold=10pt(20hp), non-bold=8pt(16hp)
  tblInner = tblInner.replace(
    /<w:r>([\s\S]*?)<\/w:r>/g,
    (_match, runContent: string) => {
      // Skip runs that don't contain text (e.g., drawing/image runs, line breaks)
      if (!runContent.includes('<w:t')) return `<w:r>${runContent}</w:r>`;

      const isBold = runContent.includes('<w:b') && !runContent.includes('<w:b w:val="0"');
      const sizeHp = dla ? (isBold ? 24 : 20) : isTitleOnly || isBold ? 20 : 16; // 10pt = 20hp, 8pt = 16hp

      const font = dla ? '<w:rFonts w:ascii="Copperplate Gothic Light" w:hAnsi="Copperplate Gothic Light"/>' : '';

      // Build the run properties we need to inject
      const colorProp = `<w:color w:val="${colorHex}"/>`;
      const sizeProp = `<w:sz w:val="${sizeHp}"/><w:szCs w:val="${sizeHp}"/>`;

      if (dla) {
        // Preserve Word's rPr ordering and make the layout pass idempotent.
        runContent = runContent.replace(/<w:rPr\s*\/>/g, '');
        if (runContent.includes('<w:rPr>')) {
          runContent = runContent.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_, properties: string) => {
            const clean = properties.replace(/<w:(?:rFonts|color|sz|szCs)\b[^>]*\/>/g, '');
            const withFont = clean.replace(/^(<w:rStyle\b[^>]*\/>)?/, '$1' + font);
            const colorTail = /<w:(?:spacing|w|kern|position|sz|szCs|highlight|u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)\b/;
            const sizeTail = /<w:(?:highlight|u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)\b/;
            const next = colorTail.test(withFont) ? withFont.replace(colorTail, colorProp + '$&') : withFont + colorProp;
            return '<w:rPr>' + (sizeTail.test(next) ? next.replace(sizeTail, sizeProp + '$&') : next + sizeProp) + '</w:rPr>';
          });
        } else {
          runContent = runContent.replace(/(<w:t)/, '<w:rPr>' + font + colorProp + sizeProp + '</w:rPr>$1');
        }
      } else if (runContent.includes('<w:rPr>')) {
        runContent = runContent.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, '<w:rPr>$1' + colorProp + sizeProp + '</w:rPr>');
      } else {
        runContent = runContent.replace(/(<w:t)/, '<w:rPr>' + colorProp + sizeProp + '</w:rPr>$1');
      }

      return `<w:r>${runContent}</w:r>`;
    }
  );


  // Reconstruct the table and replace in the document using exact position
  const styledTable = tblOpenTag + tblInner + tblCloseTag;
  const styled = xml.substring(0, firstTblStart) + styledTable + xml.substring(tblEnd);
  // Later endorsement pages repeat the owned title table. Process only their
  // generated bookmarks; ordinary body tables must retain their own styles.
  const searchAfter = firstTblStart + styledTable.length;
  const nextMarker = styled.slice(searchAfter).search(TITLE_LETTERHEAD_MARKER);
  if (nextMarker < 0) return styled;
  const nextTable = styled.lastIndexOf(tblOpenTag, searchAfter + nextMarker);
  return nextTable >= searchAfter ? applyLetterheadStyling(styled, colorHex, nextTable) : styled;
}

/**
 * Ensure the letterhead table is perfectly centered on the page.
 *
 * Fixes two issues:
 * 1. Horizontal centering — forces the 3-column gridCol widths to be
 *    exactly symmetric (sealCol === spacerCol) with total === textWidth.
 *    Rounding from pandoc + rescaling can introduce a few-twip asymmetry.
 * 2. Vertical centering — adds w:vAlign="center" to the center text cell
 *    so the org text block is vertically centered relative to the seal image.
 *
 * Detection: first 3-col table in the document that contains a drawing.
 */
interface LetterheadResult {
  xml: string;
  hasLetterheadSeal: boolean;  // true if a letterhead table with seal image was found
}

export function perfectLetterheadCentering(xml: string, textWidthTwips: number, dla = false): LetterheadResult {
  // Find the first table in the document
  const firstTblMatch = xml.match(/<w:tbl>([\s\S]*?)<\/w:tbl>/);
  if (!firstTblMatch) return { xml, hasLetterheadSeal: false };

  let tblContent = firstTblMatch[1];

  // Verify this is the letterhead table (has a drawing/image)
  if (!tblContent.includes('<w:drawing>') && !tblContent.includes('<wp:inline>')) {
    return { xml, hasLetterheadSeal: false };
  }

  // Check it's a 3-column table
  const gridColMatches = tblContent.match(/<w:gridCol w:w="\d+"\/>/g);
  if (!gridColMatches || gridColMatches.length !== 3) return { xml, hasLetterheadSeal: false };

  // --- Margin extension: per SECNAV App C ¶1b, the seal is 0.5in from the page edge ---
  // The letterhead table must extend 0.5in (720 twips) into each margin so the
  // seal column starts at the 0.5in page position, not the 1in text margin.
  // We achieve this by: (a) negative tblInd of -720 twips, (b) wider gridCols.
  const MARGIN_EXT = 720; // 0.5in in twips

  // --- Horizontal centering: exact symmetric gridCol widths ---
  // Base widths from the text-width proportions, then extend seal+spacer into margins
  const baseSealTwips = Math.round(LAYOUT.letterhead.sealCol * textWidthTwips);
  const baseSpacerTwips = baseSealTwips; // Force exact symmetry
  const centerTwips = textWidthTwips - baseSealTwips - baseSpacerTwips;
  const sealTwips = baseSealTwips + MARGIN_EXT;   // extend left into margin
  const spacerTwips = baseSpacerTwips + MARGIN_EXT; // extend right into margin

  const oldGrid = tblContent.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
  if (oldGrid) {
    const newGrid = '<w:tblGrid>'
      + `<w:gridCol w:w="${sealTwips}"/>`
      + `<w:gridCol w:w="${centerTwips}"/>`
      + `<w:gridCol w:w="${spacerTwips}"/>`
      + '</w:tblGrid>';
    tblContent = tblContent.replace(oldGrid[0], newGrid);
  }

  // --- Negative table indent: shift table 0.5in left into margin ---
  // Replace existing tblInd or add one. This positions the table's left edge
  // at the 0.5in mark from the page edge (inside the margin area).
  if (tblContent.includes('<w:tblInd')) {
    tblContent = tblContent.replace(
      /<w:tblInd[^>]*\/>/,
      `<w:tblInd w:type="dxa" w:w="-${MARGIN_EXT}"/>`
    );
  } else {
    // Insert tblInd after tblW if present, otherwise after tblStyle
    tblContent = tblContent.replace(
      /(<w:tblW[^>]*\/>)/,
      `$1<w:tblInd w:type="dxa" w:w="-${MARGIN_EXT}"/>`
    );
  }

  // --- Table width: change from percentage to fixed width in twips ---
  // The table is now wider than \textwidth, so percentage-based width (5000 = 100%)
  // would only cover the text area. Use fixed width (dxa) for the full table.
  const totalTwips = sealTwips + centerTwips + spacerTwips;
  tblContent = tblContent.replace(
    /<w:tblW[^>]*\/>/,
    `<w:tblW w:type="dxa" w:w="${totalTwips}"/>`
  );

  // --- Vertical centering: vAlign on center cell ---
  // The letterhead row has 3 cells: seal | org text | spacer.
  // Add w:vAlign="center" to the center (2nd) cell's tcPr so the
  // text block is vertically centered relative to the seal image.
  // tcPr can be self-closing (<w:tcPr />) or have content (<w:tcPr>...</w:tcPr>).
  let cellIndex = 0;
  tblContent = tblContent.replace(
    /<w:tc><w:tcPr\s*\/>/g,
    (match) => {
      cellIndex++;
      if (cellIndex === 2) {
        if (dla) return '<w:tc><w:tcPr><w:tcMar><w:top w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="top"/></w:tcPr>';
        return '<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>';
      }
      return match;
    }
  );

  let sealParagraph = '';
  if (dla) {
    // DLA stationery fixes the seal at 0.5 in from the top and left edges.
    // A row minimum reserves room for the floating seal and lets long text grow.
    tblContent = tblContent.replace(/(<w:tr\b[^>]*>\s*)(?:<w:trPr\s*\/>|<w:trPr>([\s\S]*?)<\/w:trPr>)?/, (_, row: string, properties?: string) => {
      const height = '<w:trHeight w:val="1440" w:hRule="atLeast"/>';
      const existing = (properties ?? '').replace(/<w:trHeight\b[^>]*\/>/g, '');
      return row + '<w:trPr>' + existing + height + '</w:trPr>';
    });
    tblContent = tblContent.replace(/<w:drawing><wp:inline\b[^>]*>([\s\S]*?)<\/wp:inline><\/w:drawing>/, (_, content: string) => {
      const size = 'cx="914400" cy="914400"';
      const graphic = content.replace(/<(wp:extent|a:ext)\s+cx="\d+"\s+cy="\d+"\s*\/>/g, '<$1 ' + size + '/>')
        .replace(/(<wp:docPr\b)/, '<wp:wrapNone/>$1');
      const anchor = '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1">'
        + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>'
        + '<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionV>' + graphic + '</wp:anchor>';
      sealParagraph = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>'
        + '<w:r><w:drawing>' + anchor + '</w:drawing></w:r></w:p>';
      return '';
    });
  }

  // Apply table content changes
  xml = xml.replace(firstTblMatch[0], () => sealParagraph + '<w:tbl>' + tblContent + '</w:tbl>');

  // Note: No vertical spacer paragraph is needed after the letterhead table.
  // The page top margin is reduced to 720 twips (0.5in) so the seal starts at
  // 0.5in from the top edge per SECNAV App C ¶1b. The letterhead table itself
  // is ~1.09in tall (driven by the seal image), which already places the content
  // past the 1.0in mark. The flat-generator emits \vspace{1\baselineskip} after
  // the letterhead, which pandoc converts to a spacing paragraph (~240 twips),
  // providing exactly 1 line of space before the SSIC block.

  return { xml, hasLetterheadSeal: true };
}


/** Companion headers use the same style pass as browser exports. */
export async function formatLetterheadStyles(bytes: Uint8Array, color: 'blue' | 'black' | undefined): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes), document = zip.file('word/document.xml');
  if (!document) throw new Error('Word output is missing its document part.');
  let xml = await document.async('string');
  const firstTable = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0];
  // Artless headers and body tables retain their original geometry.
  if (firstTable?.includes('<w:drawing>') || firstTable?.includes('<wp:inline>')) {
    const margins = '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
    const normalized = firstTable.replace(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/g, '')
      .replace('</w:tblPr>', `${margins}</w:tblPr>`)
      .replace(/<w:tcMar>[\s\S]*?<\/w:tcMar>/g, '')
      .replace(/<w:tcPr\s*\/>/g, '<w:tcPr></w:tcPr>')
      .replace(/<w:tcPr>/g, `$&${margins.replaceAll('tblCellMar', 'tcMar')}`)
      .replace(/<w:gridCol w:w="(\d+)"\s*\/>/g, '<w:gridCol w:w="$1"/>')
      // Native Pandoc omits wrap distances; Word readers may add 0.125in.
      .replace(/<wp:inline\b([^>]*)>/g, (_tag, attributes: string) => `<wp:inline${attributes.replace(/\s+dist[LRBT]="[^"]*"/g, '')} distL="0" distR="0" distT="0" distB="0">`);
    xml = xml.replace(firstTable, normalized);
    const centered = perfectLetterheadCentering(xml, 9360);
    xml = centered.xml;
    if (centered.hasLetterheadSeal) xml = xml.replace(/<w:pgMar\b[^>]*\/>/g, properties => properties.replace(/w:top="\d+"/, 'w:top="720"'));
  }
  zip.file('word/document.xml', applyLetterheadStyling(xml, color === 'black' ? '000000' : '00205B'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
