import { expect, it } from 'vitest';
import { captureChangeReport, prepareChangeReport, renderChangeReport } from '@/lib/changeReport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { getSerializedSession, type SerializedSession } from '@/stores/documentStore';
import { fixtureInstance } from '../_helpers/formFixture';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const allLevels = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: CLASSIFICATION_LEVELS }, runtime: { status: 'absent' } });
const capture = (before = getSerializedSession(), after = getSerializedSession()) => captureChangeReport(
  { label: 'Saved version 2', title: 'Earlier', session: before },
  { label: 'Current captured draft', title: 'Current', session: after }, '2026-11-13T12:00:00.000Z');
function comments(session: SerializedSession, text: string, context = 'Original context') {
  session.reviewComments = { version: 2, threads: [{ id: '11111111-1111-4111-8111-111111111111', resolved: true,
    anchor: { kind: 'paragraph', paragraphId: 'removed-paragraph', context, docType: session.docType },
    messages: [{ id: '22222222-2222-4222-8222-222222222222', author: '<Reviewer & "name">', text, createdAt: '2026-11-12T12:00:00.000Z' }] }] };
}

it('includes complete long Unicode values and discussions, with retained detached context and escaped HTML', () => {
  const before = getSerializedSession();const after = getSerializedSession();
  const long = `${'🪸 café <script>alert(1)</script> & '.repeat(180)}END_OF_FULL_COMMENT`;
  before.paragraphs = [{ id: 'old-identity', text: `Before ${long}`, level: 0 }];
  after.paragraphs = [{ id: 'new-identity', text: 'After', level: 0 }];
  comments(before, long);comments(after, `${long}\nReply context`);
  const report = prepareChangeReport(capture(before, after), policy);
  const html = renderChangeReport(report);
  expect(report.changes.find(change => change.field === 'Paragraphs › 1 › Text')?.before).toBe(`Before ${long}`);
  expect(report.after.discussions[0]).toMatchObject({ context: 'Original context', status: 'Resolved · Target unavailable / detached' });
  expect(html).toContain('END_OF_FULL_COMMENT');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('&lt;Reviewer &amp; &quot;name&quot;&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('old-identity');
  expect(html).not.toContain('11111111-1111');
  expect(html).not.toContain('createdAt');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('script,img,a,iframe,link').length).toBe(0);
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
});

it('scans removed values, resolved comment context and reviewer text even when current output is benign', () => {
  const before = getSerializedSession();const after = getSerializedSession();
  before.formData.subject = 'Removed SSN 123-45-6789';after.formData.subject = 'Benign';
  comments(after, 'SSN 987-65-4321', 'Retained SSN 234-56-7890');
  const report = prepareChangeReport(capture(before, after), policy);
  expect(report.privacy.findings.filter(finding => finding.type === 'SSN').map(finding => finding.value)).toEqual(expect.arrayContaining(['123-45-6789', '987-65-4321', '234-56-7890']));
});

it.each(['source', 'portion', 'context', 'custom'])('blocks disallowed retained %s markings before download', kind => {
  const before = getSerializedSession();const after = getSerializedSession();
  if (kind === 'source') before.formData.classLevel = 'secret';
  if (kind === 'portion') before.paragraphs = [{ text: 'Removed content', level: 0, portionMarking: 'S' }];
  if (kind === 'context') comments(after, 'Current comment', '(S) Retained removed paragraph');
  if (kind === 'custom') { before.formData.classLevel = 'custom';before.formData.customClassification = 'SECRET//TEST'; }
  expect(() => prepareChangeReport(capture(before, after), policy)).toThrow(/outside this deployment/);
  expect(prepareChangeReport(capture(before, after), allLevels).marking).toBe('SECRET');
});

it('preserves the exact captured pair when newer work changes the source', () => {
  const before = getSerializedSession();const after = getSerializedSession();
  before.formData.subject = 'Saved';after.formData.subject = 'Captured';
  const pair = capture(before, after);after.formData.subject = 'Newer work';
  const report = prepareChangeReport(pair, policy);
  expect(report.changes.find(change => change.field.endsWith('Subject'))).toMatchObject({ before: 'Saved', after: 'Captured' });
  expect(after.formData.subject).toBe('Newer work');
  expect(report.filename).toBe('change-report-2026-11-13T12-00-00-000Z.html');
});

it('compares configured form answers by readable labels, keeps user identifiers and omits record/schema metadata', () => {
  const before = getSerializedSession();before.documentCategory = 'forms';before.genericForm = fixtureInstance();
  before.genericForm.answers.name = '11111111-1111-4111-8111-111111111111';
  before.genericForm.rows.roster = [{ id: 'hidden-row-identity', answers: { grade: 'e2', date: '2026-11-12' } }];
  const after = structuredClone(before);after.genericForm!.answers.name = 'Updated';after.genericForm!.rows.roster[0].answers.grade = 'e3';
  const html = renderChangeReport(prepareChangeReport(capture(before, after), policy));
  expect(html).toContain('11111111-1111-4111-8111-111111111111');
  expect(html).not.toContain('hidden-row-identity');expect(html).not.toContain('Schema Version');
  expect(html).not.toContain('Answer Revision');expect(html).toContain('placement rules');
});

it('fails explicitly for unreadable discussions and unavailable policy rather than emitting partial evidence', () => {
  const before = getSerializedSession();before.reviewComments = { version: 3, threads: [] } as never;
  expect(() => prepareChangeReport(capture(before), policy)).toThrow(/cannot be read completely/);
  expect(() => prepareChangeReport(capture(), { status: 'error', message: 'Policy unavailable' })).toThrow('Policy unavailable');
});
