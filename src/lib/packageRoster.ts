import { prepareConditionalPackage, applyPreparedConditionalPackage, copyPreparedConditionalPackageRecord, type PreparedConditionalPackage } from './packageConditional';
import { validatePackageTemplate, type TemplateAttachment } from './packageTemplateLibrary';
import { packageTemplateV2Schema, type PackageTemplateV2 } from './packageTemplateSchema';
import { packageTemplateAnswersSchema, type PackageTemplateAnswers } from './packageTemplateProgram';
import { packageRosterSchema, validatePackageRoster, packageRosterSourceFingerprint, packageRosterCreatedFingerprint,
  MAX_PACKAGE_ROSTER_BYTES, MAX_PACKAGE_ROSTER_ROWS, type PackageRoster, type PackageRosterRow } from './packageRosterModel';
import { idbReadPackageRosters, idbReadPackageRoster, idbComparePackageRoster } from './documentsDb';
import { newPackageId, listActionPackages, type ActionPackage } from './actionPackages';
import { portableResourceDigest } from './portableResources';
import { packageTemplateMaintenancePolicy } from './packageTemplateMaintenance';
import { reviewPackageText, reviewPackageOriginal } from './actionPackageDisclosure';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import { mappedRosterRows, type RosterSelection } from './excelRoster';
import { reviewConditionalTemplate } from './packageConditionalSources';

export interface PackageRosterInputRow { number: number; name: string; answers: PackageTemplateAnswers; attachments?: Record<string, TemplateAttachment>; warnings?: string[] }
export interface PreparedPackageRoster {
  readonly name: string; readonly ready: boolean; readonly resuming: boolean; readonly issues: readonly string[]; readonly reviews: readonly ExportReview[];
  readonly rows: readonly { id: string; number: number; name: string; status: PackageRosterRow['status']; ready: boolean; issues: readonly string[];
    warnings: readonly string[]; preview?: PreparedConditionalPackage }[];
}
interface Capture { job: PackageRoster; policy: string; rows: Map<string, PreparedConditionalPackage>; running: Set<string>; saved: boolean }
const plans = new WeakMap<PreparedPackageRoster, Capture>();
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const clone = <T>(value: T): T => structuredClone(value);
function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(rawText).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => [key, rawText(child)]).join('\n');
  return '';
}
function check(signal?: AbortSignal, isCurrent: () => boolean = () => true) { signal?.throwIfAborted(); if (!isCurrent()) throw new Error('This roster operation is no longer current.'); }

export async function listPackageRosters(): Promise<PackageRoster[]> { return Promise.all((await idbReadPackageRosters()).map(validatePackageRoster)); }

/** Existing Excel parsing owns numeric/date provenance. Each participant JSON entry receives a new identity. */
export function packageRosterRowsFromWorksheet(template: PackageTemplateV2, selection: RosterSelection, columns: Readonly<Record<string, number>>): PackageRosterInputRow[] {
  const known = ['name', ...template.program.questions.filter(question => !question.groupId).map(question => `question:${question.id}`), ...template.program.participantGroups.map(group => `group:${group.id}`)];
  if (Object.entries(columns).some(([key, index]) => !known.includes(key) || !Number.isInteger(index) || index < 0 || index >= selection.roster.columnCount)) throw new Error('Choose valid source columns for this template.');
  if (columns.name === undefined) throw new Error('Map the action name column.');
  // Ask the existing parser about each mapping so a reused source column keeps each field's provenance.
  const warnings = Object.entries(columns).map(([key, index]) => mappedRosterRows(selection, { [index]: key }, [key], {
    identifierFields: new Set(template.program.questions.filter(question => question.kind === 'identifier').map(question => `question:${question.id}`)),
  }));
  const rawRows = selection.roster.rows.filter(row => selection.headerRow === null || row.number > selection.headerRow);
  if (!rawRows.length || rawRows.length > MAX_PACKAGE_ROSTER_ROWS) throw new Error('Use one to 25 action rows. Split larger rosters before creating packages.');
  return rawRows.map((row, index) => {
    const answers: PackageTemplateAnswers = { version: 1, values: {}, groups: {} };
    const cell = (key: string) => columns[key] === undefined ? '' : row.cells[columns[key]]?.value.trim() ?? '';
    for (const question of template.program.questions) if (!question.groupId) {
      const value = cell(`question:${question.id}`); if (!value) continue;
      answers.values[question.id] = question.kind === 'boolean' && /^(?:true|false|yes|no)$/i.test(value) ? /^(?:true|yes)$/i.test(value) : value;
    }
    for (const group of template.program.participantGroups) {
      const value = cell(`group:${group.id}`); if (!value) { answers.groups[group.id] = []; continue; }
      let people: unknown; try { people = JSON.parse(value); } catch { throw new Error(`Worksheet row ${row.number}: ${group.label} needs a JSON list of {label, answers} people.`); }
      if (!Array.isArray(people) || people.length > group.max || people.some(person => !person || typeof person !== 'object'
        || Object.keys(person).some(key => !['label', 'answers'].includes(key)) || typeof person.label !== 'string' || !person.answers || typeof person.answers !== 'object' || Array.isArray(person.answers)))
        throw new Error(`Worksheet row ${row.number}: ${group.label} needs supported fresh participant answers.`);
      answers.groups[group.id] = people.map(person => ({ id: newPackageId('participant'), label: person.label, answers: clone(person.answers) }));
    }
    return { number: row.number, name: cell('name'), answers: packageTemplateAnswersSchema.parse(answers),
      warnings: warnings.flatMap(mapped => mapped[index].warnings.map(warning => warning.message)), attachments: {} };
  });
}
async function prepareCaptured(job: PackageRoster, policy: PolicyResolution, saved: boolean, signal?: AbortSignal): Promise<PreparedPackageRoster> {
  const key = packageTemplateMaintenancePolicy(policy), issues: string[] = [], rows: PreparedPackageRoster['rows'][number][] = [], captured = new Map<string, PreparedConditionalPackage>();
  const reviews: ExportReview[] = [reviewPackageText(rawText({ name: job.name, rows: job.rows }), 'All roster rows, inactive answers, warnings and file labels', policy),
    ...await reviewConditionalTemplate(job.template, policy)];
  const sourceBytes = new TextEncoder().encode(JSON.stringify(job.template)).byteLength;
  if (sourceBytes * job.rows.filter(row => row.status !== 'created').length > MAX_PACKAGE_ROSTER_BYTES) throw new Error('Repeated exact template captures exceed the 64 MB creation budget. Use fewer action rows.');
  let stagedBytes = 0;
  for (const row of job.rows) {
    check(signal);
    // Created rows remain part of the retained journal, so their original supplied files still need review.
    for (const file of Object.values(row.attachments)) reviews.push(await reviewPackageOriginal(file.data, file.name, policy));
    if (row.status === 'created') {
      let error = '';
      try { const existing = (await listActionPackages()).find(record => record.id === row.packageId);
        if (!existing || await packageRosterCreatedFingerprint(existing, row.receipt!.revisionId, row.name) !== row.receipt!.contentSha256) error = 'The created action is missing or its initial capture cannot be verified. It will not be recreated automatically.';
      } catch (cause) { error = cause instanceof Error ? cause.message : 'The created action could not be inspected.'; }
      rows.push({ id: row.id, number: row.number, name: row.name, status: row.status, ready: !error, issues: error ? [error] : [], warnings: row.warnings }); continue;
    }
    try {
      if (!row.name.trim()) throw new Error('Enter a distinct action name for this row.');
      const prepared = await prepareConditionalPackage({ template: job.template, name: row.name, answers: row.answers, attachments: row.attachments, newPackageId: row.packageId }, policy, signal);
      if (prepared.ready) { stagedBytes += copyPreparedConditionalPackageRecord(prepared).stagedBytes; if (stagedBytes > MAX_PACKAGE_ROSTER_BYTES) throw new Error('Prepared action files exceed the combined 64 MB creation budget. Use fewer rows.'); captured.set(row.id, prepared); }
      rows.push({ id: row.id, number: row.number, name: row.name, status: row.status, ready: prepared.ready, issues: [...prepared.issues], warnings: row.warnings,
        preview: clone(prepared) }); reviews.push(...prepared.reviews);
    } catch (cause) { signal?.throwIfAborted(); rows.push({ id: row.id, number: row.number, name: row.name, status: row.status, ready: false, issues: [cause instanceof Error ? cause.message : 'This action row could not be prepared.'], warnings: row.warnings }); }
  }
  check(signal);
  const result = freeze({ name: job.name, ready: rows.every(row => row.ready), resuming: saved, issues, rows, reviews });
  plans.set(result, { job, policy: key, rows: captured, running: new Set(), saved }); return result;
}
/** Captures independent inputs before any await. No existing action or prior person's answers are accepted. */
export async function preparePackageRoster(templateInput: PackageTemplateV2, name: string, rowsInput: readonly PackageRosterInputRow[], policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageRoster> {
  check(signal); packageTemplateMaintenancePolicy(policy);
  if (!rowsInput.length || rowsInput.length > MAX_PACKAGE_ROSTER_ROWS) throw new Error('Use one to 25 action rows.');
  const declaredBytes = rowsInput.reduce((sum, row) => sum + Object.values(row.attachments ?? {}).reduce((total, file) => total + file.data.byteLength, 0), 0);
  if (declaredBytes > MAX_PACKAGE_ROSTER_BYTES) throw new Error('Per-row PDF files exceed the combined 64 MB limit.');
  const input = clone({ template: templateInput, name, rows: rowsInput }), template = packageTemplateV2Schema.parse(await validatePackageTemplate(input.template));
  const now = Date.now(), rows: PackageRosterRow[] = [];
  for (const row of input.rows) {
    const attachments: PackageRosterRow['attachments'] = {};
    for (const [key, file] of Object.entries(row.attachments ?? {})) attachments[key] = { ...file, sha256: await portableResourceDigest(file.data) };
    rows.push({ id: newPackageId('roster-row'), number: row.number, name: row.name.trim(), packageId: newPackageId('package'), answers: row.answers,
      attachments, warnings: row.warnings ?? [], status: 'pending' });
  }
  const job = packageRosterSchema.parse({ version: 1, id: crypto.randomUUID(), name: input.name, createdAt: now, updatedAt: now, sequence: 0, template, rows, sourceSha256: '0'.repeat(64) });
  job.sourceSha256 = await packageRosterSourceFingerprint(job); return prepareCaptured(job, policy, false, signal);
}
export async function prepareSavedPackageRoster(input: PackageRoster, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageRoster> {
  const captured = clone(input); check(signal); const job = await validatePackageRoster(captured); await validatePackageTemplate(job.template);
  return prepareCaptured(job, policy, true, signal);
}
async function currentGuard(key: string, policy: PolicyResolution, signal: AbortSignal | undefined, isCurrent: () => boolean) {
  if (packageTemplateMaintenancePolicy(policy) !== key || packageTemplateMaintenancePolicy(await getExportDeploymentPolicy()) !== key) throw new Error('Deployment settings changed. Prepare and review these roster inputs again.');
  check(signal, isCurrent); return () => { check(signal, isCurrent); return packageTemplateMaintenancePolicy(getExportDeploymentPolicySync()) === key; };
}
export async function savePreparedPackageRoster(prepared: PreparedPackageRoster, policy: PolicyResolution, reviewed: boolean, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<PackageRoster> {
  const captured = plans.get(prepared); if (!captured || captured.saved || !prepared.ready || reviewed !== true) throw new Error('Resolve every row and review the exact roster inputs before saving the local journal.');
  const current = await currentGuard(captured.policy, policy, signal, isCurrent);
  if (!await idbComparePackageRoster(null, captured.job, current)) throw new Error('The roster journal could not be saved. Existing packages are unchanged.');
  captured.saved = true; return clone(captured.job);
}
/** Every created package and its row receipt share one transaction. Other completed rows never supply this row's authority. */
export async function createPreparedPackageRosterRow(prepared: PreparedPackageRoster, rowId: string, policy: PolicyResolution, reviewed: boolean, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<{ record: ActionPackage; roster: PackageRoster }> {
  const captured = plans.get(prepared), rowPlan = captured?.rows.get(rowId);
  if (!captured?.saved || !rowPlan || reviewed !== true || captured.running.has(rowId)) throw new Error('Review this exact prepared action row before creating it.');
  captured.running.add(rowId);
  let latest: PackageRoster | undefined, current: (() => boolean) | undefined;
  try {
    current = await currentGuard(captured.policy, policy, signal, isCurrent);
    latest = await validatePackageRoster(await idbReadPackageRoster(captured.job.id));
    const row = latest.rows.find(item => item.id === rowId);
    if (latest.sourceSha256 !== captured.job.sourceSha256 || !row || row.status === 'created') throw new Error('The roster row changed or is already created. Refresh its saved state.');
    const { record } = copyPreparedConditionalPackageRecord(rowPlan), next = clone(latest), destination = next.rows.find(item => item.id === rowId)!;
    destination.status = 'created'; delete destination.error; destination.receipt = { revisionId: record.currentRevisionId,
      contentSha256: await packageRosterCreatedFingerprint(record, record.currentRevisionId, row.name), policySha256: await portableResourceDigest(new TextEncoder().encode(captured.policy).buffer), createdAt: Date.now() };
    next.sequence++; next.updatedAt = Date.now();
    const saved = (await applyPreparedConditionalPackage(rowPlan, policy, true, signal, current, { before: latest, after: packageRosterSchema.parse(next), rowId })).record;
    captured.rows.delete(rowId); return { record: saved, roster: next };
  } catch (cause) {
    if (latest && current && !signal?.aborted) {
      try { if (current()) { const failed = clone(latest), row = failed.rows.find(item => item.id === rowId);
        if (row && row.status !== 'created') { row.status = 'failed'; row.error = (cause instanceof Error ? cause.message : 'The action could not be created.').slice(0, 500) || 'The action could not be created.'; failed.sequence++; failed.updatedAt = Date.now(); await idbComparePackageRoster(latest, failed, current); }
      } } catch { /* A newer journal or lost owner remains authoritative. */ }
    }
    throw cause;
  } finally { captured.running.delete(rowId); }
}
export async function removePackageRoster(expected: PackageRoster, isCurrent: () => boolean = () => true): Promise<void> {
  if (!await idbComparePackageRoster(expected, null, isCurrent)) throw new Error('The roster journal changed. Refresh before removing it.');
}
export async function readCreatedPackageRosterRow(input: PackageRoster, rowId: string): Promise<ActionPackage> {
  const job = await validatePackageRoster(input), row = job.rows.find(item => item.id === rowId);
  if (!row?.receipt || row.status !== 'created') throw new Error('This roster row has no created action.');
  const record = (await listActionPackages()).find(item => item.id === row.packageId);
  if (!record || await packageRosterCreatedFingerprint(record, row.receipt.revisionId, row.name) !== row.receipt.contentSha256)
    throw new Error('The created action or its exact initial revision is unavailable. It will not be recreated automatically.');
  return record;
}
