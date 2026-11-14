import { DOC_TYPE_CONFIG, type DocumentCategory, type DocumentMode, type Paragraph, type Reference } from '@/types/document';
import { normalizeBodyDate, type BodyDateAudience } from './bodyDateFormatting';
import { maskProtectedRanges, protectedCodeRanges } from './protectedCodeRanges';

export type { BodyDateAudience } from './bodyDateFormatting';
export type MechanicalSection = 'body' | 'references';
export type MechanicalRule = 'body-date-standard' | 'body-date-civilian' | 'reference-notal-marker';
export interface MechanicalSource {
  documentCategory: DocumentCategory;
  documentMode: DocumentMode;
  docType: string;
  paragraphs: readonly Paragraph[];
  references: readonly Reference[];
}
export interface MechanicalTarget {
  readonly kind: 'paragraph-text' | 'reference-title';
  readonly index: number;
  readonly start: number;
  readonly end: number;
}
export interface MechanicalFinding {
  readonly id: string;
  readonly ruleId: MechanicalRule;
  readonly target: MechanicalTarget;
  readonly label: string;
  readonly before: string;
  readonly after?: string;
  readonly sourceText: string;
  readonly message: string;
}

export function supportsMechanicalCorrections(source: MechanicalSource): boolean {
  const config = Object.hasOwn(DOC_TYPE_CONFIG, source.docType) ? DOC_TYPE_CONFIG[source.docType] : undefined;
  return source.documentCategory === 'correspondence' && !!config && config.signature !== 'dual'
    && !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(source.docType);
}

function protectedRanges(text: string): readonly [number, number][] {
  const ranges = protectedCodeRanges(text);
  const prose = maskProtectedRanges(text, ranges);
  // An unclosed literal is also left alone. Date recognition never edits source
  // quotations, code, URLs, placeholders, or a Markdown quote line.
  const literals = /"[^"]*(?:"|$)|“[^”]*(?:”|$)|‘(?:[^’]|’(?=[\p{L}\p{M}\p{N}_]))*(?:’|$)|(?:https?:\/\/|mailto:)\S+|\{\{[\s\S]*?(?:\}\}|$)|\[\[[\s\S]*?(?:\]\]|$)|\[[^\]]*(?:\]|$)|(?:^|\n)\s*>[^\n]*/giu;
  for (const match of prose.matchAll(literals)) ranges.push([match.index, match.index + match[0].length]);
  for (const match of prose.matchAll(/(?<![\p{L}\p{M}\p{N}_])'(?:[^']|'(?=[\p{L}\p{M}\p{N}_]))*(?:'|$)/gu)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = new RegExp(`(?<![\\p{L}\\p{N}_/\\\\-])(?:\\d{1,2}[ \\t]+${MONTH}[ \\t]+(?:\\d{4}|\\d{2})|${MONTH}[ \\t]+\\d{1,2},[ \\t]+(?:\\d{4}|\\d{2}))(?![\\p{L}\\p{N}_/\\\\-]|\\.[a-z])`, 'giu');

function finding(ruleId: MechanicalRule, target: MechanicalTarget, label: string, before: string,
  after: string | undefined, sourceText: string, message: string): MechanicalFinding {
  return Object.freeze({ id: `${ruleId}:${target.kind}:${target.index}:${target.start}:${target.end}`,
    ruleId, target: Object.freeze(target), label, before, ...(after === undefined ? {} : { after }), sourceText, message });
}

/** SECNAV M-5216.5 Ch 2 ¶16 distinguishes body dates from the short header
 * date. Audience is an explicit author choice; it is never inferred from a
 * recipient name, document type, or two-digit year. */
export function mechanicalFindings(source: MechanicalSource, section: MechanicalSection,
  audience: BodyDateAudience | null): readonly MechanicalFinding[] {
  if (!supportsMechanicalCorrections(source)) return [];
  const findings: MechanicalFinding[] = [];
  if (section === 'body' && audience) {
    const ruleId = audience === 'military' ? 'body-date-standard' : 'body-date-civilian';
    source.paragraphs.forEach((paragraph, index) => {
      if (paragraph.figure || paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix) return;
      const ranges = protectedRanges(paragraph.text);
      let dateNumber = 0;
      for (const match of paragraph.text.matchAll(DATE)) {
        const start = match.index;
        const end = start + match[0].length;
        if (ranges.some(([from, to]) => start < to && end > from)) continue;
        dateNumber++;
        const before = match[0];
        const after = normalizeBodyDate(before, audience) ?? undefined;
        if (after === before) continue;
        findings.push(finding(ruleId, { kind: 'paragraph-text', index, start, end }, `Paragraph ${index + 1}, date ${dateNumber}`, before,
          after || undefined, paragraph.text, after
            ? `Use ${audience === 'military' ? 'day, full month and four-digit year' : 'full month, day, comma and four-digit year'} for the audience you selected (SECNAV M-5216.5, Ch 2 ¶16).`
            : 'Check this date manually. A valid full year is required; no century or calendar correction is inferred.'));
      }
    });
  }
  if (section === 'references') {
    const config = DOC_TYPE_CONFIG[source.docType];
    if (source.documentMode === 'compliant' && !config.compliance.allowReferences) return [];
    source.references.forEach((reference, index) => {
      // Ch 7 ¶10b requires the NOTAL marker in parentheses. Only an existing
      // terminal marker is normalized; the app does not assign NOTAL status.
      const marker = /\([ \t]*notal[ \t]*\)(?=[ \t]*$)/i.exec(reference.title);
      if (!marker || marker[0] === '(NOTAL)' || protectedRanges(reference.title).some(([from, to]) => marker.index < to
        && marker.index + marker[0].length > from)) return;
      findings.push(finding('reference-notal-marker', { kind: 'reference-title', index, start: marker.index,
        end: marker.index + marker[0].length }, `Reference (${reference.letter}) NOTAL marker`, marker[0], '(NOTAL)',
      reference.title, 'Format this existing marker as (NOTAL), per SECNAV M-5216.5, Ch 7 ¶10b. Its status and source URL stay the same.'));
    });
  }
  return Object.freeze(findings);
}
