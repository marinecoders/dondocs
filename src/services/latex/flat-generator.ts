/**
 * Flat LaTeX Generator for Pandoc DOCX Conversion
 *
 * Produces a single, self-contained .tex file using ONLY standard LaTeX
 * constructs that pandoc understands. No custom macros, no \input{} calls.
 *
 * Key pandoc-compatible patterns used throughout:
 * - tabularX{XcX} for centered content (pandoc ignores \begin{center})
 * - tabularX{Xr} for right-aligned content (pandoc ignores \begin{flushright})
 * - tabular for address/ref/encl blocks with proper column alignment
 * - \mbox{label} to protect numbered labels from pandoc's list detection
 * - Blank lines between paragraphs (pandoc ignores \\[Xpt])
 * - \vspace{Xpt} for vertical spacing (12pt/6pt/24pt/48pt)
 * - \newline for line breaks within a paragraph
 */

import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo, Distribution, DocTypeConfig } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { LAYOUT, TEXT_WIDTH_IN } from '@/services/docx/layout-config';
import { splitAddressForLetterhead } from '@/lib/unitAddress';

interface DocumentStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

// --- Utility functions ---

function escapeFlat(str: string | undefined | null): string {
  if (!str) return '';
  // Note: $ uses {\char36} instead of \$ to avoid TS1 font encoding requirement
  // in SwiftLaTeX. Pandoc also handles {\char36} correctly for DOCX.
  // ORDER MATTERS: Use placeholders for replacements that introduce { }
  // so they don't get re-escaped by the { } escaping step.
  return str
    .replace(/\\/g, 'ZZZTEXTBACKSLASHZZZ')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\$/g, 'ZZZDOLLARZZZ')
    .replace(/~/g, 'ZZZTILDEZZZ')
    .replace(/\^/g, 'ZZZCARETZZZ')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/ZZZTEXTBACKSLASHZZZ/g, '\\textbackslash{}')
    .replace(/ZZZDOLLARZZZ/g, '{\\char36}')
    .replace(/ZZZTILDEZZZ/g, '\\textasciitilde{}')
    .replace(/ZZZCARETZZZ/g, '\\textasciicircum{}');
}

/** Escape for use inside tabular cells (& must not be escaped since it's the column separator) */
function escapeTabular(str: string | undefined | null): string {
  if (!str) return '';
  // ORDER MATTERS: Use placeholders for replacements that introduce { }
  // so they don't get re-escaped by the { } escaping step.
  return str
    .replace(/\\/g, 'ZZZTEXTBACKSLASHZZZ')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\$/g, 'ZZZDOLLARZZZ')
    .replace(/~/g, 'ZZZTILDEZZZ')
    .replace(/\^/g, 'ZZZCARETZZZ')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/ZZZTEXTBACKSLASHZZZ/g, '\\textbackslash{}')
    .replace(/ZZZDOLLARZZZ/g, '{\\char36}')
    .replace(/ZZZTILDEZZZ/g, '\\textasciitilde{}')
    .replace(/ZZZCARETZZZ/g, '\\textasciicircum{}');
}

/** Convert rich text markers to standard LaTeX */
function convertRichText(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\\textit{$1}');
  // [^_]+? (not .+?) — see escaper.ts and variable-chip-editor.tsx for
  // the matching change. Prevents `__________` fill-in-the-blank runs
  // from being partially consumed into `\uline{_}` markup. Issue #14.
  result = result.replace(/__([^_]+?)__/g, '\\uline{$1}');

  // Enclosure references: "Enclosure (1)", "enclosure (1)", "Encl (1)" → \enclref{1}
  result = result.replace(/[Ee]nclosure\s*\((\d+)\)/g, '\\enclref{$1}');
  result = result.replace(/[Ee]ncl\s*\((\d+)\)/g, '\\enclref{$1}');

  // Reference cross-links: "Reference (a)", "ref (a)" → \reflink{a}
  result = result.replace(/[Rr]eference\s*\(([a-zA-Z])\)/g, '\\reflink{$1}');
  result = result.replace(/[Rr]ef\s*\(([a-zA-Z])\)/g, '\\reflink{$1}');

  return result;
}

/** Process body text: escape LaTeX specials, handle placeholders, then convert rich text */
function processText(text: string): string {
  // Extract and protect {{PLACEHOLDER}} before escaping
  const placeholderMap: Record<string, string> = {};
  let placeholderIndex = 0;
  let result = text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => {
    const key = `ZZZVARPLACEHOLDER${placeholderIndex++}ZZZ`;
    placeholderMap[key] = name;
    return key;
  });

  // Escape LaTeX specials
  result = result
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');

  // Convert rich text markers
  result = convertRichText(result);

  // Restore placeholders with highlighted LaTeX rendering
  // The Lua filter converts \fcolorbox to bold {{NAME}} for DOCX
  for (const [key, name] of Object.entries(placeholderMap)) {
    const escapedName = name.replace(/_/g, '\\_');
    result = result.replace(key, `\\fcolorbox{orange}{yellow!30}{\\textsf{\\small ${escapedName}}}`);
  }

  return result;
}

function capitalizeWord(word: string | undefined): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Strip punctuation from paragraph headers per SECNAV formatting rules.
 * Dashes (-, –, —) are preserved; all other punctuation is removed. */
function stripHeaderPunctuation(text: string): string {
  return text.replace(/[(),.;:!?'"/\\]/g, '').replace(/\s+/g, ' ').trim();
}

/** Underline entire header text using ulem's \uline for proper positioning. */
function underlineWords(text: string): string {
  return `\\uline{${text}}`;
}

function toTitleCase(str: string): string {
  const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
  return str.split(' ').map((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0 || !lowercaseWords.includes(lower)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return lower;
  }).join(' ');
}

function abbreviateName(first: string | undefined, middle: string | undefined, last: string | undefined): string {
  const parts: string[] = [];
  if (first) parts.push(`${first[0].toUpperCase()}.`);
  if (middle) parts.push(`${middle[0].toUpperCase()}.`);
  if (last) parts.push(last.toUpperCase());
  return parts.join(' ');
}

function buildFullName(first: string | undefined, middle: string | undefined, last: string | undefined): string {
  return [capitalizeWord(first), capitalizeWord(middle), last?.toUpperCase() || ''].filter(Boolean).join(' ');
}

/** Generate paragraph label per SECNAV Ch 7 ¶13, Figure 7-8.
 * Levels 0-3: 1./a./(1)/(a) — plain
 * Levels 4-7: same pattern but underlined (spec levels 5-8) */
function getParagraphLabel(level: number, count: number): string {
  const patterns = [
    (n: number) => `${n}.`,
    (n: number) => `${String.fromCharCode(96 + n)}.`,
    (n: number) => `(${n})`,
    (n: number) => `(${String.fromCharCode(96 + n)})`,
  ];
  const label = patterns[level % 4](count);
  return level >= 4 ? `\\uline{${label}}` : label;
}

function calculateLabels(paragraphs: Paragraph[]): string[] {
  const labels: string[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const para of paragraphs) {
    for (let i = para.level + 1; i < 8; i++) counters[i] = 0;
    counters[para.level]++;
    labels.push(getParagraphLabel(para.level, counters[para.level]));
  }
  return labels;
}

function getDepartmentName(dept: string | undefined): string {
  switch (dept) {
    case 'usmc': return 'UNITED STATES MARINE CORPS';
    case 'navy': return 'DEPARTMENT OF THE NAVY';
    case 'dod': return 'DEPARTMENT OF DEFENSE';
    default: return 'UNITED STATES MARINE CORPS';
  }
}

// --- Section builders (pandoc-friendly) ---

function getFontPackage(fontFamily: string): string {
  switch (fontFamily) {
    case 'courier':
      return '\\usepackage{courier}\n\\renewcommand{\\familydefault}{\\ttdefault}';
    case 'times':
    default:
      return '\\usepackage{mathptmx}'; // Times New Roman equivalent
  }
}

function buildPreamble(data: Partial<DocumentData>): string {
  const fontSize = data.fontSize || '12pt';
  const fontFamily = data.fontFamily || 'times';

  // PMS 288 navy blue per MCO 5216.20B Section 2, para 1.a
  const letterheadColor = data.letterheadColor === 'black' ? 'black' : 'navyblue';
  const colorDef = letterheadColor === 'navyblue'
    ? '\\definecolor{navyblue}{RGB}{0,32,91}'
    : ''; // black is a built-in color

  return `\\documentclass[${fontSize}]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{fancyhdr}
\\usepackage{tabularx}
\\usepackage{graphicx}
\\usepackage{setspace}
\\usepackage{xcolor}
${getFontPackage(fontFamily)}
${colorDef}
\\singlespacing
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
`;
}

function buildClassificationHeaders(data: Partial<DocumentData>): string {
  const classLevel = data.classLevel;
  if (!classLevel || classLevel === 'unclassified') return '';

  let marking = '';
  if (classLevel === 'cui') marking = 'CUI';
  else if (classLevel === 'custom' && data.customClassification) marking = data.customClassification;
  else {
    const map: Record<string, string> = {
      confidential: 'CONFIDENTIAL',
      secret: 'SECRET',
      top_secret: 'TOP SECRET',
      top_secret_sci: 'TOP SECRET//SCI',
    };
    marking = map[classLevel] || '';
  }

  if (!marking) return '';

  return `\\fancyhead[C]{\\textbf{${escapeFlat(marking)}}}
\\fancyfoot[C]{\\textbf{${escapeFlat(marking)}}}
`;
}

function buildPageNumbering(data: Partial<DocumentData>): string {
  const style = data.pageNumbering || 'none';
  if (style === 'none') return '\\pagenumbering{gobble}\n';
  // Support custom starting page number (e.g., for endorsements continuing a letter)
  const startPage = data.startingPageNumber && data.startingPageNumber > 1
    ? `\\setcounter{page}{${data.startingPageNumber}}\n`
    : '';
  // SECNAV: no page number on first page, numbered on subsequent pages
  // Use right footer to avoid conflict with classification markings in center footer
  return `\\fancypagestyle{plain}{\\fancyhf{}}\n\\thispagestyle{plain}\n\\fancyfoot[R]{\\thepage}\n${startPage}`;
}

/** Centered letterhead using tabularX (pandoc renders center alignment in DOCX) */
function buildLetterhead(data: Partial<DocumentData>): string {
  const dept = getDepartmentName(data.department);
  const unit1 = escapeTabular(data.unitLine1);
  const unit2 = data.unitLine2?.trim() ? escapeTabular(data.unitLine2) : '';

  // Split `unitAddress` into letterhead lines via the shared helper
  // (single source of truth — generator.ts uses the same).
  const { line1: addr1, line2: addr2 } = splitAddressForLetterhead(data.unitAddress || '');

  // Determine seal filename: {sealType}-seal{-bw if black}.png
  const sealType = data.sealType || 'dow';
  const bwSuffix = data.letterheadColor === 'black' ? '-bw' : '';
  const sealFile = `${sealType}-seal${bwSuffix}.png`;

  // Per SECNAV M-5216.5 App C §2a (Computer Generated Letterhead):
  //   Department line: 10pt bold, colored (PMS 288 navy blue or black)
  //   Activity/unit name: 8pt, colored (NOT bold — App C §1d(2))
  //   Address lines: 8pt, colored
  const color = data.letterheadColor === 'black' ? 'black' : 'navyblue';

  // Build center-column content using \newline for line breaks within a cell.
  // NOTE: We cannot use a nested \begin{tabular}{c} here because pandoc
  // flattens nested tables into separate blocks, breaking the 3-column layout.
  // Font size commands: \fontsize{size}{baselineskip}\selectfont
  const lines: string[] = [];
  lines.push(`{\\fontsize{10pt}{11pt}\\selectfont\\textcolor{${color}}{\\textbf{${dept}}}}`);
  lines.push(`{\\fontsize{8pt}{9pt}\\selectfont\\textcolor{${color}}{${unit1}}}`);
  if (unit2) lines.push(`{\\fontsize{8pt}{9pt}\\selectfont\\textcolor{${color}}{${unit2}}}`);
  lines.push(`{\\fontsize{8pt}{9pt}\\selectfont\\textcolor{${color}}{${escapeTabular(addr1)}}}`);
  if (addr2) lines.push(`{\\fontsize{8pt}{9pt}\\selectfont\\textcolor{${color}}{${escapeTabular(addr2)}}}`);
  const centerContent = lines.join(' \\newline\n');

  // 3-column layout: seal | centered org text | right spacer (mirrors seal width)
  // Equal left/right fixed columns center the org text on the full page width.
  // The Lua filter detects this as a letterhead table (Image in first cell)
  // and forces AlignCenter on the middle column for DOCX output.
  const sealColIn = (LAYOUT.letterhead.sealCol * TEXT_WIDTH_IN).toFixed(2);
  return `\\noindent
\\begin{tabularx}{\\textwidth}{@{}p{${sealColIn}in}@{}X@{}p{${sealColIn}in}@{}}
\\includegraphics[width=1.09in]{${sealFile}} & ${centerContent} & \\\\
\\end{tabularx}

\\vspace{12pt}
`;
}

/** Right-aligned SSIC/Serial/Date block using tabularX */
function buildSSICBlock(data: Partial<DocumentData>, alignRight = true): string {
  const items: string[] = [];
  if (data.ssic) items.push(escapeTabular(data.ssic));
  if (data.serial) items.push(escapeTabular(data.serial));
  if (data.date) items.push(escapeTabular(data.date));

  if (items.length === 0) return '';

  if (alignRight) {
    const rows = items.map(item => ` & ${item} \\\\`).join('\n');
    return `\\noindent
\\begin{tabularx}{\\textwidth}{@{}X@{}l@{}}
${rows}
\\end{tabularx}

\\vspace{12pt}
`;
  }

  // Left-aligned: simple tabular (matches PDF templates that use \hfill at paragraph boundary)
  const rows = items.map(item => `${item} \\\\`).join('\n');
  return `\\noindent
\\begin{tabular}{@{}l@{}}
${rows}
\\end{tabular}

\\vspace{12pt}
`;
}

function buildInReplyTo(data: Partial<DocumentData>): string {
  if (!data.inReplyTo || !data.inReplyToText) return '';
  return `\\noindent
\\begin{tabularx}{\\textwidth}{@{}Xr@{}}
 & In reply refer to: \\\\
 & ${escapeTabular(data.inReplyToText)} \\\\
\\end{tabularx}

`;
}

/** Wrap text at a character limit without breaking words (for Subject/From/To lines).
 * Per SECNAV M-5216.5 subject lines wrap at ~57 characters. */
function wrapText(str: string, maxLength: number = 57): string[] {
  if (!str) return [];
  const lines: string[] = [];
  let i = 0;
  while (i < str.length) {
    let chunk = str.substring(i, i + maxLength);
    if (i + maxLength < str.length && str[i + maxLength] !== ' ' && chunk.includes(' ')) {
      const lastSpace = chunk.lastIndexOf(' ');
      if (lastSpace > -1) {
        chunk = chunk.substring(0, lastSpace);
        i += chunk.length + 1;
      } else {
        i += maxLength;
      }
    } else {
      i += maxLength;
    }
    lines.push(chunk.trim());
  }
  return lines;
}

/** Escape and wrap a tabular cell value, joining wrapped lines with \\newline */
function escapeTabularWrapped(str: string | undefined | null, maxLength: number = 57): string {
  if (!str) return '';
  const wrapped = wrapText(str, maxLength);
  return wrapped.map(l => escapeTabular(l)).join(' \\newline\n');
}

/** Conditionally wrap subject text in \\uline{} based on the underlineSubject flag. */
function maybeUnderline(text: string, underline: boolean | undefined): string {
  return underline ? `\\uline{${text}}` : text;
}

/** Strip trailing \\\\ (with optional spacing param) from the last row of a tabular
 * to avoid creating an empty row at the bottom. Matches the PDF template fix
 * where trailing \tabularnewline was removed before \end{tabular}. */
function trimLastRow(rows: string[]): string {
  if (rows.length === 0) return '';
  const result = [...rows];
  result[result.length - 1] = result[result.length - 1].replace(/ \\\\(\[-?\d+pt\])?$/, '');
  return result.join('\n');
}

/** Address block (From/To/Via/Subj) using tabular for proper alignment.
 * Colon spacing per SECNAV Ch 7: From=2sp, To=6sp, Via=5sp, Subj=3sp */
function buildAddressBlock(data: Partial<DocumentData>, config: DocTypeConfig): string {
  const rows: string[] = [];

  if (config.fromTo) {
    if (data.from) rows.push(`From:\\hspace{2\\fontdimen2\\font} & ${escapeTabularWrapped(data.from)} \\\\`);
    if (data.to) rows.push(`To:\\hspace{6\\fontdimen2\\font} & ${escapeTabularWrapped(data.to)} \\\\`);
  }

  if (config.via && data.via?.trim()) {
    const viaLines = data.via.split('\n').filter((l: string) => l.trim());
    // Per SECNAV Ch 9 ¶2: suppress (1) numbering when only one via
    const useNumbering = viaLines.length > 1;
    for (let i = 0; i < viaLines.length; i++) {
      const prefix = useNumbering ? `(${i + 1}) ` : '';
      if (i === 0) {
        rows.push(`Via:\\hspace{5\\fontdimen2\\font} & ${prefix}${escapeTabularWrapped(viaLines[i])} \\\\`);
      } else {
        rows.push(` & ${prefix}${escapeTabularWrapped(viaLines[i])} \\\\`);
      }
    }
  }

  if (data.subject && !config.skipSubject) {
    // 12pt space before Subj (matches PDF's \tabularnewline[12pt] in templates)
    // Use explicit empty spacer row because pandoc ignores \\[12pt] row spacing
    if (rows.length > 0) {
      rows.push(`& \\\\`);
    }
    rows.push(`Subj:\\hspace{3\\fontdimen2\\font} & ${maybeUnderline(escapeTabularWrapped(data.subject?.toUpperCase()), data.underlineSubject)} \\\\`);
  }

  if (rows.length === 0) return '';

  return `\\noindent
\\begin{tabular}{@{}l@{}p{5.75in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** References using tabular for proper hanging-indent alignment.
 * Colon spacing per SECNAV Ch 7 ¶10c: Ref=4sp */
function buildReferences(references: Reference[]): string {
  if (references.length === 0) return '';

  const rows: string[] = [];
  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    if (i === 0) {
      rows.push(`Ref:\\hspace{4\\fontdimen2\\font} & (${ref.letter})~~${escapeTabular(ref.title)} \\\\`);
    } else {
      rows.push(` & (${ref.letter})~~${escapeTabular(ref.title)} \\\\`);
    }
  }

  // 12pt before Ref block (matches PDF's \vspace{12pt} in main.tex printReferences)
  return `\\vspace{12pt}
\\noindent
\\begin{tabular}{@{}l@{}p{5.75in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Enclosures using tabular for proper hanging-indent alignment.
 * Colon spacing per SECNAV Ch 7 ¶11b: Encl=3sp */
function buildEnclosures(enclosures: Enclosure[]): string {
  if (enclosures.length === 0) return '';

  const rows: string[] = [];
  for (let i = 0; i < enclosures.length; i++) {
    const encl = enclosures[i];
    if (i === 0) {
      rows.push(`Encl:\\hspace{3\\fontdimen2\\font} & (${i + 1})~~${escapeTabular(encl.title)} \\\\`);
    } else {
      rows.push(` & (${i + 1})~~${escapeTabular(encl.title)} \\\\`);
    }
  }

  // 12pt before Encl block (matches PDF's \vspace{12pt} in main.tex printEnclosureList)
  return `\\vspace{12pt}
\\noindent
\\begin{tabular}{@{}l@{}p{5.75in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Body paragraphs using \mbox{} to protect labels from pandoc list detection.
 *
 * Indentation per SECNAV M-5216.5 Ch 7 ¶13:
 *   Standard: level 0 = flush left; subparagraphs indent 0.25in per level
 *   Business: level 0 = 0.5in first-line indent; subparagraphs += 0.5in per level
 */
function buildBody(paragraphs: Paragraph[], config: DocTypeConfig): string {
  if (paragraphs.length === 0) return '';

  const labels = calculateLabels(paragraphs);
  const useNumbered = config.compliance.numberedParagraphs;
  // Push-then-join across paragraphs (the cross-paragraph accumulator is
  // the one that grows unbounded — within a single paragraph the
  // accumulator stays small so we leave that alone).
  const bodyParts: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const label = useNumbered ? labels[i] : '';
    const headerText = para.header?.trim();
    const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';
    // 12pt for level 0 paragraphs, 6pt for sub-paragraphs
    const spacing = para.level === 0 ? '\\vspace{12pt}' : '\\vspace{6pt}';

    let paraText = '';

    // Portion marking
    if (portionPrefix) paraText += portionPrefix;

    // Optional underlined header
    if (headerText) {
      paraText += `${underlineWords(escapeFlat(toTitleCase(stripHeaderPunctuation(headerText))))}. `;
    }

    // Body text with rich text processing
    paraText += processText(para.text);

    // Calculate indentation based on level and document type
    // \dondocsindent → w:ind w:left (full paragraph indent)
    // \dondocsfirstindent → w:ind w:firstLine (first-line only, like \parindent)
    const isBusiness = config.uiMode === 'business';
    const indentIn = isBusiness
      ? (para.level + 1) * 0.5   // Business: 0.5in per level, starting at 0.5in
      : para.level * 0.25;        // Standard: 0.25in per level (level 0 = flush left)
    const indentCmd = indentIn > 0 ? `\\dondocsindent{${indentIn.toFixed(2)}in}` : '';

    if (isBusiness) {
      // Business letter: first-line indent for level 0, full indent for deeper levels
      const bizIndentCmd = para.level === 0
        ? `\\dondocsfirstindent{0.50in}`
        : indentCmd;
      bodyParts.push(`${spacing}\n${bizIndentCmd}${paraText}\n\n`);
    } else if (label) {
      // Use \mbox{} to protect labels like "1." from pandoc's list marker detection.
      // The Lua filter's RawInline handler converts \mbox{} to plain text for DOCX.
      bodyParts.push(`${spacing}\n${indentCmd}\\mbox{${label}}~~${paraText}\n\n`);
    } else {
      // No label (unnumbered paragraphs, e.g. endorsements)
      bodyParts.push(`${spacing}\n${indentCmd}${paraText}\n\n`);
    }
  }

  return bodyParts.join('');
}

/** Single signature block positioned in right half using tabularX */
function buildSignature(data: Partial<DocumentData>, config: DocTypeConfig): string {
  const sigStyle = config.signature;
  let name: string;
  if (sigStyle === 'abbrev') {
    name = abbreviateName(data.sigFirst, data.sigMiddle, data.sigLast);
  } else {
    name = buildFullName(data.sigFirst, data.sigMiddle, data.sigLast);
  }

  const sigRows: string[] = [];
  sigRows.push(escapeTabular(name));

  // Show rank/title unless config says name-only (e.g., standard_letter, plain_paper_memorandum)
  if (config.showSignatureRankTitle !== false) {
    if (data.sigRank) sigRows.push(escapeTabular(data.sigRank));
    if (data.sigTitle) sigRows.push(escapeTabular(data.sigTitle));
  }
  if (data.byDirection) {
    const authority = data.byDirectionAuthority || 'the Commanding Officer';
    sigRows.push(`By direction of ${escapeTabular(authority)}`);
  }

  const rows = sigRows.map(r => ` & ${r} \\\\`).join('\n');

  const sigSpacing = config.signatureSpacing || '48pt';

  return `\\vspace{${sigSpacing}}
\\noindent
\\begin{tabularx}{\\textwidth}{@{}X@{}l@{}}
${rows}
\\end{tabularx}

`;
}

/** Business letter signature (centered with complimentary close)
 * Per SECNAV Ch 11, Para 11-10-12: close and signature block centered */
function buildBusinessSignature(data: Partial<DocumentData>): string {
  const name = buildFullName(data.sigFirst, data.sigMiddle, data.sigLast);
  const close = escapeTabular(data.complimentaryClose || 'Sincerely,');

  // Build centered signature rows
  const sigRows: string[] = [];
  sigRows.push(escapeTabular(name));
  if (data.sigRank) sigRows.push(escapeTabular(data.sigRank));
  if (data.sigTitle) sigRows.push(escapeTabular(data.sigTitle));
  if (data.byDirection) {
    const authority = data.byDirectionAuthority || 'the Commanding Officer';
    sigRows.push(`By direction of ${escapeTabular(authority)}`);
  }

  // Use tabularX{XcX} for centering (pandoc ignores \begin{center})
  const sig = `\\vspace{24pt}
\\noindent
\\begin{tabularx}{\\textwidth}{@{}XcX@{}}
 & ${close} & \\\\
\\end{tabularx}

\\vspace{48pt}
\\noindent
\\begin{tabularx}{\\textwidth}{@{}XcX@{}}
${trimLastRow(sigRows.map(r => ` & ${r} & \\\\`))}
\\end{tabularx}

`;
  return sig;
}

/** Dual signature block using tabularX with two columns.
 * MOA/MOU: overscored (horizontal rule above name) per SECNAV M-5216.5 Fig 10-5
 * Joint/Joint Memo: no overscoring per Ch 7 Fig 7-4 */
function buildDualSignature(data: Partial<DocumentData>, variant: 'moa' | 'joint' | 'joint_memo'): string {
  let juniorName = '', juniorRank = '', juniorTitle = '';
  let seniorName = '', seniorRank = '', seniorTitle = '';

  if (variant === 'moa') {
    const junFirst = capitalizeWord(data.juniorSigName?.split(' ')[0]);
    const junLast = data.juniorSigName?.split(' ').slice(-1)[0]?.toUpperCase() || '';
    juniorName = junFirst ? `${junFirst[0]}. ${junLast}` : junLast;
    juniorRank = data.juniorSigRank || '';
    juniorTitle = data.juniorSigTitle || '';

    const senFirst = capitalizeWord(data.seniorSigName?.split(' ')[0]);
    const senLast = data.seniorSigName?.split(' ').slice(-1)[0]?.toUpperCase() || '';
    seniorName = senFirst ? `${senFirst[0]}. ${senLast}` : senLast;
    seniorRank = data.seniorSigRank || '';
    seniorTitle = data.seniorSigTitle || '';
  } else {
    // Joint letter and joint memo share the same fields
    juniorName = data.jointJuniorSigName?.toUpperCase() || '';
    juniorTitle = data.jointJuniorSigTitle || '';
    seniorName = data.jointSeniorSigName?.toUpperCase() || '';
    seniorTitle = data.jointSeniorSigTitle || '';
  }

  // MOA/MOU: overscored signatures (rule above name)
  // Per SECNAV M-5216.5 Fig 10-5: junior LEFT (signs first), senior RIGHT (signs last)
  // Use p{3in}@{\hfill}p{3in} — same columns as SSIC/date block for alignment.
  // Name/rank/title cells use \centering to center text under the signature line.
  // Pandoc converts \centering in p{} cells to centered paragraph alignment in DOCX.
  if (variant === 'moa') {
    const sigLine = '\\_'.repeat(24); // ~2in signature line at 12pt
    const rows: string[] = [];

    // Row 1: overscore lines (left-aligned within column, matching date alignment)
    rows.push(`${sigLine} & ${sigLine} \\\\`);

    // Remaining rows: centered text under each signature line
    rows.push(`\\centering ${escapeTabular(juniorName)} & \\centering ${escapeTabular(seniorName)} \\\\`);
    if (juniorRank || seniorRank) {
      rows.push(`\\centering ${escapeTabular(juniorRank)} & \\centering ${escapeTabular(seniorRank)} \\\\`);
    }
    if (juniorTitle || seniorTitle) {
      rows.push(`\\centering ${escapeTabular(juniorTitle)} & \\centering ${escapeTabular(seniorTitle)} \\\\`);
    }

    return `\\vspace{48pt}
\\noindent
\\begin{tabular}{@{}p{3in}@{\\hfill}p{3in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
  }

  // Joint/Joint Memo: no overscoring, separate rows for each sig field.
  // Per SECNAV M-5216.5 Ch 7 Fig 7-4: Two signature blocks side by side.
  // Uses p{2.75in} columns so pandoc constrains column width and wraps long text.
  // Each field (name, rank, each title line) is a separate table row so pandoc
  // reliably creates line breaks (pandoc ignores \newline inside p{} cells).
  // Title fields support multi-line input from the UI textarea — each \n-separated
  // line becomes its own row (e.g., "Captain, U.S. Navy\nCommanding Officer" → 2 rows).
  const rows: string[] = [];
  rows.push(`${escapeTabular(juniorName)} & ${escapeTabular(seniorName)} \\\\`);

  if (juniorRank || seniorRank) {
    rows.push(`${escapeTabular(juniorRank)} & ${escapeTabular(seniorRank)} \\\\`);
  }

  // Split multi-line titles into separate rows
  const juniorTitleLines = juniorTitle ? juniorTitle.split('\n').filter(l => l.trim()) : [];
  const seniorTitleLines = seniorTitle ? seniorTitle.split('\n').filter(l => l.trim()) : [];
  const maxTitleLines = Math.max(juniorTitleLines.length, seniorTitleLines.length);
  for (let i = 0; i < maxTitleLines; i++) {
    const jLine = juniorTitleLines[i] || '';
    const sLine = seniorTitleLines[i] || '';
    rows.push(`${escapeTabular(jLine)} & ${escapeTabular(sLine)} \\\\`);
  }

  // Use p{3in}@{\hfill}p{3in} to match PDF template (joint_letter.tex \printSignature)
  // and stay consistent with the SSIC block layout above.
  return `\\vspace{48pt}
\\noindent
\\begin{tabular}{@{}p{3in}@{\\hfill}p{3in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Copy-to list using address-style tabular (label | content).
 * The Lua filter detects "Copy to:" as an address label and applies
 * the correct label/content column proportions (11.5% / 88.5%). */
function buildCopyTo(copyTos: CopyTo[]): string {
  if (copyTos.length === 0) return '';

  const rows: string[] = [];
  for (let i = 0; i < copyTos.length; i++) {
    if (i === 0) {
      rows.push(`Copy to: & ${escapeTabular(copyTos[i].text)} \\\\`);
    } else {
      rows.push(` & ${escapeTabular(copyTos[i].text)} \\\\`);
    }
  }

  return `\\vspace{12pt}
\\noindent
\\begin{tabular}{@{}l@{\\hspace{2\\fontdimen2\\font}}p{5.5in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Distribution list using address-style tabular (label | content).
 * Mirrors buildCopyTo but with "Distribution:" label for action addressees. */
function buildDistribution(distributions: Distribution[]): string {
  if (distributions.length === 0) return '';

  const rows: string[] = [];
  for (let i = 0; i < distributions.length; i++) {
    if (i === 0) {
      rows.push(`Distribution: & ${escapeTabular(distributions[i].text)} \\\\`);
    } else {
      rows.push(` & ${escapeTabular(distributions[i].text)} \\\\`);
    }
  }

  return `\\vspace{12pt}
\\noindent
\\begin{tabular}{@{}l@{\\hspace{2\\fontdimen2\\font}}p{5.5in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** CUI marking block */
function buildCUIBlock(data: Partial<DocumentData>): string {
  if (data.classLevel !== 'cui') return '';

  let block = '\\vspace{24pt}\n\\noindent\n\\rule{\\textwidth}{0.5pt}\n\n';
  block += '\\textbf{CUI}\n\n';
  if (data.cuiControlledBy) block += `Controlled by: ${escapeFlat(data.cuiControlledBy)}\n\n`;
  if (data.cuiCategory) block += `CUI Category: ${escapeFlat(data.cuiCategory)}\n\n`;
  if (data.cuiDissemination) block += `Limited Dissemination Control: ${escapeFlat(data.cuiDissemination)}\n\n`;
  if (data.cuiDistStatement) block += `Distribution Statement: ${escapeFlat(data.cuiDistStatement)}\n\n`;
  if (data.pocEmail) block += `POC: ${escapeFlat(data.pocEmail)}\n\n`;
  return block;
}

/** Classified marking block */
function buildClassifiedBlock(data: Partial<DocumentData>): string {
  if (!data.classLevel || data.classLevel === 'unclassified' || data.classLevel === 'cui' || data.classLevel === 'custom') return '';

  let block = '\\vspace{24pt}\n\\noindent\n\\rule{\\textwidth}{0.5pt}\n\n';
  if (data.classifiedBy) block += `Classified by: ${escapeFlat(data.classifiedBy)}\n\n`;
  if (data.derivedFrom) block += `Derived from: ${escapeFlat(data.derivedFrom)}\n\n`;
  if (data.declassifyOn) block += `Declassify on: ${escapeFlat(data.declassifyOn)}\n\n`;
  if (data.classReason) block += `Reason: ${escapeFlat(data.classReason)}\n\n`;
  if (data.classifiedPocEmail) block += `POC: ${escapeFlat(data.classifiedPocEmail)}\n\n`;
  return block;
}

/** Centered memo header using tabularX */
function buildMemoHeader(config: DocTypeConfig, data?: Partial<DocumentData>): string {
  let title = config.memoTitle || 'MEMORANDUM';
  // MF: addressee is embedded in the title ("MEMORANDUM FOR [addressee]")
  if (config.memoTitle === 'MEMORANDUM FOR' && data?.to) {
    title += ` ${escapeTabular(data.to)}`;
  }
  return `\\noindent
\\begin{tabularx}{\\textwidth}{@{}X@{}c@{}X@{}}
 & \\textbf{${title}} & \\\\
\\end{tabularx}

`;
}

function buildDecisionBlock(): string {
  // Decision block: APPROVED/DISAPPROVED signature lines.
  // Use simple paragraph layout instead of tabular — pandoc handles \rule
  // inside tabular inconsistently, but standalone \rule works reliably.
  // Each label + signature line on its own paragraph for clean DOCX output.
  return `\\vspace{24pt}
\\noindent
\\rule{\\textwidth}{0.5pt}

\\vspace{12pt}
\\noindent APPROVED:\\hspace{1em}\\rule{3in}{0.5pt}

\\vspace{24pt}
\\noindent DISAPPROVED:\\hspace{1em}\\rule{3in}{0.5pt}
`;
}

/** Centered MOA/MOU title using tabularX with \newline breaks.
 * NOTE: We must NOT use nested \begin{tabular}{c} here because pandoc
 * flattens nested tables into separate blocks, breaking the centered layout.
 * Instead we use \newline for line breaks within the center cell (same
 * pattern as buildLetterhead and buildMemoHeader). */
function buildMOATitle(data: Partial<DocumentData>, docType: string): string {
  const type = docType === 'mou' ? 'UNDERSTANDING' : 'AGREEMENT';
  const lines = [
    `\\textbf{MEMORANDUM OF ${type}}`,
    '\\textbf{BETWEEN}',
    `\\textbf{${escapeTabular(data.seniorCommandName?.toUpperCase())}}`,
    '\\textbf{AND}',
    `\\textbf{${escapeTabular(data.juniorCommandName?.toUpperCase())}}`,
  ];
  const centerContent = lines.join(' \\newline\n');

  // 12pt space before title (after SSIC block) and after title (before Subj)
  return `\\vspace{12pt}
\\noindent
\\begin{tabularx}{\\textwidth}{@{}X@{}c@{}X@{}}
 & ${centerContent} & \\\\
\\end{tabularx}

\\vspace{12pt}
`;
}

/** MOA dual SSIC blocks — junior on left, senior on right.
 * Per SECNAV M-5216.5: Junior command LEFT (signs first), Senior command RIGHT (signs last).
 * Matches signature block positioning and the fixed PDF templates (moa.tex/mou.tex). */
function buildMOASSICBlock(data: Partial<DocumentData>): string {
  // Junior command on LEFT (signs first)
  const leftItems: string[] = [];
  if (data.juniorSSIC) leftItems.push(escapeTabular(data.juniorSSIC));
  if (data.juniorSerial) leftItems.push(escapeTabular(data.juniorSerial));
  if (data.juniorDate) leftItems.push(escapeTabular(data.juniorDate));

  // Senior command on RIGHT (signs last)
  const rightItems: string[] = [];
  if (data.seniorSSIC || data.ssic) rightItems.push(escapeTabular(data.seniorSSIC || data.ssic));
  if (data.seniorSerial || data.serial) rightItems.push(escapeTabular(data.seniorSerial || data.serial));
  if (data.seniorDate || data.date) rightItems.push(escapeTabular(data.seniorDate || data.date));

  const maxRows = Math.max(leftItems.length, rightItems.length);
  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    rows.push(`${leftItems[i] || ''} & ${rightItems[i] || ''} \\\\`);
  }

  return `\\noindent
\\begin{tabular}{@{}p{3in}@{\\hfill}p{3in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

function buildEndorsementHeader(docType: string, data: Partial<DocumentData>): string {
  // Per SECNAV M-5216.5 Ch 9 §2.1.b the endorsement line is:
  //   "[ORDINAL] ENDORSEMENT on [basic letter id]"
  //
  // Prefer the structured fields populated by the AddressingSection UI
  // (`endorsementOrdinal` dropdown + `basicLetterId` input). Fall back
  // to regex-parsing the subject for sessions saved before those fields
  // existed.
  let ordinal = data.endorsementOrdinal?.trim() || '';
  let basicLetterId = data.basicLetterId?.trim() || '';

  if (!ordinal || !basicLetterId) {
    const subjectText = data.subject || '';
    const match = subjectText.match(/^(.+?)\s+ENDORSEMENT(?:\s+on\s+(.+))?$/i);
    if (match) {
      if (!ordinal) ordinal = match[1].trim();
      if (!basicLetterId) basicLetterId = match[2]?.trim() || '';
    }
  }

  // Compose the endorsement line. Default to "FIRST ENDORSEMENT" when
  // nothing is set so the document still renders something coherent.
  const ordinalUpper = (ordinal || 'FIRST').toUpperCase();
  const endorsementLine = basicLetterId
    ? `${ordinalUpper} ENDORSEMENT on ${escapeFlat(basicLetterId)}`
    : `${ordinalUpper} ENDORSEMENT`;

  if (docType === 'same_page_endorsement') {
    return `\\vspace{24pt}\n\\rule{\\textwidth}{0.5pt}\n\n${endorsementLine}\n\n\\vspace{12pt}\n`;
  }
  return `${endorsementLine}\n\n\\vspace{12pt}\n`;
}

/** Joint letterhead: centered stacked layout using tabularX.
 * Per SECNAV M-5216.5 Ch 7 Figure 7-4: Plain bond with typed command titles.
 * DEPARTMENT OF THE NAVY header, then senior command (top), junior command (below),
 * with optional common location. Matches the PDF template's joint_letter.tex layout. */
function buildJointLetterhead(data: Partial<DocumentData>): string {
  // Joint letterheads are always black — per SECNAV M-5216.5 Ch 7 Fig 7-4,
  // joint letters use plain bond paper with typed (not printed/colored) command titles.
  // The joint letter UI has no color picker, so letterheadColor is irrelevant here.
  const lines: string[] = [];
  lines.push(`{\\fontsize{10pt}{11pt}\\selectfont\\textbf{DEPARTMENT OF THE NAVY}}`);

  // Senior command on top, junior below (per SECNAV)
  const seniorLine = data.jointSeniorName
    ? `${escapeTabular(data.jointSeniorName.toUpperCase())}${data.jointSeniorZip ? ` (${escapeTabular(data.jointSeniorZip)})` : ''}`
    : '';
  const juniorLine = data.jointJuniorName
    ? `${escapeTabular(data.jointJuniorName.toUpperCase())}${data.jointJuniorZip ? ` (${escapeTabular(data.jointJuniorZip)})` : ''}`
    : '';

  if (seniorLine) lines.push(`{\\fontsize{8pt}{9pt}\\selectfont ${seniorLine}}`);
  if (juniorLine) lines.push(`{\\fontsize{8pt}{9pt}\\selectfont ${juniorLine}}`);

  // Common location (e.g., "CAMP LEJEUNE, NC 28542")
  if (data.jointCommonLocation?.trim()) {
    lines.push(`{\\fontsize{8pt}{9pt}\\selectfont ${escapeTabular(data.jointCommonLocation.toUpperCase())}}`);
  }

  const centerContent = lines.join(' \\newline\n');

  // Use a centered tabularX layout (same pattern as standard letterhead but without seal)
  // One line of space after letterhead per SECNAV M-5216.5
  return `\\noindent
\\begin{tabularx}{\\textwidth}{@{}X@{}c@{}X@{}}
 & ${centerContent} & \\\\
\\end{tabularx}

\\vspace{12pt}
`;
}

/** Joint SSIC block: junior on left, senior on right.
 * Per SECNAV M-5216.5 Ch 7 Fig 7-4: Junior command SSIC/Serial/Date on LEFT,
 * Senior command Code/SSIC/Serial/Date on RIGHT.
 * PDF template uses DocumentSSIC/DocumentSerial/DocumentDate for senior side,
 * which map to data.ssic/data.serial/data.date. */
function buildJointSSICBlock(data: Partial<DocumentData>): string {
  // Junior command on LEFT (signs first)
  const leftItems: string[] = [];
  if (data.jointJuniorCode) leftItems.push(escapeTabular(data.jointJuniorCode));
  if (data.jointJuniorSSIC) leftItems.push(escapeTabular(data.jointJuniorSSIC));
  if (data.jointJuniorSerial) leftItems.push(escapeTabular(data.jointJuniorSerial));
  if (data.jointJuniorDate) leftItems.push(escapeTabular(data.jointJuniorDate));

  // Senior command on RIGHT (signs last)
  const rightItems: string[] = [];
  if (data.jointSeniorCode) rightItems.push(escapeTabular(data.jointSeniorCode));
  if (data.ssic) rightItems.push(escapeTabular(data.ssic));
  if (data.serial) rightItems.push(escapeTabular(data.serial));
  if (data.date) rightItems.push(escapeTabular(data.date));

  const maxRows = Math.max(leftItems.length, rightItems.length);
  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    rows.push(`${leftItems[i] || ''} & ${rightItems[i] || ''} \\\\`);
  }

  return `\\noindent
\\begin{tabular}{@{}p{3in}@{\\hfill}p{3in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Joint address block using tabular.
 * Colon spacing per SECNAV Ch 7: From=2sp, To=6sp, Subj=3sp */
function buildJointAddressBlock(data: Partial<DocumentData>): string {
  const rows: string[] = [];

  if (data.jointSeniorFrom) rows.push(`From:\\hspace{2\\fontdimen2\\font} & ${escapeTabularWrapped(data.jointSeniorFrom)} \\\\`);
  if (data.jointJuniorFrom) rows.push(` & ${escapeTabularWrapped(data.jointJuniorFrom)} \\\\`);
  if (data.jointTo) rows.push(`To:\\hspace{6\\fontdimen2\\font} & ${escapeTabularWrapped(data.jointTo)} \\\\`);
  if (data.jointSubject) {
    // 12pt space before Subj (matches PDF's \tabularnewline[12pt] in templates)
    // Use explicit empty spacer row because pandoc ignores \\[12pt] row spacing
    if (rows.length > 0) {
      rows.push(`& \\\\`);
    }
    rows.push(`Subj:\\hspace{3\\fontdimen2\\font} & ${maybeUnderline(escapeTabularWrapped(data.jointSubject?.toUpperCase()), data.underlineSubject)} \\\\`);
  }

  if (rows.length === 0) return '';

  return `\\noindent
\\begin{tabular}{@{}l@{}p{5.75in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
}

/** Recipient address for business letters (separate paragraphs) */
function buildRecipientAddress(data: Partial<DocumentData>): string {
  if (!data.to) return '';
  const lines = data.to.split(/\r?\n/).filter((l: string) => l.trim());
  // Recipient address as a single block with line breaks (not separate paragraphs)
  // Matches PDF template which uses \\ within \BusinessRecipientAddress
  const escaped = lines.map(l => escapeFlat(l.trim()));
  return `${escaped.join(' \\\\\n')}\n\n`;
}

function buildSalutation(data: Partial<DocumentData>): string {
  const salutation = data.salutation || 'Dear Sir or Madam:';
  return `${escapeFlat(salutation)}\n\n`;
}

// --- Layout builders (one per uiMode) ---

function buildStandardLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // Same-page endorsement: header comes first (no letterhead/SSIC)
  if (store.docType === 'same_page_endorsement') {
    content += buildEndorsementHeader(store.docType, data);
  }

  if (config.letterhead) content += buildLetterhead(data);
  // Multiple address letter: date block is left-aligned (PDF's \hfill at paragraph boundary is a no-op)
  const ssicAlignRight = store.docType !== 'multiple_address_letter';
  if (config.ssic) content += buildSSICBlock(data, ssicAlignRight);

  // New-page endorsement: header comes AFTER letterhead/SSIC per SECNAV spec
  if (store.docType === 'new_page_endorsement') {
    content += buildEndorsementHeader(store.docType, data);
  }

  content += buildInReplyTo(data);
  content += buildAddressBlock(data, config);
  content += buildReferences(store.references);
  content += buildEnclosures(store.enclosures);
  content += buildBody(store.paragraphs, config);
  content += buildSignature(data, config);
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

function buildBusinessLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // Executive correspondence (Ch 12) needs 2" top margin (1" geometry + 1" vspace)
  if (config.topSpacing) {
    content += `\\vspace*{${config.topSpacing}}\n`;
  }

  if (config.letterhead) content += buildLetterhead(data);

  // ID symbols block: SSIC/Serial/Date right-aligned per SECNAV Ch 11
  // PDF template uses \begin{tabular}[t]{@{}l@{}} with \optionalLine for SSIC/Serial
  // Only include SSIC/Serial when config enables them (prevents stale formData leaking)
  // Use tabularx with right-aligned column for proper width control in DOCX
  // (plain \noindent text caused date truncation in pandoc output)
  const idRows: string[] = [];
  if (config.ssic && data.ssic) idRows.push(escapeTabular(data.ssic));
  if (config.ssic && data.serial) idRows.push(escapeTabular(data.serial));
  if (data.date) idRows.push(escapeTabular(data.date));
  if (idRows.length > 0) {
    const mappedRows = idRows.map(item => `${item} \\\\`);
    // No trailing \vspace{12pt} — buildRecipientAddress (or pre-salutation space) provides the gap
    content += `\\noindent\n\\begin{tabular}{@{}l@{}}\n${trimLastRow(mappedRows)}\n\\end{tabular}\n\n`;
  }

  content += buildRecipientAddress(data);

  // Salutation — SECNAV Ch 11, Para 11-6
  content += buildSalutation(data);

  // Optional subject line — SECNAV Ch 11, Para 11-7
  // Executive correspondence (Ch 12) uses Title Case, other business letters use ALL CAPS
  if (data.subject && config.subjectPrefix) {
    const subjectText = store.docType === 'executive_correspondence'
      ? toTitleCase(data.subject)
      : data.subject.toUpperCase();
    content += `${config.subjectPrefix}${escapeFlat(subjectText)}\n\n`;
  }

  content += buildBody(store.paragraphs, config);
  content += buildBusinessSignature(data);
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

function buildMemoLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  if (config.topSpacing) {
    content += `\\vspace*{${config.topSpacing}}\n`;
  }

  if (config.letterhead) content += buildLetterhead(data);
  if (config.ssic) content += buildSSICBlock(data);
  if (config.memoHeader) {
    content += buildMemoHeader(config, data);
    // 12pt after memo title (matches PDF's \par\vspace{12pt} in letterhead_memorandum.tex)
    content += '\\vspace{12pt}\n';
  }
  content += buildAddressBlock(data, config);
  content += buildReferences(store.references);
  content += buildEnclosures(store.enclosures);
  content += buildBody(store.paragraphs, config);
  if (config.hasDecisionBlock) content += buildDecisionBlock();
  content += buildSignature(data, config);
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

function buildMOALayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  if (config.letterhead) content += buildLetterhead(data);
  content += buildMOASSICBlock(data);
  content += buildMOATitle(data, store.docType);

  if (data.moaSubject) {
    content += `\\noindent
\\begin{tabular}{@{}l@{}p{5.75in}@{}}
Subj:\\hspace{3\\fontdimen2\\font} & ${maybeUnderline(escapeTabularWrapped(data.moaSubject?.toUpperCase()), data.underlineSubject)}
\\end{tabular}

`;
  }

  content += buildReferences(store.references);
  content += buildEnclosures(store.enclosures);
  content += buildBody(store.paragraphs, config);
  content += buildDualSignature(data, 'moa');
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

function buildJointLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  content += buildJointLetterhead(data);
  content += buildJointSSICBlock(data);
  // "JOINT LETTER" designation per SECNAV M-5216.5 Ch 7 Fig 7-4
  // 12pt before (matches PDF \par\vspace{12pt}), 12pt after (matches \\[12pt])
  content += '\\vspace{12pt}\n\\noindent JOINT LETTER\n\n\\vspace{12pt}\n';
  content += buildJointAddressBlock(data);
  content += buildReferences(store.references);
  content += buildEnclosures(store.enclosures);
  content += buildBody(store.paragraphs, config);
  content += buildDualSignature(data, 'joint');
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

function buildJointMemoLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // Joint memorandum uses the same centered DON header as joint letter
  // (not the standard seal letterhead), per the PDF template's overridden \printLetterhead
  if (config.letterhead) content += buildJointLetterhead(data);
  // Dual SSIC blocks: junior LEFT, senior RIGHT (same as joint letter)
  content += buildJointSSICBlock(data);
  // 12pt before designation (matches PDF \par\vspace{12pt}), 12pt after (matches \\[12pt])
  content += '\\vspace{12pt}\n';
  content += buildMemoHeader(config);
  content += '\\vspace{12pt}\n';

  if (config.fromTo) {
    const rows: string[] = [];
    if (data.jointSeniorFrom) rows.push(`From: & ${escapeTabularWrapped(data.jointSeniorFrom)} \\\\`);
    if (data.jointJuniorFrom) rows.push(` & ${escapeTabularWrapped(data.jointJuniorFrom)} \\\\`);
    if (data.jointTo) rows.push(`To: & ${escapeTabularWrapped(data.jointTo)} \\\\`);
    // 12pt space before Subj (matches PDF's \tabularnewline[12pt] in templates)
    // Use explicit empty spacer row because pandoc ignores \\[12pt] row spacing
    if (data.jointSubject) {
      if (rows.length > 0) {
        rows.push(`& \\\\`);
      }
      rows.push(`Subj: & ${maybeUnderline(escapeTabularWrapped(data.jointSubject?.toUpperCase()), data.underlineSubject)} \\\\`);
    }

    if (rows.length > 0) {
      content += `\\noindent
\\begin{tabular}{@{}l@{\\hspace{1em}}p{5.5in}@{}}
${trimLastRow(rows)}
\\end{tabular}

`;
    }
  }

  content += buildReferences(store.references);
  content += buildEnclosures(store.enclosures);
  content += buildBody(store.paragraphs, config);
  content += buildDualSignature(data, 'joint_memo');
  content += buildDistribution(store.distributions);
  content += buildCopyTo(store.copyTos);

  return content;
}

// --- Executive memo layout builders ---

/** Standard Memorandum layout (HqDON/OSD)
 * Per SECNAV M-5216.5 Ch 12 ¶2: MEMORANDUM FOR addressing, Title Case subject,
 * 12pt Times New Roman, 2" top margin first page, no letterhead */
function buildStandardMemorandumLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // 2" top margin (1" geometry + 1" vspace)
  content += '\\vspace*{1in}\n';

  // Date right-aligned
  if (data.date) {
    content += `\\noindent\n\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n & ${escapeTabular(data.date)} \\\\\n\\end{tabularx}\n\n`;
  }

  content += '\\vspace{12pt}\n';

  // MEMORANDUM FOR addressee
  if (data.memorandumFor) {
    content += `\\noindent MEMORANDUM FOR ${escapeFlat(data.memorandumFor)}\n\n`;
  }

  // Optional ATTN: line
  if (data.attnLine?.trim()) {
    content += `\\noindent ATTN: ${escapeFlat(data.attnLine)}\n\n`;
  }

  // Optional THROUGH: line (ALL CAPS per Ch 12 ¶2k)
  if (data.throughLine?.trim()) {
    content += `\\noindent THROUGH: ${escapeFlat(data.throughLine.toUpperCase())}\n\n`;
  }

  content += '\\vspace{12pt}\n';

  // FROM: line (optional for standard memo)
  if (data.from?.trim()) {
    content += `\\noindent\n\\begin{tabular}{@{}l@{\\hspace{1em}}p{5.5in}@{}}\nFROM: & ${escapeTabularWrapped(data.from)}\n\\end{tabular}\n\n`;
  }

  // SUBJECT: in Title Case (NOT ALL CAPS per Ch 12 ¶2l)
  if (data.subject) {
    content += `\\noindent\n\\begin{tabular}{@{}l@{\\hspace{1em}}p{5.5in}@{}}\nSUBJECT: & ${maybeUnderline(escapeTabularWrapped(toTitleCase(data.subject)), data.underlineSubject)}\n\\end{tabular}\n\n`;
  }

  // Body paragraphs
  content += buildBody(store.paragraphs, config);

  // Signature block (executive style: right half, no close)
  content += buildSignature(data, config);

  return content;
}

/** Action Memorandum layout
 * Per SECNAV M-5216.5 Ch 12 ¶3: "ACTION MEMO" centered header,
 * FOR/FROM/SUBJECT, concise bullet statements */
function buildActionMemorandumLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // 2" top margin (1" geometry + 1" vspace)
  content += '\\vspace*{1in}\n';

  // "ACTION MEMO" centered header
  content += `\\noindent\n\\begin{tabularx}{\\textwidth}{@{}X@{}c@{}X@{}}\n & \\textbf{ACTION MEMO} & \\\\\n\\end{tabularx}\n\n`;

  content += '\\vspace{12pt}\n';

  // Date right-aligned
  if (data.date) {
    content += `\\noindent\n\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n & ${escapeTabular(data.date)} \\\\\n\\end{tabularx}\n\n`;
  }

  content += '\\vspace{12pt}\n';

  // MEMORANDUM FOR addressee
  if (data.memorandumFor) {
    content += `\\noindent MEMORANDUM FOR ${escapeFlat(data.memorandumFor)}\n\n`;
  }

  content += '\\vspace{12pt}\n';

  // FROM: and SUBJECT: in tabular
  const rows: string[] = [];
  if (data.from) rows.push(`FROM: & ${escapeTabularWrapped(data.from)} \\\\`);
  if (data.subject) {
    rows.push(`& \\\\[-6pt]`);
    rows.push(`SUBJECT: & ${maybeUnderline(escapeTabularWrapped(toTitleCase(data.subject)), data.underlineSubject)} \\\\`);
  }
  if (rows.length > 0) {
    content += `\\noindent\n\\begin{tabular}{@{}l@{\\hspace{1em}}p{5.5in}@{}}\n${trimLastRow(rows)}\n\\end{tabular}\n\n`;
  }

  // Body paragraphs
  content += buildBody(store.paragraphs, config);

  // Coordination section
  if (data.coordination?.trim()) {
    content += `\\vspace{24pt}\n\\noindent COORDINATION:\n\n${escapeFlat(data.coordination)}\n\n`;
  }

  // Signature block (executive style: right half, no close)
  content += buildSignature(data, config);

  // Prepared by
  if (data.preparedBy?.trim()) {
    content += `\\vspace{24pt}\n\\noindent Prepared by: ${escapeFlat(data.preparedBy)}\n\n`;
  }

  return content;
}

/** Information Memorandum layout
 * Per SECNAV M-5216.5 Ch 12 ¶4: "INFO MEMO" centered header,
 * FOR/FROM/SUBJECT, no signature block (sender signs FROM line) */
function buildInfoMemorandumLayout(store: DocumentStore, config: DocTypeConfig): string {
  const data = store.formData;
  let content = '';

  // 2" top margin (1" geometry + 1" vspace)
  content += '\\vspace*{1in}\n';

  // "INFO MEMO" centered header
  content += `\\noindent\n\\begin{tabularx}{\\textwidth}{@{}X@{}c@{}X@{}}\n & \\textbf{INFO MEMO} & \\\\\n\\end{tabularx}\n\n`;

  content += '\\vspace{12pt}\n';

  // Date right-aligned
  if (data.date) {
    content += `\\noindent\n\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n & ${escapeTabular(data.date)} \\\\\n\\end{tabularx}\n\n`;
  }

  content += '\\vspace{12pt}\n';

  // FOR: / FROM: / SUBJECT: in tabular
  const rows: string[] = [];
  if (data.memorandumFor) rows.push(`FOR: & ${escapeTabularWrapped(data.memorandumFor)} \\\\`);
  if (data.from) {
    rows.push(`& \\\\[-6pt]`);
    rows.push(`FROM: & ${escapeTabularWrapped(data.from)} \\\\`);
  }
  if (data.subject) {
    rows.push(`& \\\\[-6pt]`);
    rows.push(`SUBJECT: & ${maybeUnderline(escapeTabularWrapped(toTitleCase(data.subject)), data.underlineSubject)} \\\\`);
  }
  if (rows.length > 0) {
    content += `\\noindent\n\\begin{tabular}{@{}l@{\\hspace{1em}}p{5.5in}@{}}\n${trimLastRow(rows)}\n\\end{tabular}\n\n`;
  }

  // Body paragraphs
  content += buildBody(store.paragraphs, config);

  // Coordination section
  if (data.coordination?.trim()) {
    content += `\\vspace{24pt}\n\\noindent COORDINATION:\n\n${escapeFlat(data.coordination)}\n\n`;
  }

  // No signature block for info memos — sender signs on FROM line

  // Prepared by
  if (data.preparedBy?.trim()) {
    content += `\\vspace{24pt}\n\\noindent Prepared by: ${escapeFlat(data.preparedBy)}\n\n`;
  }

  return content;
}

// --- Main export ---

/**
 * Generate a flat, self-contained LaTeX document using only standard LaTeX
 * constructs that pandoc can convert to DOCX.
 */
export function generateFlatLatex(store: DocumentStore): string {
  const data = store.formData;
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;

  let tex = '';

  tex += buildPreamble(data);
  tex += buildClassificationHeaders(data);
  tex += buildPageNumbering(data);
  tex += '\n\\begin{document}\n\n';

  switch (config.uiMode) {
    case 'standard':
      tex += buildStandardLayout(store, config);
      break;
    case 'business':
      tex += buildBusinessLayout(store, config);
      break;
    case 'memo':
      tex += buildMemoLayout(store, config);
      break;
    case 'moa':
      tex += buildMOALayout(store, config);
      break;
    case 'joint':
      tex += buildJointLayout(store, config);
      break;
    case 'joint_memo':
      tex += buildJointMemoLayout(store, config);
      break;
    case 'executive':
      // Route to specific executive layout based on doc type
      if (store.docType === 'action_memorandum') {
        tex += buildActionMemorandumLayout(store, config);
      } else if (store.docType === 'information_memorandum') {
        tex += buildInfoMemorandumLayout(store, config);
      } else {
        // standard_memorandum (default executive)
        tex += buildStandardMemorandumLayout(store, config);
      }
      break;
    default:
      tex += buildStandardLayout(store, config);
      break;
  }

  tex += buildCUIBlock(data);
  tex += buildClassifiedBlock(data);

  tex += '\n\\end{document}\n';

  return tex;
}
