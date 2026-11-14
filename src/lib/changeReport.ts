import type { SerializedSession } from '@/stores/documentStore';
import { DOCUMENT_FIELD_POLICIES, type FieldRule } from './documentFieldPolicies';
import { compareSessions, type SessionChange } from './sessionDiff';
import { reviewCommentsSchema } from './reviewComments';
import { describeCommentAnchor } from './reviewCommentTargets';
import { parseFormInstance, type AnswerField, type Answer } from '@/services/forms/model';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { CLASSIFICATION_LABELS, classificationBannerLevel, detectClassification } from './detectClassification';
import type { ClassificationLevel } from './domainClassification';
import { classificationRank, deriveOverallClassLevel } from './overallClassification';
import { detectTextPII, type PIIDetectionResult } from '@/services/pii/detector';

export interface ReportVersion { label: string; title: string; session: SerializedSession }
interface ReportDiscussion { target: string; status: string; context?: string; current?: string; messages: { author: string; text: string }[] }
export interface ChangeReport {
  before: { label: string; title: string; discussions: ReportDiscussion[] };
  after: { label: string; title: string; discussions: ReportDiscussion[] };
  changes: SessionChange[];
  capturedAt: string;
  filename: string;
  privacy: PIIDetectionResult;
  notices: string[];
  marking: string;
  customMarkings: string[];
}

/** Keep policy-declared record identities and binary data out of a review artifact.
 * User-entered identifier answers remain text, even when they look like UUIDs. */
function reportFields(value: unknown, rule?: FieldRule): unknown {
  if (value === undefined || value === null) return value;
  if (rule === 'identity' || rule === 'binary') return undefined;
  if (rule === 'form') {
    const form = parseFormInstance(value);
    const answer = (value: Answer, field?: AnswerField) => {
      if (!field?.options) return value;
      const display = (id: string) => field.options!.find(option => option.id === id)?.label ?? id;
      return Array.isArray(value) ? value.map(display).join('\n') : typeof value === 'string' ? display(value) : value;
    };
    const displayKey = (key: string, definitions: Record<string, unknown>, values: object, kind: string, label?: string) => {
      const index = Object.keys(definitions).indexOf(key);
      if (index >= 0) return `${kind} ${index + 1}: ${label}`;
      const unknown = Object.keys(values).filter(key => !Object.hasOwn(definitions, key)).sort();
      return `Unrecognized ${kind.toLowerCase()} ${unknown.indexOf(key) + 1}`;
    };
    const answers = (values: Record<string, Answer>, fields: Record<string, AnswerField>) => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [displayKey(key, fields, values, 'Field', fields[key]?.label), answer(value, fields[key])]),
    );
    return { form: form.definition.label, definitionRevision: form.definition.definitionRevision,
      templateRevision: form.definition.templateRevision,
      answers: answers(form.answers, form.definition.fields),
      rows: Object.fromEntries(Object.entries(form.rows).map(([key, rows]) => [displayKey(key, form.definition.rowGroups, form.rows, 'Group', form.definition.rowGroups[key]?.title),
        rows.map(row => answers(row.answers, form.definition.rowGroups[key]?.columns ?? {}))])),
    };
  }
  if (rule === 'asset') {
    if (!value || typeof value !== 'object') return undefined;
    const asset = value as Record<string, unknown>;
    return { name: asset.name ?? 'Attached asset', type: asset.type, size: asset.size };
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(child => reportFields(child, rule && typeof rule === 'object' && 'items' in rule ? rule.items : undefined));
  const object = value as Record<string, unknown>;
  const policies = rule && typeof rule === 'object' && 'fields' in rule ? rule.fields : undefined;
  const entries = rule && typeof rule === 'object' && 'entries' in rule ? rule.entries : undefined;
  const variants = rule && typeof rule === 'object' && 'variants' in rule ? rule.variants[String(object.kind)] : undefined;
  return Object.fromEntries(Object.entries(object).flatMap(([key, child]) => {
    if (key === 'timestamp' || key === 'hasFile' || key === 'reviewComments') return [];
    const next = reportFields(child, policies?.[key] ?? entries ?? variants?.[key]);
    return next === undefined ? [] : [[key, next]];
  }));
}

function discussions(session: SerializedSession): ReportDiscussion[] {
  const parsed = reviewCommentsSchema.safeParse(session.reviewComments ?? { version: 1, threads: [] });
  if (!parsed.success) throw new Error('These review comments cannot be read completely. Update DonDocs before downloading a report.');
  return parsed.data.threads.map(thread => {
    const anchor = describeCommentAnchor(session, thread.anchor);
    return { target: anchor.label, status: `${thread.resolved ? 'Resolved' : 'Open'} · ${anchor.status === 'current' ? 'Target current' : anchor.status === 'changed' ? 'Target changed' : 'Target unavailable / detached'}`,
      context: anchor.context, current: anchor.current,
      messages: thread.messages.map(({ author, text }) => ({ author, text })) };
  });
}

function reportSession(session: SerializedSession): SerializedSession {
  const projected = reportFields(session, { fields: DOCUMENT_FIELD_POLICIES }) as SerializedSession;
  if (session.genericForm) projected.formType = parseFormInstance(session.genericForm).definition.label;
  // IDs align the sanitized paragraphs privately; the diff never emits them.
  if (Array.isArray(projected.paragraphs)) projected.paragraphs = projected.paragraphs.map((paragraph, index) => ({ ...paragraph, id: session.paragraphs[index]?.id }));
  return projected;
}

export function reportText(report: Pick<ChangeReport, 'before' | 'after' | 'changes'> & { customMarkings?: string[] }): { field: string; value: string }[] {
  return [report.before, report.after].flatMap(version => [
    { field: 'Version label', value: version.label }, { field: 'Document title', value: version.title },
    ...version.discussions.flatMap(thread => [thread.target, thread.status, thread.context ?? '', thread.current ?? '',
      ...thread.messages.flatMap(message => [message.author, message.text])].map(value => ({ field: `${version.label} discussion`, value }))),
  ]).concat(report.changes.flatMap(change => [change.field, change.before, change.after].map(value => ({ field: change.field, value }))),
    (report.customMarkings ?? []).map(value => ({ field: 'Retained custom source marking', value })));
}

/** Everything used after the asynchronous policy read belongs to this captured pair. */
export function captureChangeReport(before: ReportVersion, after: ReportVersion, capturedAt: string) {
  return structuredClone({ before, after, capturedAt });
}

export function prepareChangeReport(capture: ReturnType<typeof captureChangeReport>, policy: PolicyResolution): ChangeReport {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const { before, after, capturedAt } = capture;
  const comparison = compareSessions(reportSession(before.session), reportSession(after.session));
  const report = {
    customMarkings: [] as string[],
    before: { label: before.label, title: before.title, discussions: discussions(before.session) },
    after: { label: after.label, title: after.title, discussions: discussions(after.session) },
    changes: comparison.changes,
  };
  const notices: string[] = [];
  const levels = new Set<string>(['unclassified']);
  // Inspect markings throughout both retained drafts, including inactive fields.
  const inspect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'classLevel' && typeof child === 'string' && child !== 'custom') levels.add(child);
      if (key === 'classLevel' && child === 'custom') {
        const custom = 'customClassification' in value ? value.customClassification : undefined;
        if (typeof custom !== 'string' || !custom.trim()) notices.push('A retained draft selected a custom marking without saved marking text. Review the incomplete marking before sharing.');
      }
      if (key === 'customClassification' && typeof child === 'string' && child.trim()) {
        report.customMarkings.push(child);
        const level = classificationBannerLevel(child);
        if (level) levels.add(level);
        else notices.push('A retained custom marking could not be ranked. Review the report markings before sharing.');
      }
      if (/portion|marking/i.test(key) && typeof child === 'string') levels.add(deriveOverallClassLevel('unclassified', [{ portionMarking: child as 'U' }]));
      inspect(child);
    }
  };
  inspect(before.session);inspect(after.session);
  report.customMarkings = [...new Set(report.customMarkings)];
  const fields = reportText(report);
  for (const { value } of fields) {
    levels.add(detectClassification(value).classLevel);
    for (const match of value.matchAll(/^\s*(?:Figure marking:\s*)?\((U|CUI|FOUO|C|S|TS)\)/gm)) {
      levels.add(deriveOverallClassLevel('unclassified', [{ portionMarking: match[1] as 'U' }]));
    }
  }
  for (const level of levels) {
    if (classificationRank(level) === undefined || !policy.policy.allowedLevels.includes(level as ClassificationLevel)) {
      throw new Error('This report includes retained markings outside this deployment’s configured levels.');
    }
  }
  const recognized = CLASSIFICATION_LABELS[[...levels].sort((a, b) => classificationRank(b)! - classificationRank(a)!)[0] as ClassificationLevel];
  const marking = notices.length ? `MARKING REVIEW REQUIRED (highest recognized marking: ${recognized})` : recognized;
  const stamp = new Date(capturedAt).toISOString().replace(/[:.]/g, '-');
  return { ...report, capturedAt, filename: `change-report-${stamp}.html`, privacy: detectTextPII(fields), notices: [...new Set([...comparison.notices, ...notices])], marking };
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const text = (value: string) => `<pre>${escape(value || '(Empty)')}</pre>`;

export function renderChangeReport(report: ChangeReport): string {
  const summary = report.changes.some(change => change.kind)
    ? `${report.changes.length} comparison ${report.changes.length === 1 ? 'item' : 'items'}.`
    : `${report.changes.length} changed fields.`;
  const discussion = (version: ChangeReport['before']) => `<section><h2>Discussions — ${escape(version.label)}</h2>${version.discussions.length ? version.discussions.map((thread, index) => `<article><h3>Thread ${index + 1}: ${escape(thread.target)}</h3><p>${escape(thread.status)}</p>${thread.context === undefined ? '' : `<h4>When commented (retained context)</h4>${text(thread.context)}`}${thread.current === undefined ? '' : `<h4>Target in this version</h4>${text(thread.current)}`}${thread.messages.map((message, i) => `<h4>${i ? 'Reply' : 'Comment'} by ${escape(message.author)}</h4>${text(message.text)}`).join('')}</article>`).join('') : '<p>No comments.</p>'}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>DonDocs change report</title><style>
body{font:16px/1.5 system-ui,sans-serif;color:#17202a;background:white;margin:2rem auto;padding:0 1rem;max-width:70rem}h1,h2,h3,h4{line-height:1.3}article{border:1px solid #999;padding:1rem;margin:1rem 0;break-inside:auto}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:.4rem 0 1rem}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.pair>div{min-width:0}.notice{border-left:4px solid #555;padding-left:1rem}header p{overflow-wrap:anywhere}@media(max-width:640px){.pair{grid-template-columns:1fr}body{margin:1rem auto}}@media print{body{max-width:none;margin:0;font-size:10pt}h2,h3,h4{break-after:avoid}}
</style></head><body><header><p><strong>${escape(report.marking)} — REVIEW DERIVATIVE</strong></p>${report.customMarkings.length ? `<h2>Retained custom source markings</h2>${report.customMarkings.map(text).join('')}` : ''}<h1>Change report</h1><p class="notice">For review only. This is a derivative of captured drafts, not an official clean letter, approval record, or audit proof.</p><p>Before: ${escape(report.before.label)} — ${escape(report.before.title)}<br>After: ${escape(report.after.label)} — ${escape(report.after.title)}<br>Report captured: ${escape(report.capturedAt)}</p></header>
<p>Complete before/after values for the compared fields and complete readable discussions from both captured versions are included. Paragraphs with shared stable identities are compared across positions; movement is separate from text changes and automatic renumbering. Missing or unrelated paragraph identities use an explicitly noted positional comparison. Other repeated rows remain positional. Internal record identities and save metadata are omitted. Attached file and image contents are not reproduced or compared; only available names and properties are reported. Configured forms compare answer values, displayed choices, and definition/template revision labels; template PDF contents, placement rules, and full definition changes are outside this report.</p>
${report.notices.map(notice => `<p class="notice">${escape(notice)}</p>`).join('')}<section><h2>Field and body changes</h2><p>${summary}</p>${report.changes.length ? report.changes.map(change => `<article><h3>${escape(change.field)}</h3><div class="pair"><div><h4>Before</h4>${text(change.before)}</div><div><h4>After</h4>${text(change.after)}</div></div></article>`).join('') : '<p>No field or body differences in the report scope. Review the discussions below for their captured state.</p>'}</section>${discussion(report.before)}${discussion(report.after)}<footer><p>${escape(report.marking)} — Review derivative. Handle this report according to its contents and retained context.</p></footer></body></html>`;
}

export function downloadChangeReport(report: ChangeReport): void {
  const url = URL.createObjectURL(new Blob([renderChangeReport(report)], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  let delivered = false;
  try {
    anchor.href = url;anchor.download = report.filename;document.body.appendChild(anchor);anchor.click();delivered = true;
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally { anchor.remove();if (!delivered) URL.revokeObjectURL(url); }
}
