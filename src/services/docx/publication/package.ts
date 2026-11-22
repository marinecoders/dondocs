import JSZip from 'jszip';
import { safeUrl } from '@/lib/url-safety';
import { bodyTableTwips, type BodyTable } from '@/lib/bodyTable';
import { getDocxFontName } from '../layout-config';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_XML_CHARS = 12 * 1024 * 1024;
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

export const xml = (value: string): string => Array.from(value, char => {
  const code = char.codePointAt(0)!;
  return code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff ? char : '';
}).join('')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface ParagraphFormat {
  align?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean; underline?: boolean;
  uppercase?: boolean;
  superscript?: boolean; pageBreakBefore?: boolean; inlineMode?: 'literal' | 'references' | 'rich';
  size?: number; before?: number; after?: number; indent?: number; hanging?: number;
  breakWords?: boolean;
  keep?: boolean; style?: 'Title' | 'Heading1' | 'Heading2' | 'Heading3';
}
export interface WordTextRun {
  text: string;
  format?: Pick<ParagraphFormat, 'bold' | 'italic' | 'underline' | 'uppercase' | 'superscript' | 'inlineMode' | 'size'>;
}
export type WordText = string | readonly WordTextRun[];
export interface SectionFormat {
  title: string; marking?: string; landscape?: boolean; numbering?: 'decimal' | 'lowerRoman';
  prefix?: string; start?: number; cover?: boolean;
  hidePageNumber?: boolean; bannerSize?: number; outerFurniture?: boolean;
  leftTitle?: string; headerDetail?: string; pageNumberAlign?: 'center' | 'right';
  page?: { width: number; height: number; left?: number; right?: number };
}
interface WordTarget { name: string; label: string; destination: string; note?: string }
export interface WordTableFormat {
  inlineMode?: 'literal' | 'references' | 'rich';
  size?: number;
  headerRows?: number;
  repeatHeaders?: boolean;
  borders?: 'grid' | 'outline' | 'none';
  columnAlignments?: readonly ('left' | 'center' | 'right')[];
  headerSpans?: readonly { column: number; span: number }[];
  minimumRowHeight?: number;
  breakWords?: boolean;
  rowDestinations?: readonly string[];
}

const PUBLICATION_REFERENCE = /\{\{(?:PUBREF_[A-Z0-9_]+|VOLREF_[A-Za-z0-9._:-]+)\}\}/g;
const EXTERNAL_LINK = /\[([^\]\n]+)\]\((https?:\/\/(?:(?!\{\{(?:PUBREF_|VOLREF_))[^\s)])+)\)/i;
const BARE_URL = /https?:\/\/(?:(?!\{\{(?:PUBREF_|VOLREF_))[^\s<>])+/i;
const INLINE_TOKEN = new RegExp([PUBLICATION_REFERENCE, EXTERNAL_LINK, BARE_URL,
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\*\*|\*|__/].map(token => token.source).join('|'), 'gi');
const EMPHASIS_MARKERS = new Set(['**', '*', '__']);
function emphasisEnd(value: string, start: number, marker: string): { start: number; end: number } | undefined {
  const stack = [marker], tokens = new RegExp(INLINE_TOKEN.source, 'gi');
  tokens.lastIndex = start + marker.length;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(value))) {
    if (!EMPHASIS_MARKERS.has(match[0])) {
      const suffix = /(?:\*+|__+)$/.exec(match[0]);
      if (suffix) tokens.lastIndex -= suffix[0].length;
      continue;
    }
    // In a closing triple star, close the innermost style first. A double
    // star inside an italic span otherwise opens a nested bold span.
    const delimiter = match[0] === '**' && stack.at(-1) === '*' && value[match.index + 2] === '*' ? '*' : match[0];
    if (delimiter === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return { start: match.index, end: match.index + delimiter.length };
    } else {
      if (stack.length >= 16) throw new Error('The publication contains inline formatting nested too deeply.');
      stack.push(delimiter);
    }
    tokens.lastIndex = match.index + delimiter.length;
  }
  return undefined;
}

function run(value: string, format: ParagraphFormat = {}): string {
  const printable = format.uppercase ? value.toUpperCase() : value;
  const properties = `${format.bold ? '<w:b/>' : ''}${format.italic ? '<w:i/>' : ''}${format.size ? `<w:sz w:val="${format.size * 2}"/><w:szCs w:val="${format.size * 2}"/>` : ''}${format.underline ? '<w:u w:val="single"/>' : ''}${format.superscript ? '<w:vertAlign w:val="superscript"/>' : ''}`;
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${printable.split(/\r?\n/).map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
}

export function paragraphRuns(content: string, format: ParagraphFormat = {}): string {
  return `<w:p><w:pPr>${format.style ? `<w:pStyle w:val="${format.style}"/>` : ''}${format.keep ? '<w:keepNext/>' : ''}${format.pageBreakBefore ? '<w:pageBreakBefore/>' : ''}<w:widowControl/>${format.breakWords ? '<w:wordWrap w:val="0"/>' : ''}<w:spacing w:before="${(format.before ?? 0) * 20}" w:after="${(format.after ?? 6) * 20}" w:line="240" w:lineRule="auto"/>${format.indent !== undefined ? `<w:ind w:left="${format.indent * 20}"${format.hanging ? ` w:hanging="${format.hanging * 20}"` : ''}/>` : ''}${format.align ? `<w:jc w:val="${format.align}"/>` : ''}</w:pPr>${content || run('')}</w:p>`;
}

export class PublicationWordPackage {
  private readonly zip = new JSZip();
  private readonly body: string[] = [];
  private readonly relationships: string[] = [];
  private readonly contentTypes: string[] = [];
  private xmlChars = 0;
  private mediaBytes = 0;
  private nextId = 1;
  private sections = 0;
  private pictures = 0;
  private hasOuterFurniture = false;
  private readonly targets = new Map<string, { label: string; anchor: string; note: boolean }>();
  private readonly destinations = new Map<string, string>();
  private readonly signal: AbortSignal;
  private readonly fontSize: number;
  private readonly fontName: string;

  constructor(signal: AbortSignal, fontSize: 10 | 11 | 12 = 10, fontFamily?: string) {
    this.signal = signal;
    this.fontSize = fontSize;
    this.fontName = getDocxFontName(fontFamily);
  }
  get abortSignal(): AbortSignal { return this.signal; }
  check(): void { if (this.signal.aborted) throw new Error('Export cancelled.'); }
  add(value: string): void {
    this.check();
    if (value.length > MAX_XML_CHARS - this.xmlChars) throw new Error('The publication exceeds the Word text limit.');
    this.xmlChars += value.length;
    this.body.push(value);
  }
  private textRuns(value: WordText, format: ParagraphFormat): string {
    return typeof value === 'string' ? this.inline(value, format) : value.map(part => this.inline(part.text, { ...format, ...part.format })).join('');
  }
  text(value: WordText, format: ParagraphFormat = {}): void { this.add(paragraphRuns(this.textRuns(value, format), format)); }
  heading(value: WordText, level: 1 | 2 | 3 = 1, options: { newPage?: boolean; destination?: string } = {}): void {
    const format: ParagraphFormat = { style: `Heading${level}`, bold: true, size: this.fontSize, keep: true, before: 12, after: 6, pageBreakBefore: options.newPage };
    this.add(paragraphRuns((options.destination ? this.anchorMarkup(options.destination) : '') + this.textRuns(value, format), format));
  }
  registerTargets(targets: readonly WordTarget[]): void {
    for (const target of targets) {
      let anchor = this.destinations.get(target.destination);
      if (!anchor) { anchor = `publication_${this.destinations.size + 1}`; this.destinations.set(target.destination, anchor); }
      this.targets.set(target.name, { label: target.note ?? target.label, anchor, note: target.note !== undefined });
    }
  }
  anchor(destination: string, newPage = false): void {
    const contents = this.anchorMarkup(destination);
    if (contents) this.add(`<w:p><w:pPr><w:keepNext/>${newPage ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${contents}</w:p>`);
  }
  private anchorMarkup(destination: string): string {
    const anchor = this.destinations.get(destination);
    if (!anchor) return '';
    const id = this.nextId++;
    return `<w:bookmarkStart w:id="${id}" w:name="${anchor}"/><w:bookmarkEnd w:id="${id}"/>`;
  }
  navigation(label: string, destination: string, numbering: 'decimal' | 'link-only' = 'decimal', indent?: number): void {
    const anchor = this.destinations.get(destination);
    if (!anchor) throw new Error('A publication contents entry has no target.');
    const link = `<w:hyperlink w:anchor="${anchor}">${run(label, { underline: true })}</w:hyperlink>`;
    if (numbering === 'link-only') {
      this.add(paragraphRuns(link, { after: 5, indent }));
      return;
    }
    this.add(`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="10080"/></w:tabs><w:spacing w:after="100"/></w:pPr>${link}<w:r><w:tab/></w:r><w:fldSimple w:instr=" PAGEREF ${anchor} \\h \\* Arabic ">${run('')}</w:fldSimple></w:p>`);
  }
  bodyTable(table: BodyTable): void {
    const [header, ...rows] = table.rows;
    this.table(header, rows, bodyTableTwips(table, 10080), {
      breakWords: true, headerRows: table.headerRows, repeatHeaders: table.repeatHeaders, borders: table.borders,
      columnAlignments: table.columnAlignments, size: table.fontSize, minimumRowHeight: table.minimumRowHeight, inlineMode: 'rich',
    });
  }
  inline(value: string, format: ParagraphFormat = {}): string { return this.formattedInline(value, format, 0); }
  private referenceTarget(token: string) {
    const target = this.targets.get(token.slice(2, -2));
    if (!target) throw new Error('A Word publication reference has no target. Reinsert the reference before export.');
    return target;
  }
  private formattedInline(value: string, format: ParagraphFormat, depth: number): string {
    this.check();
    if (depth > 16) throw new Error('The publication contains inline formatting nested too deeply.');
    if (value.length > MAX_XML_CHARS - this.xmlChars) throw new Error('The publication exceeds the Word text limit.');
    const tokens = new RegExp(INLINE_TOKEN.source, 'gi');
    const output: string[] = [];
    let cursor = 0, match: RegExpExecArray | null;
    while ((match = tokens.exec(value))) {
      output.push(run(value.slice(cursor, match.index), format));
      const token = match[0]; cursor = tokens.lastIndex;
      if (EMPHASIS_MARKERS.has(token)) {
        if (format.inlineMode !== 'rich') { output.push(run(token, format)); continue; }
        const closing = emphasisEnd(value, match.index, token);
        if (closing) {
          const emphasis = token === '**' ? { bold: true } : token === '__' ? { underline: true } : { italic: true };
          output.push(this.formattedInline(value.slice(cursor, closing.start), { ...format, ...emphasis }, depth + 1));
          cursor = closing.end; tokens.lastIndex = cursor;
        } else output.push(run(token, format));
        continue;
      }
      if ((token.startsWith('{{PUBREF_') || token.startsWith('{{VOLREF_')) && format.inlineMode !== undefined && format.inlineMode !== 'literal') {
        const target = this.referenceTarget(token);
        output.push(`<w:hyperlink w:anchor="${target.anchor}">${run(target.label, { ...format, superscript: target.note })}</w:hyperlink>`);
        continue;
      }
      const link = EXTERNAL_LINK.exec(token);
      if (link?.[0] === token && format.inlineMode !== undefined && format.inlineMode !== 'literal') {
        const href = safeUrl(link[2]);
        if (href) {
          // A Word hyperlink cannot contain another hyperlink. Use the current
          // reference label as display text so the outer link retains its URL.
          const label = link[1].replace(PUBLICATION_REFERENCE, reference => this.referenceTarget(reference).label);
          output.push(`<w:hyperlink r:id="${this.relationship('hyperlink', href, true)}">${run(label, { ...format, underline: true })}</w:hyperlink>`);
          continue;
        }
      }
      if (/^(?:https?:\/\/|[\w.+-]+@)/i.test(token)) {
        let target = token;
        const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
        while (target) {
          const last = target.at(-1)!;
          if (/[.,;:!]/.test(last) || pairs[last] && Array.from(target).filter(char => char === last).length > Array.from(target).filter(char => char === pairs[last]).length) target = target.slice(0, -1);
          else break;
        }
        const href = safeUrl(target.includes('@') && !/^https?:/i.test(target) ? `mailto:${target}` : target);
        if (href) {
          output.push(`<w:hyperlink r:id="${this.relationship('hyperlink', href, true)}">${run(target, { ...format, underline: true })}</w:hyperlink>${run(token.slice(target.length), format)}`);
          continue;
        }
      }
      output.push(run(token, format));
    }
    output.push(run(value.slice(cursor), format));
    return output.join('');
  }
  table(headers: readonly string[], rows: readonly (readonly string[])[], widths: readonly number[], options: WordTableFormat = {}): void {
    if (!widths.length || widths.some(width => !Number.isInteger(width) || width <= 0) || headers.length !== widths.length || rows.some(row => row.length !== widths.length)) throw new Error('The publication contains an invalid Word table.');
    if (options.headerRows !== undefined && (!Number.isInteger(options.headerRows) || options.headerRows < 0 || options.headerRows > rows.length + 1)) throw new Error('The Word table header count is invalid.');
    if (options.minimumRowHeight !== undefined && (!Number.isFinite(options.minimumRowHeight) || options.minimumRowHeight <= 0 || options.minimumRowHeight > 720)) throw new Error('The Word table row height is invalid.');
    if (options.rowDestinations && options.rowDestinations.length !== rows.length) throw new Error('The Word table row targets are incomplete.');
    if (options.headerSpans?.length && options.headerRows === 0) throw new Error('A merged table header needs a header row.');
    const spans = new Map<number, number>();
    const covered = new Set<number>();
    for (const merge of options.headerSpans ?? []) {
      if (!Number.isInteger(merge.column) || !Number.isInteger(merge.span) || merge.column < 0 || merge.span < 1 || merge.column + merge.span > widths.length) throw new Error('The Word table header span is invalid.');
      for (let i = merge.column; i < merge.column + merge.span; i++) {
        if (covered.has(i) || i > merge.column && headers[i]) throw new Error('The Word table header span would discard content.');
        covered.add(i);
      }
      spans.set(merge.column, merge.span);
    }
    this.add(`<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="${options.borders === 'none' || options.borders === 'outline' && side.startsWith('inside') ? 'nil' : 'single'}" w:sz="4" w:color="000000"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`);
    for (const [index, row] of [headers, ...rows].entries()) {
      const header = index < (options.headerRows ?? 1);
      const cells: string[] = [];
      for (let column = 0; column < row.length; column++) {
        const span = index === 0 ? spans.get(column) ?? 1 : 1;
        const width = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0);
        const anchor = index > 0 && column === 0 ? this.anchorMarkup(options.rowDestinations?.[index - 1] ?? '') : '';
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${paragraphRuns(anchor + this.inline(row[column], { bold: header, size: options.size ?? this.fontSize, inlineMode: options.inlineMode ?? 'references' }), { after: 2, before: 2, align: options.columnAlignments?.[column] ?? 'left', breakWords: options.breakWords })}</w:tc>`);
        column += span - 1;
      }
      this.add(`<w:tr><w:trPr>${options.minimumRowHeight ? `<w:trHeight w:val="${Math.round(options.minimumRowHeight * 20)}" w:hRule="atLeast"/>` : ''}${header && options.repeatHeaders !== false ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`);
    }
    this.add(`</w:tbl>${paragraphRuns('', { after: 4 })}`);
  }
  private relationship(type: string, target: string, external = false): string {
    const id = `rId${this.nextId++}`;
    this.relationships.push(`<Relationship Id="${id}" Type="${R}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  }
  image(bytes: Uint8Array, extension: 'png' | 'jpg', widthPt: number, heightPt: number, description: string): void {
    this.check();
    if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES - this.mediaBytes) throw new Error('The publication exceeds the Word image limit.');
    this.mediaBytes += bytes.byteLength;
    const number = ++this.pictures, file = `media/image${number}.${extension}`;
    this.zip.file(`word/${file}`, bytes);
    const id = this.relationship('image', file);
    const cx = Math.round(widthPt * 12700), cy = Math.round(heightPt * 12700);
    this.add(paragraphRuns(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Figure ${number}" descr="${xml(description)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image${number}.${extension}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { align: 'center', after: 6, keep: true }));
  }
  private sectionProperties(format: SectionFormat): string {
    const page = format.page ?? { width: format.landscape ? 792 : 612, height: format.landscape ? 612 : 792 };
    if (![page.width, page.height].every(value => Number.isFinite(value) && value >= 144 && value <= 1584)
      || ![page.left ?? 54, page.right ?? 54].every(value => Number.isFinite(value) && value >= 0 && value < page.width / 2)) throw new Error('The Word publication page geometry is invalid.');
    const number = ++this.sections;
    const bannerSize = format.bannerSize ?? (format.cover ? 24 : 14);
    const pageField = `<w:fldSimple w:instr=" PAGE ">${run(String(format.start ?? 1))}</w:fldSimple>`;
    const references: Record<'header' | 'footer', string[]> = { header: [], footer: [] };
    const variants = format.outerFurniture ? ['default', 'even'] as const : ['default'] as const;
    this.hasOuterFurniture ||= Boolean(format.outerFurniture);
    for (const variant of variants) {
      const align = format.outerFurniture ? variant === 'even' ? 'left' : 'right' : format.pageNumberAlign ?? 'center';
      const runningTitle = format.leftTitle
        ? `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${Math.round((page.width - (page.left ?? 54) - (page.right ?? 54)) * 20)}"/></w:tabs><w:spacing w:after="0"/></w:pPr>${run(format.leftTitle, { size: 10 })}<w:r><w:tab/></w:r>${run(format.title, { bold: true, size: 10 })}</w:p>`
        : paragraphRuns(run(format.title, { bold: true, size: 10 }), { align: format.outerFurniture ? align : 'right', after: 0 });
      const header = `${format.marking ? paragraphRuns(run(format.marking, { bold: true, size: bannerSize }), { align: 'center', after: 3 }) : ''}${!format.cover ? runningTitle + (format.headerDetail ? paragraphRuns(run(format.headerDetail, { size: 10 }), { after: 0 }) : '') : ''}`;
      const footer = `${format.hidePageNumber ? '' : paragraphRuns(run(format.prefix ?? '') + pageField, { align, after: 3 })}${format.marking ? paragraphRuns(run(format.marking, { bold: true, size: bannerSize }), { align: 'center', after: 0 }) : ''}`;
      for (const [tag, contents] of [['header', header], ['footer', footer]] as const) {
        const name = `${tag}${number}${variant === 'even' ? '-even' : ''}.xml`, root = tag === 'header' ? 'hdr' : 'ftr';
        this.zip.file(`word/${name}`, `${XML}<w:${root} xmlns:w="${W}" xmlns:r="${R}">${contents}</w:${root}>`);
        this.contentTypes.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tag}+xml"/>`);
        references[tag].push(`<w:${tag}Reference w:type="${variant}" r:id="${this.relationship(tag, name)}"/>`);
      }
    }
    return `<w:sectPr>${references.header.join('')}${references.footer.join('')}<w:type w:val="nextPage"/><w:pgSz w:w="${Math.round(page.width * 20)}" w:h="${Math.round(page.height * 20)}"${page.width > page.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${format.marking ? 1620 : 1080}" w:right="${Math.round((page.right ?? 54) * 20)}" w:bottom="${format.marking ? 1440 : 1080}" w:left="${Math.round((page.left ?? 54) * 20)}" w:header="480" w:footer="480" w:gutter="0"/><w:pgNumType w:fmt="${format.numbering ?? 'decimal'}"${format.start !== undefined ? ` w:start="${format.start}"` : ''}/></w:sectPr>`;
  }
  endSection(format: SectionFormat): void { this.add(`<w:p><w:pPr>${this.sectionProperties(format)}</w:pPr></w:p>`); }
  async finish(format: SectionFormat): Promise<Blob> {
    this.check();
    this.add(this.sectionProperties(format));
    this.zip.file('word/document.xml', `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${this.body.join('')}</w:body></w:document>`);
    const styles = ['Title', 'Heading1', 'Heading2', 'Heading3'].map((name, index) => `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${Math.max(0, index - 1)}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${index === 0 ? 28 : 20}"/></w:rPr></w:style>`).join('');
    this.zip.file('word/styles.xml', `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${this.fontName}" w:hAnsi="${this.fontName}" w:eastAsia="${this.fontName}" w:cs="${this.fontName}"/><w:sz w:val="${this.fontSize * 2}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles}</w:styles>`);
    this.zip.file('word/settings.xml', `${XML}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>${this.hasOuterFurniture ? '<w:evenAndOddHeaders/>' : ''}<w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
    this.relationship('styles', 'styles.xml'); this.relationship('settings', 'settings.xml');
    this.zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.relationships.join('')}</Relationships>`);
    this.zip.file('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
    this.zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${this.contentTypes.join('')}</Types>`);
    const bytes = await this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    this.check();
    return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
}
