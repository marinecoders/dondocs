import type { DocumentData, Paragraph } from '@/types/document';
import { volumeFigureFile } from '@/lib/figures';
import { assertRichBlockShape } from '@/lib/bodyTable';
import { volumeOutputTextErrors } from '@/lib/volumeOutput';
import {
  orderedVolumeBlocks, publicationVolumeErrors, validatePublicationVolume,
  volumeOutline, volumeReferenceTargets, VOLUME_REFERENCE_TOKEN,
} from '@/lib/publicationVolume';
import { renderBodyTable } from './bodyTable';
import { renderBreakableRichText } from './bodyTableText';
import { escapeLatex, processBodyText } from './escaper';

type VolumeSource = { formData: Partial<DocumentData>; paragraphs: Paragraph[] };

/** Resolve identity-based links without rewriting the saved source text. */
export function volumeText(text: string, targets: ReadonlyMap<string, { label: string; destination: string }>, options: { breakWords?: boolean; linkReferences?: boolean } = {}): string {
  text = text.normalize('NFC');
  let prefix = 'ZZZPUBLICATIONLINK';
  while (text.includes(prefix)) prefix += 'X';
  const links: string[] = [], keys: string[] = [];
  const protectedText = text.replace(VOLUME_REFERENCE_TOKEN, (_token, id: string) => {
    const target = targets.get(id);
    if (!target) throw new Error('A volume reference has no target. Restore its target before exporting.');
    if (options.linkReferences === false) return target.label;
    const key = `${prefix}${keys.length}ZZZ`;
    keys.push(key);
    const link = `\\dondocsReferenceLink{${target.destination}}{${escapeLatex(target.label)}}`;
    links.push(options.breakWords ? `\\dondocsTableAtomic{${link}}` : link);
    return key;
  });
  if (!options.breakWords && !keys.length && !/\S{30,}/u.test(protectedText)) return processBodyText(protectedText);
  let rendered = renderBreakableRichText(protectedText, [], 0, keys);
  keys.forEach((key, index) => { rendered = rendered.split(key).join(links[index]); });
  return rendered;
}

/** Shared preview/export body; figures keep their source-array asset indices. */
export function generateVolumeBody(source: VolumeSource, options?: { allowEmptyContent?: boolean }): string {
  const volume = validatePublicationVolume(source.formData.volume, source.paragraphs);
  const errors = publicationVolumeErrors(volume, source.paragraphs, options);
  errors.push(...volumeOutputTextErrors(source));
  if (errors.length) throw new Error(errors.join(' '));
  const outline = volumeOutline(volume);
  const blocks = orderedVolumeBlocks(volume, source.paragraphs);
  const targets = new Map(volumeReferenceTargets(volume, source.paragraphs).map(target => [target.id, target]));
  const text = (value: string) => volumeText(value, targets);
  const plainReferences = (value: string) => value.replace(VOLUME_REFERENCE_TOKEN, (_token, id: string) => targets.get(id)!.label);
  const figures = new Map<number, number>();
  let figureIndex = 0;
  source.paragraphs.forEach((paragraph, index) => { if (paragraph.figure) figures.set(index, ++figureIndex); });
  const heading = (label: string, title: string, destination: string, large = false, children = 0) =>
    `\\par\\dondocsVolumeNeedspace{4\\baselineskip}\\dondocsVolumeBookmark{${-children}}{${escapeLatex([label, plainReferences(title)].filter(Boolean).join('. '))}}{${destination}}\\label{${destination}}\n` +
    `{${large ? '\\Large' : '\\large'}\\bfseries ${escapeLatex(label)}${label && title ? '. ' : ''}${text(title)}\\par}\\vspace{12pt}\n`;
  const out: string[] = ['% Full-volume content; labels derive from stable structure.\n'];
  if (volume.includeContents || volume.changes.length) out.push('\\pagenumbering{roman}\\dondocsReferenceAnchor{volume.pages.front}\n');
  if (volume.includeContents) {
    out.push(heading('', 'Contents', 'volume.contents', true));
    for (const entry of outline) {
      out.push(`\\noindent${entry.kind === 'section' ? '\\hspace*{0.2in}' : ''}` +
        `\\dondocsReferenceLink{${entry.destination}}{${escapeLatex(entry.label)}. ${volumeText(entry.title, targets, { linkReferences: false })}}\\nobreak\\hfill\\dondocsVolumePageReference{${entry.destination}}\\par\\vspace{4pt}\n`);
    }
    if (volume.glossary.length) out.push('\\dondocsReferenceLink{volume.glossary}{Glossary}\\par\n');
    out.push('\\clearpage\n');
  }
  if (volume.changes.length) {
    out.push(heading('', 'Record of changes', 'volume.changes', true));
    for (const change of volume.changes) out.push(`\\par\\vspace{6pt}\\noindent\\textbf{${text(change.number)}} -- ${text(change.date)}\\par ${text(change.description)}\\par\n`);
    out.push('\\clearpage\n');
  }
  out.push('\\pagenumbering{arabic}\\dondocsReferenceAnchor{volume.pages.body}\n');
  for (const entry of outline) {
    if (entry.kind !== 'section') {
      out.push('\\clearpage\n');
      // A new appendix owns its own physical page sequence. Chapters share the body sequence.
      if (entry.kind === 'appendix') out.push(`\\setcounter{page}{1}\\renewcommand{\\thepage}{${entry.divisionLabel}-\\arabic{page}}\\dondocsReferenceAnchor{volume.pages.${entry.divisionLabel}}\n`);
      out.push(heading(entry.label, entry.title, entry.destination, true, outline.filter(node => node.kind === 'section' && node.divisionId === entry.id).length));
      continue;
    }
    out.push(heading(entry.label, entry.title, entry.destination));
    for (const block of blocks.filter(block => block.sectionId === entry.id)) {
      const paragraph = block.paragraph;
      assertRichBlockShape(paragraph);
      const portion = paragraph.portionMarking ? `(${paragraph.portionMarking}) ` : '';
      const anchor = `\\dondocsReferenceAnchor{${block.destination}}\\label{${block.destination}}`;
      if (paragraph.bodyTable) out.push(anchor + '\n');
      if (paragraph.bodyTable) {
        out.push(`\\par\\noindent\\textbf{${escapeLatex(block.label)}. ${portion}${text([paragraph.header, paragraph.text].filter(Boolean).join(' '))}}\\par\n`);
        out.push(renderBodyTable(paragraph.bodyTable, value => volumeText(value, targets, { breakWords: true }).replaceAll('\n', '\\newline ')));
      } else if (paragraph.figure) {
        if (!paragraph.figure.fileRef) throw new Error('A volume figure is missing. Reattach the original image before exporting.');
        const file = volumeFigureFile(figures.get(block.index)!, paragraph.figure.type, paragraph.figure.name, paragraph.figure.fileRef.id);
        const imagePortion = paragraph.figure.portionMarking ? `(${paragraph.figure.portionMarking}) ` : '';
        // Keep the destination at the image's top edge inside the same
        // unbreakable box, including when preceding content fills the page.
        out.push(`\\par\\vspace{12pt}\\begin{center}\\leavevmode\\vbox{\\offinterlineskip\\hbox{${anchor}${imagePortion}}\\hbox{\\includegraphics[width=\\linewidth,height=5in,keepaspectratio]{${file}}}}\\par\\vspace{6pt}\n` +
          `\\textbf{${escapeLatex(block.label)}. ${portion}${text([paragraph.header, paragraph.text].filter(Boolean).join(' '))}}\\par\\end{center}\\vspace{12pt}\n`);
      } else {
        // Insert the anchor into the first printed line, after spacing that
        // may move the paragraph onto the next page. Raise it above the text.
        const inlineAnchor = `\\raisebox{\\ht\\strutbox}[0pt][0pt]{${anchor}}`;
        const callout = paragraph.callout ? `\\textbf{${paragraph.callout.toUpperCase()}}\\par\n` : '';
        out.push(`\\par\\vspace{6pt}\\noindent${inlineAnchor}${callout}\\textbf{${escapeLatex(block.label)}.} ${portion}` +
          `${paragraph.header ? '\\textbf{' + text(paragraph.header) + '} ' : ''}${text(paragraph.text)}\\par\n`);
      }
    }
  }
  if (volume.glossary.length) {
    out.push('\\clearpage\\renewcommand{\\thepage}{GL-\\arabic{page}}\\setcounter{page}{1}\\dondocsReferenceAnchor{volume.pages.glossary}\n');
    out.push(heading('', 'Glossary', 'volume.glossary', true));
    for (const item of volume.glossary) out.push(`\\par\\vspace{6pt}\\noindent\\textbf{${text(item.term)}}\\par ${text(item.definition)}\\par\n`);
  }
  return out.join('');
}
