import { z } from 'zod';
import type { DocumentData, Enclosure, EnclosureMarking, Paragraph } from '@/types/document';
import { CLASSIFICATION_LEVELS, classificationRank, deriveOverallClassLevel } from './overallClassification';
import { CLASSIFICATION_LABELS, classificationBannerLevel } from './detectClassification';
import type { ClassificationInfo } from '@/services/pdf/mergeEnclosures';
import type { ClassificationLevel } from './domainClassification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { resolveAppendedEndorsements } from './appendedEndorsement';

/** Missing means inherit; an explicit unclassified value never inherits. */
export const enclosureMarkingSchema = z.object({
  classLevel: z.enum([...CLASSIFICATION_LEVELS, 'custom']),
  customClassification: z.string().max(240).optional(),
  cuiCategory: z.string().max(240).optional(),
  cuiDissemination: z.string().max(240).optional(),
}).strict();

export function hasEnclosureMarkings(source: { enclosures?: readonly Pick<Enclosure, 'marking'>[] }): boolean {
  return !!source.enclosures?.some(enclosure => enclosure.marking !== undefined);
}

export function requiresEnclosureMarkingReader(source: { formData?: Pick<Partial<DocumentData>, 'cuiTransmittalNote'>; enclosures?: readonly Pick<Enclosure, 'marking'>[] }): boolean {
  return hasEnclosureMarkings(source) || source.formData?.cuiTransmittalNote === true;
}

/** Reuse the deployment allowlist at every output and portable-transfer boundary. */
export function assertEnclosureMarkingPolicy(source: { enclosures?: readonly Pick<Enclosure, 'marking'>[] }, policy: PolicyResolution): void {
  if (policy.status !== 'ready') throw new Error(policy.message);
  for (const [index, enclosure] of (source.enclosures ?? []).entries()) {
    if (!enclosure.marking) continue;
    const marking = enclosureMarkingSchema.parse(enclosure.marking);
    const level = enclosureMarkingLevel(marking);
    if (!level) throw new Error(`Enclosure ${index + 1} has an unrecognized custom marking. Choose a recognized level before exporting or sharing.`);
    if (!policy.policy.allowedLevels.includes(level)) throw new Error(`Enclosure ${index + 1} is marked ${CLASSIFICATION_LABELS[level]}, outside this deployment's configured levels.`);
  }
}

export function enclosureMarkingLevel(marking: EnclosureMarking): ClassificationLevel | undefined {
  return marking.classLevel === 'custom' ? classificationBannerLevel(marking.customClassification?.trim() ?? '') ?? undefined
    : classificationRank(marking.classLevel) === undefined ? undefined : marking.classLevel;
}

/** Only the assembled derivative receives this banner; source bytes are retained. */
export function enclosureClassification(marking: EnclosureMarking | undefined, inherited?: ClassificationInfo): ClassificationInfo | undefined {
  if (!marking) return inherited;
  enclosureMarkingSchema.parse(marking);
  const text = marking.classLevel === 'custom' ? marking.customClassification?.trim()
    : CLASSIFICATION_LABELS[marking.classLevel];
  if (!text) throw new Error('Enter the enclosure marking text before exporting.');
  return { level: marking.classLevel, marking: text };
}

function controls(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(/[,;/\n]+/).map(item => item.trim().toUpperCase()).filter(Boolean));
}

export interface EnclosureMarkingIssue { index: number; message: string; kind: 'level' | 'custom' | 'controls' }
/** An advisory comparison of declarations, not a classification determination. */
export function inspectEnclosureMarkings(data: Partial<DocumentData>, enclosures: readonly Pick<Enclosure, 'marking'>[]): EnclosureMarkingIssue[] {
  const cover: EnclosureMarking = { classLevel: (data.classLevel ?? 'unclassified') as EnclosureMarking['classLevel'],
    customClassification: data.customClassification, cuiCategory: data.cuiCategory, cuiDissemination: data.cuiDissemination };
  const coverLevel = enclosureMarkingLevel(cover);
  return enclosures.flatMap<EnclosureMarkingIssue>(({ marking }, index) => {
    if (!marking) return [];
    const level = enclosureMarkingLevel(marking);
    if (!level || !coverLevel) return [{ index, kind: 'custom' as const,
      message: 'The cover or enclosure marking cannot be compared automatically. Review the original pages and preserve all required controls.' }];
    if (classificationRank(level)! > classificationRank(coverLevel)!) return [{ index, kind: 'level' as const,
      message: `The enclosure is declared ${CLASSIFICATION_LABELS[level]}, above the cover marking. Review the cover and enclosure markings before delivery.` }];
    if (marking.classLevel === 'custom' && marking.customClassification?.trim() !== data.customClassification?.trim()) return [{ index, kind: 'custom' as const,
      message: 'The enclosure has a different custom banner. Review its categories and dissemination controls against the cover.' }];
    if (level === 'cui' && coverLevel !== 'cui' && (controls(marking.cuiCategory).size || controls(marking.cuiDissemination).size)) return [{ index, kind: 'controls' as const,
      message: 'Review the enclosure CUI categories and dissemination controls against the classified or custom cover. A higher classification level alone does not resolve these controls.' }];
    if (level === 'cui' && coverLevel === 'cui') {
      const missing = [...controls(marking.cuiCategory)].some(value => !controls(cover.cuiCategory).has(value))
        || [...controls(marking.cuiDissemination)].some(value => !controls(cover.cuiDissemination).has(value));
      if (missing) return [{ index, kind: 'controls' as const,
        message: 'The cover does not list all declared enclosure CUI categories or dissemination controls. Review the required rollup; category names are not ranked automatically.' }];
    }
    return [];
  });
}

export const CUI_TRANSMITTAL_NOTE = 'When enclosures are removed, this document is Uncontrolled Unclassified Information.';
export const CUI_TRANSMITTAL_SOURCE = 'https://www.ecfr.gov/current/title-32/subtitle-B/chapter-XX/part-2002/subpart-B/section-2002.20#p-2002.20(j)';

export function cuiTransmittalIssue(data: Partial<DocumentData>, paragraphs: Paragraph[], enclosures: readonly Pick<Enclosure, 'marking'>[], docType = data.docType ?? 'naval_letter'): string | undefined {
  if (data.cuiTransmittalNote !== true || data.classLevel !== 'cui') return;
  const endorsements = resolveAppendedEndorsements(docType, data).flatMap(endorsement => endorsement.paragraphs.map(text => ({ text })));
  if (deriveOverallClassLevel('unclassified', [...paragraphs, ...endorsements]) !== 'unclassified') return 'The transmittal note conflicts with controlled or classified body, figure or endorsement portions. Remove the note or review the portion declarations.';
  if (!enclosures.some(enclosure => enclosure.marking === undefined || enclosureMarkingLevel(enclosure.marking) === 'cui')) return 'The transmittal note is enabled without a declared CUI enclosure. Review the enclosure list or remove the note.';
}

/** The author explicitly confirms the cover-only determination; never alter markings. */
export function cuiTransmittalNote(data: Partial<DocumentData>, paragraphs: Paragraph[], enclosures: readonly Pick<Enclosure, 'marking'>[], docType = data.docType ?? 'naval_letter'): string | undefined {
  return data.cuiTransmittalNote === true && data.classLevel === 'cui' && !cuiTransmittalIssue(data, paragraphs, enclosures, docType)
    ? CUI_TRANSMITTAL_NOTE : undefined;
}
