import { z } from 'zod';
import type { Paragraph } from '@/types/document';
import { bodyTableSchema, assertRichBlockShape } from './bodyTable';
import { paragraphIdSchema, newParagraphId } from './paragraphIdentity';

export const VOLUME_DOC_TYPE = 'technical_volume';
export const VOLUME_LIMITS = { divisions: 100, sections: 200, blocks: 5_000, characters: 2_000_000, glossary: 500, changes: 200 } as const;
const title = z.string().max(300);
const sectionSchema = z.object({ id: paragraphIdSchema, title }).strict();
const divisionSchema = z.object({ id: paragraphIdSchema, title, sections: z.array(sectionSchema).min(1).max(VOLUME_LIMITS.sections) }).strict();
/** Structural nodes own identities; body blocks stay in the existing paragraph/asset model. */
export const publicationVolumeSchema = z.object({
  version: z.literal(1),
  chapters: z.array(divisionSchema).min(1).max(VOLUME_LIMITS.divisions),
  appendices: z.array(divisionSchema).max(26),
  glossary: z.array(z.object({ id: paragraphIdSchema, term: z.string().max(200), definition: z.string().max(4_000) }).strict()).max(VOLUME_LIMITS.glossary),
  changes: z.array(z.object({ id: paragraphIdSchema, number: z.string().max(40), date: z.string().max(80), description: z.string().max(4_000) }).strict()).max(VOLUME_LIMITS.changes),
  includeContents: z.boolean(),
}).strict().superRefine((volume, context) => {
  const ids = [...volume.chapters, ...volume.appendices].flatMap(node => [node.id, ...node.sections.map(section => section.id)]);
  ids.push(...volume.glossary.map(node => node.id), ...volume.changes.map(node => node.id));
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Volume nodes must have unique identities.' });
  if (volume.chapters.reduce((sum, node) => sum + node.sections.length, 0) + volume.appendices.reduce((sum, node) => sum + node.sections.length, 0) > VOLUME_LIMITS.sections) context.addIssue({ code: 'custom', message: `A volume supports up to ${VOLUME_LIMITS.sections} sections.` });
});
export type PublicationVolume = z.infer<typeof publicationVolumeSchema>;
export type VolumeDivision = PublicationVolume['chapters'][number];
export type VolumeSection = VolumeDivision['sections'][number];
export interface VolumeOutlineEntry {
  id: string;
  title: string;
  label: string;
  kind: 'chapter' | 'appendix' | 'section';
  divisionId: string;
  divisionLabel: string;
  sectionId?: string;
  destination: string;
}
export interface VolumeBlock {
  paragraph: Paragraph;
  index: number;
  label: string;
  sectionId: string;
  divisionId: string;
  divisionLabel: string;
  appendix: boolean;
  destination: string;
}
export const VOLUME_REFERENCE_TOKEN = /\{\{VOLREF_([A-Za-z0-9._:-]+)\}\}/g;
export const volumeReferenceToken = (id: string): string => `{{VOLREF_${paragraphIdSchema.parse(id)}}}`;
export const volumeDestination = (id: string): string => `volume.node.${id}`;

export function emptyPublicationVolume(): PublicationVolume {
  return { version: 1, chapters: [{ id: newParagraphId(), title: 'Introduction', sections: [{ id: newParagraphId(), title: 'General' }] }], appendices: [], glossary: [], changes: [], includeContents: true };
}
export function volumeOutline(volume: PublicationVolume): VolumeOutlineEntry[] {
  return [...volume.chapters.map((node, index) => ({ node, label: String(index + 1), appendix: false })), ...volume.appendices.map((node, index) => ({ node, label: String.fromCharCode(65 + index), appendix: true }))].flatMap(({ node, label, appendix }) => [
    { id: node.id, title: node.title, label: `${appendix ? 'Appendix' : 'Chapter'} ${label}`, kind: appendix ? 'appendix' as const : 'chapter' as const, divisionId: node.id, divisionLabel: label, destination: volumeDestination(node.id) },
    ...node.sections.map((section, index) => ({ id: section.id, title: section.title, label: `${label}.${index + 1}`, kind: 'section' as const, divisionId: node.id, divisionLabel: label, sectionId: section.id, destination: volumeDestination(section.id) })),
  ]);
}
/** Number from structure on every render; never rewrite authored prose when nodes move. */
export function orderedVolumeBlocks(volume: PublicationVolume, paragraphs: readonly Paragraph[]): VolumeBlock[] {
  const indexed = paragraphs.map((paragraph, index) => ({ paragraph, index }));
  return volumeOutline(volume).filter(node => node.kind === 'section').flatMap(section => {
    let paragraphNumber = 0;
    let figureNumber = 0;
    let tableNumber = 0;
    return indexed.filter(({ paragraph }) => paragraph.volumeSectionId === section.id).map(({ paragraph, index }) => {
      const label = paragraph.figure ? `Figure ${section.label}-${++figureNumber}` : paragraph.bodyTable ? `Table ${section.label}-${++tableNumber}` : `${section.label}.${++paragraphNumber}`;
      return { paragraph, index, label, sectionId: section.id, divisionId: section.divisionId, divisionLabel: section.divisionLabel, appendix: volume.appendices.some(node => node.id === section.divisionId), destination: volumeDestination(paragraph.id ?? `missing-${index}`) };
    });
  });
}
export function volumeParagraphLabel(volume: PublicationVolume, paragraphs: readonly Paragraph[], id: string): string | undefined {
  return orderedVolumeBlocks(volume, paragraphs).find(block => block.paragraph.id === id)?.label;
}
export function volumeReferenceTargets(volume: PublicationVolume, paragraphs: readonly Paragraph[]): Array<{ id: string; label: string; title: string; destination: string }> {
  return [...volumeOutline(volume).map(node => ({ id: node.id, label: node.label, title: node.title, destination: node.destination })), ...orderedVolumeBlocks(volume, paragraphs).flatMap(block => block.paragraph.id ? [{ id: block.paragraph.id, label: block.label, title: block.paragraph.header || block.paragraph.text.slice(0, 100), destination: block.destination }] : [])];
}
export function resolveVolumeReferences(text: string, volume: PublicationVolume, paragraphs: readonly Paragraph[]): string {
  const targets = new Map(volumeReferenceTargets(volume, paragraphs).map(target => [target.id, target.label]));
  return text.replace(VOLUME_REFERENCE_TOKEN, (_token, id: string) => targets.get(id) ?? '[Missing reference]');
}
/** Structural validation permits unfinished headings; export readiness is a separate decision. */
type VolumeValidationParagraph = Pick<Paragraph, 'id' | 'volumeSectionId' | 'text' | 'header' | 'bodyTable'> & { level?: number; figure?: { placement?: string; portionMarking?: unknown }; portionMarking?: unknown; callout?: unknown; procedure?: unknown; tableKey?: unknown; tableFootnotes?: unknown; appendix?: unknown; publicationSection?: unknown };
export function validatePublicationVolume(value: unknown, paragraphs: readonly VolumeValidationParagraph[]): PublicationVolume {
  const volume = publicationVolumeSchema.parse(value);
  if (paragraphs.length > VOLUME_LIMITS.blocks) throw new Error(`A volume supports up to ${VOLUME_LIMITS.blocks} body blocks.`);
  const sections = new Set(volumeOutline(volume).filter(node => node.kind === 'section').map(node => node.id));
  const nodeIds = new Set([...volumeOutline(volume).map(node => node.id), ...volume.glossary.map(entry => entry.id), ...volume.changes.map(entry => entry.id)]);
  const ids = new Set<string>();
  let characters = 0;
  for (const paragraph of paragraphs) {
    assertRichBlockShape(paragraph);
    if (paragraph.figure && (paragraph.callout || paragraph.procedure || paragraph.tableKey || paragraph.appendix)) throw new Error('A volume figure must have its own native block. Separate conflicting content before saving or exporting.');
    if (paragraph.bodyTable) bodyTableSchema.parse(paragraph.bodyTable);
    for (const marking of [paragraph.portionMarking, paragraph.figure?.portionMarking]) {
      if (marking !== undefined && !['U', 'CUI', 'FOUO', 'C', 'S', 'TS'].includes(String(marking))) throw new Error('A volume block has an unsupported portion marking.');
    }
    if (paragraph.tableFootnotes && (!Array.isArray(paragraph.tableFootnotes) || paragraph.tableFootnotes.length)) throw new Error('Volume tables do not yet support publication footnotes. Keep the note as a separate body block.');
    if (!paragraph.id || !paragraphIdSchema.safeParse(paragraph.id).success || ids.has(paragraph.id) || nodeIds.has(paragraph.id)) throw new Error('Volume body blocks require unique stable identities.');
    ids.add(paragraph.id);
    if (!paragraph.volumeSectionId || !sections.has(paragraph.volumeSectionId)) throw new Error('A volume body block is not assigned to an existing section.');
    if (paragraph.tableKey || paragraph.appendix || paragraph.publicationSection) throw new Error('Use volume sections, appendices and native body tables for volume content.');
    characters += paragraph.text.length + (paragraph.header?.length ?? 0) + (paragraph.bodyTable?.rows.flat().reduce((sum, cell) => sum + cell.length, 0) ?? 0);
    if (characters > VOLUME_LIMITS.characters) throw new Error('The volume exceeds the supported body text limit.');
  }
  if (characters > VOLUME_LIMITS.characters) throw new Error('The volume exceeds the supported body text limit.');
  return volume;
}
export function publicationVolumeErrors(value: unknown, paragraphs: readonly Paragraph[]): string[] {
  let volume: PublicationVolume;
  try { volume = validatePublicationVolume(value, paragraphs); }
  catch (error) { return [error instanceof Error ? error.message : 'Invalid publication volume.']; }
  const errors: string[] = [];
  if (volumeOutline(volume).some(node => !node.title.trim())) errors.push('Give every chapter, appendix and section a title.');
  if (!paragraphs.some(paragraph => paragraph.text.trim() || paragraph.bodyTable || paragraph.figure)) errors.push('Add content to the volume.');
  const targets = new Set(volumeReferenceTargets(volume, paragraphs).map(target => target.id));
  const texts = [...volumeOutline(volume).map(node => node.title), ...paragraphs.flatMap(paragraph => [paragraph.text, paragraph.header ?? '', ...(paragraph.bodyTable?.rows.flat() ?? [])]), ...volume.glossary.flatMap(entry => [entry.term, entry.definition]), ...volume.changes.flatMap(entry => [entry.number, entry.date, entry.description])];
  if (texts.some(text => text.includes('{{PUBREF_'))) errors.push('Replace older publication references using the volume reference picker.');
  if (texts.some(text => text.replace(VOLUME_REFERENCE_TOKEN, '').includes('{{VOLREF_'))) errors.push('A volume reference is malformed. Reinsert it using the reference picker.');
  if (texts.some(text => [...text.matchAll(VOLUME_REFERENCE_TOKEN)].some(match => !targets.has(match[1])))) errors.push('A volume reference has no target. Restore its target or replace the reference before exporting.');
  if (volume.glossary.some(entry => !entry.term.trim() || !entry.definition.trim())) errors.push('Complete each glossary term and definition.');
  if (volume.changes.some(entry => !entry.number.trim() || !entry.date.trim() || !entry.description.trim())) errors.push('Complete the number, date and description of every change record.');
  return errors;
}

/** Immutable reorder helper retains every node identity and its original content. */
export function moveVolumeNode<T>(nodes: readonly T[], from: number, to: number): T[] {
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < nodes.length)) throw new Error('Choose an existing volume node to move.');
  const result = [...nodes];
  const [node] = result.splice(from, 1);
  result.splice(to, 0, node);
  return result;
}

/** New actions own new identities; links follow their targets, never positional guesses. */
export function freshVolumeContent(value: PublicationVolume, source: readonly Paragraph[], options: { retained?: boolean } = {}): { volume: PublicationVolume; paragraphs: Paragraph[] } {
  const paragraphs = structuredClone(source.map(paragraph => ({ ...paragraph, id: paragraph.id ?? newParagraphId() })));
  // A different active document type may contain newer, unbound native blocks.
  // Preserve them while remapping the retained outline, rather than claiming
  // they already satisfy the stricter active-volume body contract.
  const volume = options.retained ? publicationVolumeSchema.parse(value) : validatePublicationVolume(value, paragraphs);
  const replacements = new Map<string, string>();
  const fresh = (id: string): string => {
    let next = replacements.get(id);
    if (!next) { next = newParagraphId(); replacements.set(id, next); }
    return next;
  };
  for (const division of [...volume.chapters, ...volume.appendices]) {
    fresh(division.id);
    division.sections.forEach(section => fresh(section.id));
  }
  for (const paragraph of paragraphs) if (paragraph.id) fresh(paragraph.id);
  volume.glossary.forEach(entry => fresh(entry.id));
  volume.changes.forEach(entry => fresh(entry.id));
  const rewrite = (text: string): string => text.replace(VOLUME_REFERENCE_TOKEN, (token, id: string) => replacements.has(id) ? volumeReferenceToken(replacements.get(id)!) : token);
  for (const division of [...volume.chapters, ...volume.appendices]) {
    division.id = fresh(division.id);
    division.title = rewrite(division.title);
    for (const section of division.sections) { section.id = fresh(section.id); section.title = rewrite(section.title); }
  }
  for (const paragraph of paragraphs) {
    paragraph.id = paragraph.id ? fresh(paragraph.id) : newParagraphId();
    if (paragraph.volumeSectionId) paragraph.volumeSectionId = replacements.get(paragraph.volumeSectionId) ?? paragraph.volumeSectionId;
    paragraph.text = rewrite(paragraph.text);
    if (paragraph.header) paragraph.header = rewrite(paragraph.header);
    if (paragraph.bodyTable) paragraph.bodyTable.rows = paragraph.bodyTable.rows.map(row => row.map(rewrite));
    if (paragraph.figure?.altText) paragraph.figure.altText = rewrite(paragraph.figure.altText);
  }
  volume.glossary = volume.glossary.map(entry => ({ id: fresh(entry.id), term: rewrite(entry.term), definition: rewrite(entry.definition) }));
  volume.changes = volume.changes.map(entry => ({ ...entry, id: fresh(entry.id), number: rewrite(entry.number), date: rewrite(entry.date), description: rewrite(entry.description) }));
  return { volume, paragraphs };
}
