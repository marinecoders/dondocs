import JSZip from 'jszip';

/** Resolve classLevel to the classification marking text (e.g. "SECRET", "CUI"). */
export function getClassificationMarking(classLevel?: string, customClassification?: string): string {
  if (!classLevel || classLevel === 'unclassified') return '';
  if (classLevel === 'cui') return 'CUI';
  if (classLevel === 'custom' && customClassification) return customClassification;
  const map: Record<string, string> = {
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };
  return map[classLevel] || '';
}

/** Escape text destined for an XML text node. */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A centered bold paragraph — the classification marking's shape. */
function markingParagraph(marking: string): string {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + `<w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXmlText(marking)}</w:t></w:r></w:p>`;
}

/**
 * The repeated subject line at the left margin, per SECNAV M-5216.5 ¶7-16.
 *
 * Takes the whole line rather than just the text because the label is not
 * constant: the PDF templates head letters with `Subj:~~` and memoranda and
 * business letters with `SUBJECT:~~`. Hardcoding either one here would make the
 * Word export disagree with the PDF built from the same document. The two
 * spaces match those templates' `~~`.
 */
function continuationSubjectParagraph(line: string, spaceBefore: number): string {
  const spacing = spaceBefore > 0 ? `<w:spacing w:before="${spaceBefore}"/>` : '';
  return `<w:p><w:pPr>${spacing}<w:jc w:val="left"/></w:pPr>`
    + `<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`;
}

function directiveParagraph(line: string, alignment: 'left' | 'right'): string {
  return '<w:p><w:pPr><w:jc w:val="' + alignment + '"/></w:pPr>'
    + '<w:r><w:t xml:space="preserve">' + escapeXmlText(line) + '</w:t></w:r></w:p>';
}

/**
 * A centered PAGE field — ¶7-17: "Center page numbers 1/2 inch from the bottom
 * edge, starting with the number 2." The 1/2 inch is the sectPr's w:footer
 * distance (720 twips), which page geometry already sets; "starting with 2"
 * falls out of this living in the *default* footer while page 1 uses the
 * `first` one.
 */
function pageNumberParagraph(style?: string): string {
  const total = style === 'xofy'
    ? '<w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="PAGEREF DonDocsLastPage"><w:r><w:t>1</w:t></w:r></w:fldSimple>'
    : '';
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>' + total + '</w:p>';
}

/** An empty paragraph — one blank line, and what Word needs a part to contain. */
const EMPTY_PARAGRAPH = '<w:p/>';

/** Position unmarked continuation subjects near the native PDF's 0.85in text
 * top. A 0.5in header origin plus two font-size lines places 12pt text at
 * about 61pt in Word; the old 0.6-line lead-in placed it at 45pt. Keep the
 * separate blank paragraph below the subject so wrapped headers grow safely.
 * Marked headers retain their independently qualified existing placement. */
function subjectSpaceBefore(hasMarking: boolean, fontSizePt: number): number {
  return hasMarking ? 0 : Math.round(fontSizePt * 40);
}

interface HeaderFooterParts {
  /** Page 1. */
  firstHeader: string[];
  firstFooter: string[];
  /** Page 2 onward. */
  defaultHeader: string[];
  defaultFooter: string[];
  evenHeader?: string[];
}

/**
 * Decide what goes on page 1 versus the continuation pages.
 *
 * Page 1 and later pages differ, so the document needs `w:titlePg` and two sets
 * of parts. The classification marking must appear on BOTH — turning on
 * titlePg without giving page 1 its own marked header would silently strip the
 * marking from the first page of every classified letter.
 */
function planHeadersAndFooters(furniture: PageFurniture): HeaderFooterParts {
  const { marking, businessIdentification, continuationSubject, wantsPageNumbers, pageNumbering, fontSizePt, directiveContinuation: directive } = furniture;
  const marked = marking ? [markingParagraph(marking)] : [];
  const number = wantsPageNumbers ? [pageNumberParagraph(pageNumbering)] : [];
  const numberFirstPage = furniture.startPage > 1 || furniture.numberFirstPage;
  const businessHeader = businessIdentification?.length ? [
    ...businessIdentification.map((line, index) => continuationSubjectParagraph(line, index > 0 ? 0 : fontSizePt * (marking ? 20 : 40))),
    ...(continuationSubject ? [continuationSubjectParagraph(continuationSubject, 0)] : []),
    EMPTY_PARAGRAPH,
  ] : undefined;
  return {
    firstHeader: [...marked],
    // ¶7-17 leaves a letter's first page unnumbered, but an endorsement's
    // opening sheet continues someone else's sequence and Fig 9-2 numbers it.
    // Same split the PDF templates make between their `firstpage` styles.
    firstFooter: [...marked, ...(numberFirstPage ? number : [])],
    evenHeader: directive?.alternate ? [...marked, ...directive.lines.map(line => directiveParagraph(line, 'left'))] : undefined,
    defaultHeader: [
      ...marked,
      ...(directive ? directive.lines.map(line => directiveParagraph(line, 'right')) : businessHeader ?? (continuationSubject
        ? [
            continuationSubjectParagraph(continuationSubject, subjectSpaceBefore(!!marking, fontSizePt)),
            // ¶7-16: "Continue the text beginning on the second line below the
            // subject." The body starts straight after the header on a
            // letterhead document, so this empty line IS the blank one.
            EMPTY_PARAGRAPH,
          ]
        : [])),
    ],
    // Marking first, then the number below it — mirrors the PDF, where the
    // marking is \fancyfoot[C] on its own line above \thepage.
    defaultFooter: [...marked, ...number],
  };
}

/**
 * Rebuild a <w:sectPr> with header/footer references and w:titlePg in their
 * schema-required positions.
 *
 * CT_SectPr is a *sequence*, not a bag: the header/footer references come
 * first, and w:titlePg belongs after w:cols and before w:docGrid. Appending
 * everything before `</w:sectPr>` (as the classification-only code used to)
 * happens to survive Word's leniency, but titlePg out of order is the kind of
 * thing that makes Word repair the file on open — so build it properly.
 */
function rebuildSectPr(
  sectPr: string,
  refs: string,
  titlePg: boolean,
  startPage: number,
): string {
  // Strip the wrapper, then re-emit: refs, existing children, titlePg.
  const open = sectPr.match(/^<w:sectPr[^>]*>/)?.[0] ?? '<w:sectPr>';
  const inner = sectPr.slice(open.length, sectPr.lastIndexOf('</w:sectPr>'));

  // w:titlePg sits after w:cols/w:vAlign and before w:docGrid. Nothing here
  // emits docGrid today, so appending it last is in-order; if pandoc ever does,
  // splice ahead of it rather than after.
  const docGrid = inner.match(/<w:docGrid[^>]*\/?>/)?.[0];
  // The Word equivalent of \setcounter{page}{N} — pandoc drops that too, so an
  // endorsement continuing at page 3 would otherwise restart Word at 1.
  const pgNumType = startPage > 1 ? `<w:pgNumType w:start="${startPage}"/>` : '';
  const titleTag = titlePg ? '<w:titlePg/>' : '';
  const tail = `${pgNumType}${titleTag}`;
  const body = docGrid
    ? inner.replace(docGrid, `${tail}${docGrid}`)
    : `${inner}${tail}`;

  return `${open}${refs}${body}</w:sectPr>`;
}

/**
 * Inject the page header and footer parts into the DOCX zip and wire them into
 * content types, relationships and sectPr.
 *
 * Everything here is invisible to pandoc: `\fancyhead` and `\fancyfoot` are not
 * constructs its LaTeX reader understands, so the flat generator's page
 * furniture is dropped on the floor. Before this existed the Word export
 * carried no page numbers at all and no repeated subject line, while the PDF
 * built from the same document had both.
 */
export interface PageFurniture {
  /** Classification marking, or '' for unclassified. Appears on every page. */
  marking: string;
  /**
   * The subject line as it should appear on pages 2+, label included
   * ("Subj:  X" or "SUBJECT:  X"), or '' to omit. Whole line rather than just
   * the text because the label varies by document type.
   */
  continuationSubject: string;
  businessIdentification?: readonly string[];
  directiveContinuation?: { lines: readonly string[]; alternate: boolean };
  /** Number pages 2+. */
  wantsPageNumbers: boolean;
  /** First page's number; above 1 also numbers page 1 (Ch 9 Fig 9-2). */
  startPage: number;
  /** Body font size in points — sets the line height the subject spaces against. */
  fontSizePt: number;
  numberFirstPage?: boolean;
  pageNumbering?: string;
}

/**
 * Apply the page header/footer furniture to a pandoc-produced DOCX.
 *
 * Exported for `tests/integration/docx-page-furniture.test.ts`: the DOCX test
 * harness deliberately stops at pandoc and does not run the post-pass, so
 * without this seam the OOXML written here — parts, content types,
 * relationships, sectPr ordering — would ship with no test able to see it.
 * Production reaches it through `postProcessDocx`; the test drives the same
 * function with the same inputs.
 */
export async function applyPageFurniture(
  zip: JSZip,
  xml: string,
  furniture: PageFurniture,
): Promise<string> {
  if (furniture.pageNumbering === 'xofy') {
    const ids = [...xml.matchAll(/<w:bookmarkStart\b[^>]*w:id="(\d+)"/g)].map((match) => Number(match[1]));
    const id = Math.max(0, ...ids) + 1;
    const end = xml.lastIndexOf('</w:p>');
    if (end !== -1) xml = xml.slice(0, end)
      + `<w:bookmarkStart w:id="${id}" w:name="DonDocsLastPage"/><w:bookmarkEnd w:id="${id}"/>` + xml.slice(end);
    const settings = await zip.file('word/settings.xml')?.async('string');
    if (settings) zip.file('word/settings.xml', settings.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>'));
  }
  return injectHeadersAndFooters(
    zip,
    xml,
    planHeadersAndFooters(furniture),
    furniture.startPage,
  );
}

async function injectHeadersAndFooters(
  zip: JSZip,
  xml: string,
  parts: HeaderFooterParts,
  startPage: number,
): Promise<string> {
  const wrap = (tag: 'hdr' | 'ftr', paragraphs: string[]) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<w:${tag} ${W_NS}>`
    + (paragraphs.length ? paragraphs.join('') : EMPTY_PARAGRAPH)
    + `</w:${tag}>`;

  // Word resolves an *absent* reference by inheriting the previous section's,
  // so an empty page-1 header must be an explicit empty part rather than a
  // missing one — otherwise page 1 falls back to the default and shows the
  // continuation subject it is not supposed to have.
  const files: Array<{ name: string; tag: 'hdr' | 'ftr'; refTag: string; type: string; rel: string; body: string[] }> = [
    { name: 'header1.xml', tag: 'hdr', refTag: 'headerReference', type: 'first', rel: 'rIdHdrFirst', body: parts.firstHeader },
    { name: 'header2.xml', tag: 'hdr', refTag: 'headerReference', type: 'default', rel: 'rIdHdrDefault', body: parts.defaultHeader },
    { name: 'footer1.xml', tag: 'ftr', refTag: 'footerReference', type: 'first', rel: 'rIdFtrFirst', body: parts.firstFooter },
    { name: 'footer2.xml', tag: 'ftr', refTag: 'footerReference', type: 'default', rel: 'rIdFtrDefault', body: parts.defaultFooter },
  ];

  if (parts.evenHeader) {
    files.splice(2, 0, { name: 'header3.xml', tag: 'hdr', refTag: 'headerReference', type: 'even', rel: 'rIdHdrEven', body: parts.evenHeader });
    files.push({ name: 'footer3.xml', tag: 'ftr', refTag: 'footerReference', type: 'even', rel: 'rIdFtrEven', body: parts.defaultFooter });
    const settings = await zip.file('word/settings.xml')?.async('string');
    if (settings) {
      const laterSetting = /<w:(?:bookFoldRevPrinting|bookFoldPrinting|bookFoldPrintingSheets|drawingGridHorizontalSpacing|compat|rsids|themeFontLang)\b|<\/w:settings>/;
      const withoutEven = settings.replace(/<w:evenAndOddHeaders\b[^>]*\/>/, '');
      zip.file('word/settings.xml', withoutEven.replace(laterSetting, '<w:evenAndOddHeaders/>$&'));
    }
  }

  for (const f of files) {
    zip.file(`word/${f.name}`, wrap(f.tag, f.body));
  }

  // --- Update [Content_Types].xml ---
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    let ct = await contentTypesFile.async('string');
    const overrides = files
      .map(f => `<Override PartName="/word/${f.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${f.tag === 'hdr' ? 'header' : 'footer'}+xml"/>`)
      .join('');
    ct = ct.replace('</Types>', `${overrides}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  // --- Update word/_rels/document.xml.rels ---
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    let rels = await relsFile.async('string');
    const relEntries = files
      .map(f => `<Relationship Id="${f.rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${f.tag === 'hdr' ? 'header' : 'footer'}" Target="${f.name}"/>`)
      .join('');
    rels = rels.replace('</Relationships>', `${relEntries}</Relationships>`);
    zip.file('word/_rels/document.xml.rels', rels);
  }

  // --- Wire references and titlePg into sectPr ---
  const refs = files.map(f => `<w:${f.refTag} w:type="${f.type}" r:id="${f.rel}"/>`).join('');
  return xml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, (sectPr) => rebuildSectPr(sectPr, refs, true, startPage));
}

/** Apply the same page-part wiring to the companion's native Pandoc output. */
export async function formatPageFurniture(bytes: Uint8Array, furniture: PageFurniture): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes), document = zip.file('word/document.xml');
  if (!document) throw new Error('Word output is missing its document part.');
  zip.file('word/document.xml', await applyPageFurniture(zip, await document.async('string'), furniture));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
