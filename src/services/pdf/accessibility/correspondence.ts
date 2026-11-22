import { taggedReferenceUrl } from './links';
import mainTemplate from '../../../../tex/main.tex?raw';
import navalTemplate from '../../../../tex/templates/naval_letter.tex?raw';
import standardTemplate from '../../../../tex/templates/standard_letter.tex?raw';
import { generateAllLatexFiles, type GeneratedFiles, type LatexBodyAdapter } from '@/services/latex/generator';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { escapeLatex, formatAddressForLatex } from '@/services/latex/escaper';
import { splitAddressForLetterhead } from '@/lib/unitAddress';
import { hasBodyCaption } from '@/lib/bodyCaption';
import { formatViaLines } from '@/lib/viaLines';
import { composeSenderSymbol } from '@/services/latex/senderSymbol';
import { signatureAuthorityLine, signaturePosition, supportsActingSignature } from '@/lib/signingAuthority';
import { DOC_TYPE_CONFIG } from '@/types/document';
import type { PdfRasterBinding } from './raster';
import { validatePdfTaggingPlan, type PdfSemanticNode, type PdfSemanticRole, type PdfTaggingPlan } from './taggedPdf';

export type TaggedCorrespondenceSource = Parameters<typeof generateAllLatexFiles>[0];
export interface TaggedCorrespondencePreparation {
  files: Record<string, string | Uint8Array>;
  generated: GeneratedFiles;
  plan: PdfTaggingPlan;
  qualification: 'standard-letter' | 'naval-letter';
}
export interface TaggedCorrespondenceOptions {
  language?: string;
  seal?: PdfRasterBinding;
  figures?: Readonly<Record<number, PdfRasterBinding>>;
}
type InlinePart = Parameters<LatexBodyAdapter['inline']>[1];
interface MutableNode extends Omit<PdfSemanticNode, 'children'> { children?: MutableNode[] }

export { taggedCorrespondenceIssues } from './preflight';
import { taggedCorrespondenceIssues, taggedNavalLetterhead } from './preflight';

function replaceOnce(source: string, target: string, replacement: string): string {
  if (!source.includes(target) || source.indexOf(target) !== source.lastIndexOf(target)) throw new Error('The tagged PDF template contract changed. Requalify this layout before export.');
  return source.replace(target, replacement);
}

/** Called synchronously with an owned prepared model. Both TeX strings and the
 * structure plan are completed before any asynchronous compiler operation. */
export function prepareTaggedCorrespondence(source: TaggedCorrespondenceSource, resolvedLevel?: string, referenceDate = new Date(), options: TaggedCorrespondenceOptions = {}): TaggedCorrespondencePreparation {
  const issues = taggedCorrespondenceIssues(source, resolvedLevel);
  if (issues.length) throw new Error(issues.join('\n'));
  const nonce = crypto.randomUUID().replaceAll('-', '');
  let nextId = 0;
  const nodes: MutableNode[] = [];
  const point = (id: number, begin: boolean) => `\\pdfliteral direct{/DDTag << /N <${nonce}> /I ${id} /B ${begin} >> DP}`;
  const wrap = (id: number, latex: string) => latex ? `\\leavevmode${point(id, true)}${latex}${point(id, false)}` : latex;
  const node = (role: PdfSemanticRole, children?: MutableNode[]): MutableNode => ({ id: nextId++, role, ...(children ? { children } : {}) });
  const top = (role: PdfSemanticRole) => { const value = node(role); nodes.push(value); return value; };
  const macros: string[] = [];
  const wrapMacro = (name: string, id: number) => {
    macros.push(`\\expandafter\\let\\csname DDOriginal${name}\\endcsname\\${name}\n`
      + `\\renewcommand{\\${name}}{${wrap(id, `\\csname DDOriginal${name}\\endcsname`)}}`);
  };
  const fields = source.formData;
  let format = source.docType === 'naval_letter' ? navalTemplate : standardTemplate;
  let mainSource = mainTemplate;
  let sealId: number | undefined;
  const letterhead = taggedNavalLetterhead(source);
  if (letterhead === 'full') {
    if (!options.seal) throw new Error('Prepare the exact decorative letterhead seal before tagged export.');
    sealId = nextId++;
    mainSource = replaceOnce(mainSource, '\\includegraphics[width=1in]{attachments/\\SealFile}', wrap(sealId, '\\includegraphics[width=1in]{attachments/\\SealFile}'));
    const department = top('P').id;
    for (const text of ['DEPARTMENT OF THE NAVY', 'DEPARTMENT OF DEFENSE', 'UNITED STATES MARINE CORPS']) {
      mainSource = replaceOnce(mainSource, `\\textbf{${text}}`, `\\textbf{${wrap(department, text)}}`);
    }
    const address = splitAddressForLetterhead(fields.unitAddress || '');
    const line2 = !!fields.unitLine2?.trim();
    const unitLines = [fields.unitLine1, line2 ? fields.unitLine2 : address.line1, line2 ? address.line1 : address.line2, line2 ? address.line2 : ''];
    for (const [index, macro] of ['UnitName', 'UnitLineTwo', 'UnitLineThree', 'UnitLineFour'].entries()) {
      if (unitLines[index]?.trim()) mainSource = replaceOnce(mainSource, `\\textcolor{\\LetterheadColor}{\\${macro}}`, `\\textcolor{\\LetterheadColor}{${wrap(top('P').id, `\\${macro}`)}}`);
    }
  } else if (letterhead === 'title-only' && fields.unitLine1?.trim()) {
    const title = '\\textbf{\\UnitName}';
    mainSource = replaceOnce(mainSource, title, `\\textbf{${wrap(top('P').id, '\\UnitName')}}`);
  }
  if (fields.inReplyTo) {
    const id = top('P').id;
    format = replaceOnce(format, '{\\fontsize{5pt}{6pt}\\selectfont IN REPLY REFER TO}', wrap(id, '{\\fontsize{5pt}{6pt}\\selectfont IN REPLY REFER TO}'));
  }
  if (fields.ssic?.trim()) wrapMacro('DocumentSSIC', top('P').id);
  if (composeSenderSymbol(fields.officeCode, fields.serial).trim()) wrapMacro('DocumentSerial', top('P').id);
  wrapMacro('DocumentDate', top('P').id);
  const from = top('P').id;
  format = replaceOnce(format, 'From:\\hspace{2\\fontdimen2\\font}', wrap(from, 'From:\\hspace{2\\fontdimen2\\font}'));
  wrapMacro('FromLine', from);
  const to = top('P').id;
  format = replaceOnce(format, 'To:\\hspace{6\\fontdimen2\\font}', wrap(to, 'To:\\hspace{6\\fontdimen2\\font}'));
  wrapMacro('ToLine', to);
  if (fields.via?.trim()) {
    const via = top('P').id;
    const rows = formatViaLines(fields.via).map((line, index) => `\\tabularnewline ${index ? '' : wrap(via, 'Via:\\hspace{5\\fontdimen2\\font}')} & ${wrap(via, formatAddressForLatex(line))}`);
    macros.push(`\\setViaRows{${rows.join('\n')}}`);
  }
  const subject = top('H1').id;
  format = replaceOnce(format, 'Subj:\\hspace{3\\fontdimen2\\font}', wrap(subject, 'Subj:\\hspace{3\\fontdimen2\\font}'));
  wrapMacro('SubjectLine', subject);
  const references: { label: number; body: number }[] = [];
  if (source.references.length) {
    wrapMacro('ReferenceLabel', top('H2').id);
    const list = top('L');
    list.children = source.references.map(reference => {
      const label = node('Lbl'); const url = fields.includeHyperlinks ? taggedReferenceUrl(reference.url) : null;
      const paragraph = node(url ? 'Link' : 'P');
      if (url) { paragraph.linkUrl = url; paragraph.altText = reference.title.trim(); }
      references.push({ label: label.id, body: paragraph.id });
      return node('LI', [label, node('LBody', [paragraph])]);
    });
  }
  const artifactIds: number[] = sealId === undefined ? [] : [sealId];
  const images: Record<number, PdfRasterBinding> = sealId === undefined ? {} : { [sealId]: { ...options.seal! } };
  const tables = new Map<number, { cells: number[][]; caption?: number; frame: number }>();
  const figures = new Map<number, Partial<Record<'image' | 'caption' | 'mark', number>>>();
  const paragraphTags = new Map<number, Partial<Record<InlinePart, number>>>();
  let listStack: { list: MutableNode; lastBody?: MutableNode }[] = [];
  for (const [index, paragraph] of source.paragraphs.entries()) {
    const level = paragraph.level;
    if (paragraph.bodyTable) {
      listStack = [];
      const caption = hasBodyCaption(paragraph) ? top('Caption').id : undefined;
      const cells: number[][] = [];
      const table = top('Table');
      table.children = paragraph.bodyTable.rows.map((row, rowIndex) => {
        const header = rowIndex < paragraph.bodyTable!.headerRows;
        const children = row.map(cell => {
          const value = node(header ? 'TH' : 'TD');
          if (header) { value.columnHeader = true; value.repeatAsArtifact = true; }
          else if (!cell.trim()) value.allowEmpty = true;
          return value;
        });
        cells.push(children.map(value => value.id));
        return node('TR', children);
      });
      const frame = nextId++; artifactIds.push(frame);
      tables.set(index, { cells, caption, frame });
      continue;
    }
    if (paragraph.figure) {
      listStack = [];
      const tags: Partial<Record<'image' | 'caption' | 'mark', number>> = {};
      if (paragraph.figure.portionMarking || paragraph.portionMarking) tags.mark = top('P').id;
      const figure = top('Figure'); figure.altText = paragraph.figure.altText!; tags.image = figure.id;
      const binding = options.figures?.[index];
      if (!binding) throw new Error('Prepare and retain the exact body image before tagged export.');
      images[figure.id] = { ...binding };
      if (hasBodyCaption(paragraph)) tags.caption = top('Caption').id;
      figures.set(index, tags);
      continue;
    }
    if (!listStack.length) listStack = [{ list: top('L') }];
    while (listStack.length > level + 1) listStack.pop();
    if (listStack.length < level + 1) {
      const parent = listStack.at(-1)!;
      if (!parent.lastBody) throw new Error('The tagged paragraph hierarchy has no parent.');
      const nested = node('L', []);
      parent.lastBody.children!.push(nested);
      listStack.push({ list: nested });
    }
    const label = node('Lbl');
    const bodyChildren: MutableNode[] = [];
    const tags: Partial<Record<InlinePart, number>> = { label: label.id };
    if (paragraph.header?.trim()) {
      // Paragraph indentation is not itself a heading: do not skip levels when
      // an ancestor item contains body text without a heading of its own.
      const ancestorHeadings = listStack.slice(0, level).filter(entry => entry.lastBody?.children?.some(child => /^H[1-6]$/.test(child.role))).length;
      const heading = node(`H${Math.min(6, ancestorHeadings + 2)}` as PdfSemanticRole);
      bodyChildren.push(heading); tags.heading = heading.id;
    }
    if (paragraph.text.trim() || paragraph.portionMarking) {
      const text = node('P'); bodyChildren.push(text); tags.body = text.id;
    }
    const body = node('LBody', bodyChildren);
    const item = node('LI', [label, body]);
    const current = listStack.at(-1)!;
    (current.list.children ??= []).push(item);
    current.lastBody = body;
    paragraphTags.set(index, tags);
  }
  const hasSigner = fields.sigFirst?.trim() || fields.sigMiddle?.trim() || fields.sigLast?.trim();
  const supportsActing = supportsActingSignature(source.docType);
  const authority = signatureAuthorityLine(fields, supportsActing);
  const actingTitle = fields.acting && supportsActing && DOC_TYPE_CONFIG[source.docType].showSignatureRankTitle === false
    ? signaturePosition(fields, DOC_TYPE_CONFIG[source.docType]) : '';
  if (hasSigner || authority || actingTitle) {
    const signature = top('P').id;
    if (hasSigner) { wrapMacro('SignatoryAbbrev', signature); wrapMacro('SignatoryName', signature); }
    if (authority) wrapMacro('ByDirection', signature);
    if (actingTitle) wrapMacro('ActingTitle', signature);
  }
  const listRows = (title: string, rows: readonly { text: string }[], macroName: string): string | undefined => {
    if (!rows.length) return;
    const heading = top('H2').id;
    const list = top('L');
    const content = [`    \\noindent ${wrap(heading, title)}\\par`];
    list.children = rows.map(row => {
      const paragraph = node('P');
      content.push(`    \\noindent ${wrap(paragraph.id, escapeLatex(row.text))}\\par`);
      return node('LI', [node('LBody', [paragraph])]);
    });
    return `\\setHas${macroName}\n\\newcommand{\\${macroName}Rows}{%\n${content.join('\n')}\n}\n`;
  };
  const distribution = listRows('Distribution:', source.distributions, 'Distribution');
  const copyTo = listRows('Copy to:', source.copyTos, 'CopyTo');
  const plan: PdfTaggingPlan = { nonce, title: source.formData.subject!.trim(), language: options.language ?? 'en-US', nodes, artifactIds, images };
  validatePdfTaggingPlan(plan);
  const adapter: LatexBodyAdapter = {
    tableCell(index, row, column, _header, latex) {
      const id = tables.get(index)?.cells[row]?.[column];
      if (id === undefined) throw new Error('The tagged table cell projection changed.');
      return `\\leavevmode${point(id, true)}${latex}${point(id, false)}`;
    },
    tableCaption(index, latex) { return wrap(tables.get(index)!.caption!, latex); },
    tableScope(index) { const id = tables.get(index)!.frame; return { begin: point(id, true), end: point(id, false) }; },
    figure(index, part, latex) {
      const id = figures.get(index)?.[part];
      if (id === undefined) throw new Error('The tagged figure projection changed.');
      return wrap(id, latex);
    },
    inline(index, part, latex) {
      const id = paragraphTags.get(index)?.[part];
      if (id === undefined) {
        if (latex.trim()) throw new Error('Unexpected rendered paragraph content outside the tagged projection.');
        return latex;
      }
      return wrap(id, latex);
    },
  };
  const generated = generateAllLatexFiles(source, resolvedLevel, referenceDate, adapter);
  const files: Record<string, string | Uint8Array> = { ...generated.texFiles };
  // Only the explicitly projected reference-title links are qualified here.
  // Body citation hyperlinks remain plain text rather than unowned annotations.
  if (typeof files['flags.tex'] === 'string') files['flags.tex'] = files['flags.tex'].replaceAll('\\setHyperlinksEnabled', '');
  if (source.references.length) files['references.tex'] = source.references.map((reference, index) => {
    const id = references[index].body;
    const url = fields.includeHyperlinks ? taggedReferenceUrl(reference.url) : null;
    const hex = url ? Array.from(new TextEncoder().encode(url), byte => byte.toString(16).padStart(2, '0')).join('') : '';
    const title = escapeLatex(reference.title);
    // Explicit pdfTeX links carry an export-nonce/id pair. The finisher accepts
    // no other annotations and binds each URI back to this immutable plan.
    const body = url ? `\\pdfstartlink attr{/Border [0 0 0] /DDTagLink <${nonce}> /DDTagId ${id}} user{/Subtype /Link /A << /S /URI /URI <${hex}> >>}${title}\\pdfendlink` : title;
    return `\\dondocsEntry{${wrap(references[index].label, `(${escapeLatex(reference.letter)})`)}}{${wrap(id, body)}}`;
  }).join('\n');
  if (distribution) files['distribution-config.tex'] = distribution;
  if (copyTo) files['copyto-config.tex'] = copyTo;
  const footerStart = mainSource.indexOf('\\newcommand{\\smartPageNumber}');
  const footerEnd = mainSource.indexOf('\\makeatother', footerStart);
  if (footerStart < 0 || footerEnd < 0) throw new Error('The tagged PDF footer contract changed.');
  const footer = mainSource.slice(footerStart, footerEnd);
  let main = mainSource.slice(0, footerStart) + footer.replace(/\\thepage(?:\\ of \\getpagerefnumber\{LastPage\})?/g, text => wrap(-1, text)) + mainSource.slice(footerEnd);
  main = replaceOnce(main, '\\ContinuationLabel\\hspace{3\\fontdimen2\\font} & \\ContinuationSubject', `${wrap(-1, '\\ContinuationLabel\\hspace{3\\fontdimen2\\font}')} & ${wrap(-1, '\\ContinuationSubject')}`);
  main = replaceOnce(main, '\\input{\\DocumentType}', `\\input{dondocs-tagged-${source.docType === 'naval_letter' ? 'naval-letter' : 'standard-letter'}}`);
  main = replaceOnce(main, '\\dondocsReserveContHead\n', `${macros.join('\n')}\n\\dondocsReserveContHead\n`);
  files[TAGGED_MAIN_FILE] = main;
  files[`dondocs-tagged-${source.docType === 'naval_letter' ? 'naval-letter' : 'standard-letter'}.tex`] = format;
  return { files, generated, plan, qualification: source.docType === 'naval_letter' ? 'naval-letter' : 'standard-letter' };
}
