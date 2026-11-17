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
import { resolveAppendedEndorsements } from '@/lib/appendedEndorsement';
import { bodyTableSchema } from '@/lib/bodyTable';
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

/** Conservative, visible support boundaries. Unsupported source stays editable;
 * a tagged request must stop rather than silently return an ordinary PDF. */
export function taggedCorrespondenceIssues(source: TaggedCorrespondenceSource, resolvedLevel = source.formData.classLevel ?? 'unclassified'): string[] {
  const issues: string[] = [];
  if (!['standard_letter', 'naval_letter'].includes(source.docType)) issues.push('Tagged PDF currently supports standard and naval letters. Other document layouts need separate qualification.');
  if (resolvedLevel !== 'unclassified' || source.paragraphs.some(p => (p.portionMarking && p.portionMarking !== 'U') || (p.figure?.portionMarking && p.figure.portionMarking !== 'U'))) issues.push('Classification and handling banners are not yet qualified for tagged output.');
  if (source.enclosures.length || source.formData.basicLetterFile || source.formData.basicLetterFileRef) issues.push('Tagged output cannot include original PDFs or enclosures. Export the native letter separately.');
  if (source.formData.signatureType && source.formData.signatureType !== 'none') issues.push('Signature images and digital signature fields need separate tagged-output qualification.');
  if (resolveAppendedEndorsements(source.docType, source.formData).length) issues.push('Appended endorsements are not yet qualified for tagged output.');
  if (!source.formData.subject?.trim() || !source.formData.from?.trim() || !source.formData.to?.trim() || !source.formData.date?.trim()) issues.push('Complete the subject, date, From and To fields before tagged export.');
  if (!source.paragraphs.length || source.paragraphs.length > 200) issues.push('Tagged letters require between 1 and 200 body paragraphs.');
  if (source.paragraphs.some(p => p.tableKey || p.callout || p.procedure || p.appendix)) issues.push('Publication blocks need their tagged-output qualification.');
  for (const [index, p] of source.paragraphs.entries()) {
    if (p.bodyTable) {
      const parsed = bodyTableSchema.safeParse(p.bodyTable);
      if (!parsed.success || !p.bodyTable.headerRows || p.bodyTable.headerRows >= p.bodyTable.rows.length
        || p.bodyTable.rows.slice(0, p.bodyTable.headerRows).some(row => row.some(cell => !cell.trim()))) issues.push('Tagged tables need a valid rectangular body with nonempty column headers and at least one data row.');
      if (parsed.success && (p.bodyTable.rows[0].length > 6 || p.bodyTable.rows.some(row => row.reduce((sum, cell) => sum + cell.length, 0) > 1200 || row.some(cell => cell.length > 400)))) issues.push('Tagged tables currently support up to 6 columns, 400 characters per cell and 1200 per row. Split dense tables before tagged export.');
    }
    if (p.figure && (p.figure.placement !== 'body' || !p.figure.fileRef || !['image/png', 'image/jpeg'].includes(p.figure.type ?? '') || !p.figure.altText?.trim() || p.figure.altText.length > 2000)) issues.push('Tagged body images need an attached PNG or JPEG and meaningful alternative text.');
    if ((p.figure || p.bodyTable) && (p.level !== 0 || (source.paragraphs[index + 1]?.level ?? 0) !== 0)) issues.push('Tagged tables and images must stand between top-level paragraphs.');
  }
  if (source.paragraphs.some(p => !p.bodyTable && !p.figure && !p.text.trim() && !p.header?.trim())) issues.push('Remove empty body paragraphs before tagged export.');
  if (source.paragraphs.some((p, index) => !Number.isInteger(p.level) || p.level < 0 || p.level > 5 || (!index && p.level !== 0)
    || (index > 0 && p.level > source.paragraphs[index - 1].level + 1))) issues.push('Correct the paragraph hierarchy before tagged export.');
  if (source.references.some(ref => ref.url?.trim())) issues.push('Linked references need annotation qualification before tagged export.');
  if (source.references.some(ref => !ref.letter.trim() || !ref.title.trim())) issues.push('Complete reference labels and titles before tagged export.');
  if (source.copyTos.some(row => !row.text.trim()) || source.distributions.some(row => !row.text.trim())) issues.push('Remove empty Copy to and Distribution entries before tagged export.');
  const chars = source.paragraphs.reduce((sum, p) => sum + p.text.length + (p.header?.length ?? 0) + (p.bodyTable?.rows.reduce((total, row) => total + row.reduce((length, cell) => length + cell.length, 0), 0) ?? 0) + (p.figure?.altText?.length ?? 0), 0);
  if (chars > 250_000 || source.references.length > 100 || source.copyTos.length > 100 || source.distributions.length > 100) issues.push('The letter exceeds the qualified tagged-output content limits.');
  return issues;
}

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
  if (source.docType === 'naval_letter') {
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
    list.children = source.references.map(() => {
      const label = node('Lbl'); const paragraph = node('P');
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
  if (source.references.length) files['references.tex'] = source.references.map((reference, index) => `\\dondocsEntry{${wrap(references[index].label, `(${escapeLatex(reference.letter)})`)}}{${wrap(references[index].body, escapeLatex(reference.title))}}`).join('\n');
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
