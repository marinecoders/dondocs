import {
  orderedVolumeBlocks, validatePublicationVolume, volumeOutline, volumeReferenceTargets, VOLUME_REFERENCE_TOKEN,
} from '@/lib/publicationVolume';
import { formatPublicationDate } from '@/lib/publicationDate';
import { publicationFigure } from './instructions';
import type { PublicationWordPorts, PublicationWordSource } from './index';
import type { PublicationWordPackage, SectionFormat, WordTextRun } from './package';

const literal = (text: string, bold = false): WordTextRun => ({ text, format: { inlineMode: 'literal', ...(bold ? { bold } : {}) } });
const rich = (text: string, bold = false): WordTextRun => ({ text, format: { inlineMode: 'rich', ...(bold ? { bold } : {}) } });

export async function volumeWord(
  word: PublicationWordPackage,
  document: PublicationWordSource,
  ports: PublicationWordPorts,
  section: SectionFormat,
  referenceDate: Date,
): Promise<SectionFormat> {
  const { formData: data, paragraphs } = document;
  const volume = validatePublicationVolume(data.volume, paragraphs);
  const outline = volumeOutline(volume);
  const targets = volumeReferenceTargets(volume, paragraphs);
  const labels = new Map(targets.map(target => [target.id, target.label]));
  const plain = (value: string) => value.replace(VOLUME_REFERENCE_TOKEN, (_token, id: string) => {
    const label = labels.get(id);
    if (!label) throw new Error('A volume reference has no target. Reinsert the reference before export.');
    return label;
  });
  word.registerTargets([
    ...targets.map(({ id, label, destination }) => ({ name: `VOLREF_${id}`, label, destination })),
    ...(volume.glossary.length ? [{ name: 'Glossary', label: 'Glossary', destination: 'volume.glossary' }] : []),
  ]);

  word.text(data.subject ?? '', { style: 'Title', align: 'center', size: 18, before: 36, after: 18 });
  for (const line of [data.shortTitle, formatPublicationDate(data.date ?? '', referenceDate), data.controllingOffice]) {
    if (line?.trim()) word.text(line, { align: 'center', after: 12 });
  }
  if (data.classLevel === 'cui') {
    word.text(`Controlled by: ${data.cuiControlledBy}\nCUI Categories: ${data.cuiCategory}\nDissemination: ${data.cuiDissemination ?? ''}\nPOC: ${data.pocEmail}`, { before: 18 });
  }
  word.endSection({ ...section, cover: true, hidePageNumber: true });

  if (volume.includeContents) {
    word.heading('TABLE OF CONTENTS', 1);
    for (const entry of outline) {
      word.navigation(`${entry.label}. ${plain(entry.title)}`, entry.destination, 'link-only', entry.kind === 'section' ? 14 : 0);
    }
    if (volume.glossary.length) word.navigation('Glossary', 'volume.glossary', 'link-only');
  }
  if (volume.changes.length) {
    word.heading('Record of changes', 1, { newPage: volume.includeContents });
    for (const change of volume.changes) {
      word.text([rich(change.number), literal(' — '), rich(change.date)], { bold: true, keep: true });
      word.text(change.description, { inlineMode: 'rich' });
    }
  }
  if (volume.includeContents || volume.changes.length) word.endSection({ ...section, numbering: 'lowerRoman', start: 1 });

  const blocks = new Map<string, ReturnType<typeof orderedVolumeBlocks>>();
  for (const block of orderedVolumeBlocks(volume, paragraphs)) {
    let group = blocks.get(block.sectionId);
    if (!group) {
      group = [];
      blocks.set(block.sectionId, group);
    }
    group.push(block);
  }
  let current: SectionFormat = { ...section, start: 1 };
  let chapterStarted = false;
  for (const entry of outline) {
    word.check();
    if (entry.kind === 'appendix') {
      word.endSection(current);
      current = { ...section, prefix: `${entry.divisionLabel}-`, start: 1 };
    }
    word.heading([literal(`${entry.label}. `), rich(entry.title)], entry.kind === 'section' ? 2 : 1, {
      destination: entry.destination, newPage: entry.kind === 'chapter' && chapterStarted,
    });
    if (entry.kind === 'chapter') chapterStarted = true;
    if (entry.kind !== 'section') continue;
    for (const block of blocks.get(entry.id) ?? []) {
      const paragraph = block.paragraph;
      const portion = paragraph.portionMarking ? ` (${paragraph.portionMarking})` : '';
      const leading = `${block.label}.${portion}`;
      word.anchor(block.destination);
      if (paragraph.callout) word.text(paragraph.callout.toUpperCase(), { bold: true, keep: true });
      const text = [
        literal(leading, true),
        ...(paragraph.header ? [rich(` ${paragraph.header}`, true)] : []),
        ...(paragraph.text ? [rich(` ${paragraph.text}`)] : []),
      ];
      if (paragraph.figure) {
        const altText = plain(paragraph.figure.altText?.trim() || [paragraph.header, paragraph.text].filter(Boolean).join(' ') || leading);
        await publicationFigure(word, { ...paragraph, figure: { ...paragraph.figure, altText } }, ports, text);
      } else if (paragraph.bodyTable) {
        word.text(text, { bold: true, keep: true });
        word.bodyTable(paragraph.bodyTable);
      } else {
        word.text(text);
      }
    }
  }
  if (volume.glossary.length) {
    word.endSection(current);
    current = { ...section, prefix: 'GL-', start: 1 };
    word.heading('Glossary', 1, { destination: 'volume.glossary' });
    for (const entry of volume.glossary) {
      word.text(entry.term, { bold: true, keep: true, inlineMode: 'rich' });
      word.text(entry.definition, { inlineMode: 'rich' });
    }
  }
  return current;
}
