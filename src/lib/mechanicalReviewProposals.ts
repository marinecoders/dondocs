import type { BodyDateAudience, MechanicalFinding } from './mechanicalCorrections';
import { mechanicalFindings, supportsMechanicalCorrections } from './mechanicalCorrections';
import { formattingFindings } from './formattingFindings';
import type { ReviewRound } from './reviewRounds';
import { createReviewSuggestion, suggestionTargetKey, suggestionTargetValue,
  REVIEW_SUGGESTION_LIMITS, type ReviewSuggestion, type ReviewSuggestionTarget } from './reviewSuggestions';

export const MAX_MECHANICAL_REVIEW_FINDINGS = 200;

export interface MechanicalReviewCandidate {
  readonly id: string;
  readonly label: string;
  readonly rule: string;
  readonly source: 'field' | 'body' | 'references';
  readonly target: ReviewSuggestionTarget;
  readonly before: string;
  readonly after?: string;
  readonly sourceText: string;
  readonly message: string;
  readonly range?: { readonly start: number; readonly end: number };
}

/** Reuse the shipped checks against the exact reviewed baseline, not live edits. */
export function mechanicalReviewCandidates(round: ReviewRound, bodyAudience: BodyDateAudience | null): readonly MechanicalReviewCandidate[] {
  const session = round.baseline.session;
  const source = { ...session, documentCategory: session.documentCategory ?? 'correspondence' as const };
  if (!supportsMechanicalCorrections(source)) return [];
  const candidates: MechanicalReviewCandidate[] = [];
  for (const section of ['addressing', 'executive', 'signature']) for (const finding of formattingFindings(source, section)) {
    const target = { kind: 'field' as const, field: finding.field, docType: session.docType };
    if (!suggestionTargetValue(session, target)) continue;
    candidates.push({ id: `field:${finding.field}`, label: finding.label,
      rule: finding.field === 'date' ? 'header-date-format' : 'signature-initial-spacing', source: 'field', target,
      before: finding.before, ...(finding.after === undefined ? {} : { after: finding.after }), sourceText: finding.before, message: finding.message });
  }
  const addSpan = (finding: MechanicalFinding, section: 'body' | 'references') => {
    const paragraph = section === 'body' ? session.paragraphs[finding.target.index] : undefined;
    const target: ReviewSuggestionTarget = section === 'body'
      ? { kind: 'paragraph', paragraphId: paragraph?.id ?? '', docType: session.docType }
      : { kind: 'reference-title', referenceIndex: finding.target.index, docType: session.docType };
    if (!suggestionTargetValue(session, target)) return;
    candidates.push({ id: `${section}:${finding.id}`, label: finding.label, rule: finding.ruleId, source: section, target,
      before: finding.before, ...(finding.after === undefined ? {} : { after: finding.after }), sourceText: finding.sourceText,
      message: finding.message, range: { start: finding.target.start, end: finding.target.end } });
  };
  for (const finding of mechanicalFindings(source, 'body', bodyAudience)) addSpan(finding, 'body');
  for (const finding of mechanicalFindings(source, 'references', null)) addSpan(finding, 'references');
  if (candidates.length > MAX_MECHANICAL_REVIEW_FINDINGS) throw new Error('This baseline has too many formatting findings for one review. Use the existing formatting tools or start a smaller review.');
  return candidates;
}

/** Combine selected spans per stable paragraph so acceptance remains one atomic group. */
export function createMechanicalReviewProposal(round: ReviewRound, input: {
  author: string;
  bodyAudience: BodyDateAudience | null;
  selectedIds: readonly string[];
}): ReviewSuggestion {
  if (!input.selectedIds.length || input.selectedIds.length > MAX_MECHANICAL_REVIEW_FINDINGS
    || new Set(input.selectedIds).size !== input.selectedIds.length) throw new Error('Choose distinct formatting corrections to propose.');
  const candidates = mechanicalReviewCandidates(round, input.bodyAudience);
  const selected = input.selectedIds.map(id => {
    const candidate = candidates.find(item => item.id === id);
    if (!candidate || candidate.after === undefined) throw new Error('A selected correction is unavailable or needs manual review. Review the current audience and selection.');
    return candidate;
  });
  const groups = new Map<string, MechanicalReviewCandidate[]>();
  for (const candidate of selected) {
    const key = suggestionTargetKey(candidate.target);
    groups.set(key, [...groups.get(key) ?? [], candidate]);
  }
  const changes = [...groups.values()].map(group => {
    const first = group[0];
    let proposed = first.sourceText;
    if (!first.range) proposed = first.after!;
    else {
      let previousStart = Infinity;
      for (const candidate of [...group].sort((left, right) => right.range!.start - left.range!.start)) {
        const range = candidate.range;
        if (!range || candidate.sourceText !== first.sourceText || range.end > previousStart
          || first.sourceText.slice(range.start, range.end) !== candidate.before) throw new Error('The selected formatting spans overlap or no longer match the reviewed baseline.');
        proposed = proposed.slice(0, range.start) + candidate.after + proposed.slice(range.end);
        previousStart = range.start;
      }
    }
    return { target: first.target, proposed };
  });
  const audience = selected.some(candidate => candidate.source === 'body')
    ? ` Body date audience: ${input.bodyAudience === 'military' ? 'military' : 'civilian'}.` : '';
  if (changes.length > REVIEW_SUGGESTION_LIMITS.changes) throw new Error('Select corrections from no more than 20 fields, paragraphs or reference titles per proposal.');
  const label = selected.length === 1 ? 'Formatting correction' : `Formatting corrections (${selected.length})`;
  const origin = { kind: 'mechanical' as const, rule: 'native-formatting', context: `Computed from the existing formatting checks.${audience}` };
  let characters = input.author.trim().length + label.length + origin.rule.length + origin.context.length;
  for (const change of changes) {
    const expected = suggestionTargetValue(round.baseline.session, change.target)!.value;
    if (expected.length > REVIEW_SUGGESTION_LIMITS.value || change.proposed.length > REVIEW_SUGGESTION_LIMITS.value) throw new Error('A selected value exceeds the 20,000-character review limit. Use the existing local formatting tools or start a smaller review.');
    characters += expected.length + change.proposed.length;
  }
  if (characters > REVIEW_SUGGESTION_LIMITS.totalCharacters) throw new Error('The selected corrections contain too much text for one proposal. Select a smaller group.');
  return createReviewSuggestion(round, { author: input.author, label, origin, changes });
}
