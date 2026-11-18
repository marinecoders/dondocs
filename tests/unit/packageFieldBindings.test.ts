import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSession, type SerializedSession } from '@/stores/documentStore';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { listPackageBindingFields, packageBindingTargetSchema, patchPackageBindingTarget, patchPackageBindingDraftFields,
  resolvePackageBindingTarget, type PackageBindingField } from '@/lib/packageBindingTargets';
import { formatPackageFactForField, packageBindingReadiness, packageFieldBindingsSchema, preservePackageFieldOverride,
  reconnectPackageFieldBinding, resolvePackageFieldBinding, suggestPackageFieldValues, type PackageFieldBinding } from '@/lib/packageFieldBindings';
import { type NativePackageMember, type PackageRevision, createActionPackage, reviseActionPackage, getPackageRevision,
  commitActionPackage, newPackageId, actionPackageSchema, packageAssets, listActionPackages } from '@/lib/actionPackages';
import { type PackageFact, updatePackageInformation } from '@/lib/packageInformation';
import { buildDraftFileFromSnapshot } from '@/lib/draftFile';
import { capturePackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { reviewPackageBindings } from '@/lib/actionPackageDisclosure';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { preparePackageShare } from '@/lib/actionPackageShare';
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { capturePackageBackup, restorePackageBackup, validatePackageBackup } from '@/lib/actionPackageBackup';
import { capturePackageTemplate } from '@/lib/packageTemplateLibrary';
import { packageInputFingerprint } from '@/lib/packageRenderProvenance';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { describeCommentAnchor } from '@/lib/reviewCommentTargets';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const target = { kind: 'correspondence', docType: 'naval_letter', field: 'subject' } as const;
function fact(value: string | boolean = 'Training action', kind: PackageFact['kind'] = 'text'): PackageFact {
  return { id: 'subject', label: 'Subject', kind, value, source: { kind: 'entered' } } as PackageFact;
}
function link(): PackageFieldBinding { return { id: 'link', factId: 'subject', memberId: 'member', target, mode: 'linked', expectedValue: 'Training action', format: 'field' }; }
function session(): SerializedSession { const value = createBlankSession(); value.formData.subject = 'Training action'; return value; }
function member(value = session()): NativePackageMember {
  return { kind: 'native', id: 'member', revisionId: 'member_v1', label: 'Training letter', role: 'basic-letter', required: true,
    draft: { id: 'asset', name: 'letter.dondocs', type: 'application/json', size: 1, sha256: 'a'.repeat(64) }, session: value };
}
function revision(value = session()): PackageRevision {
  return { id: 'revision', createdAt: 100, members: [member(value)], outputs: [], bindings: { version: 1, items: [link()] },
    information: { version: 1, participants: [], facts: [fact()] } };
}
function configured(): SerializedSession { const value = createBlankSession(); value.documentCategory = 'forms'; value.formType = 'fixture'; value.genericForm = fixtureInstance(); return value; }
async function fields(value = configured()): Promise<PackageBindingField[]> { return listPackageBindingFields(member(value)); }
async function stored() {
  const value = session(); value.formData.from = 'Training Office'; value.formData.to = 'Training Officer'; value.formData.unitLine1 = 'FICTIONAL TRAINING UNIT'; value.formData.sigLast = 'Example';
  value.paragraphs = [{ id: 'body', text: 'Synthetic training content.', level: 0 }];
  const captured = await capturePackageMember(captureDocumentRevision({ documentId: 'training', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...value, endItems: [], publicationTables: {} }), 'Training letter', 'basic-letter');
  let record = await reviseActionPackage(await createActionPackage('Training action'), [captured]);
  record = await updatePackageInformation(record, { version: 1, participants: [], facts: [fact()] });
  const current = getPackageRevision(record);
  const next = { ...current, id: newPackageId('revision'), parentId: current.id, outputs: [],
    bindings: { version: 1 as const, items: [{ ...link(), memberId: captured.id }] } };
  const after = { ...record, sequence: record.sequence + 1, revisions: [...record.revisions, next], currentRevisionId: next.id };
  await commitActionPackage(record, after); return after;
}
beforeEach(async () => {
  vi.restoreAllMocks(); await createActionPackage('Initialize');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close(); useUIStore.setState({ storageHealth: 'ok' });
});

describe('qualified native field targets', () => {
  it('exposes supported active headers without signing, body, system or resource fields', async () => {
    const available = await fields(session());
    expect(available.some(field => field.target.kind === 'correspondence' && field.target.field === 'subject')).toBe(true);
    expect(available.map(field => JSON.stringify(field.target)).join(' ')).not.toMatch(/sigLast|signature|paragraph|timestamp|body|File/);
    const custom = session(); custom.docType = 'i_type'; expect(await fields(custom)).toEqual([]);
    custom.docType = 'unrecognized' as SerializedSession['docType']; expect(await fields(custom)).toEqual([]);
    const original = { id: 'original', revisionId: 'v1', label: 'Original', role: 'enclosure' as const, required: true, kind: 'original' as const, signedOriginal: true, original: member().draft };
    expect(await listPackageBindingFields(original)).toEqual([]);
    expect(packageBindingTargetSchema.safeParse({ kind: 'correspondence', docType: 'naval_letter', field: 'sigLast' }).success).toBe(false);
    expect(packageBindingTargetSchema.safeParse({ ...target, path: ['formData', 'subject'] }).success).toBe(false);
  });
  it('exposes only the selected builtin form and leaves inactive fields untouched', async () => {
    const value = createBlankSession('navmc_10274');
    const available = await fields(value); expect(available.length).toBeGreaterThan(0);
    expect(available.every(field => field.target.kind === 'aa-form')).toBe(true);
    expect(available.some(field => /signature/i.test(field.label))).toBe(false);
    const selected = available.find(field => field.target.kind === 'aa-form' && field.target.field === 'actionNo')!;
    const changed = await patchPackageBindingTarget(value, selected.target, selected.value, '00001');
    expect(changed.forms?.navmc10274?.actionNo).toBe('00001'); expect(value.forms?.navmc10274?.actionNo).toBe(selected.value);
    value.formType = 'unknown'; expect(await fields(value)).toEqual([]);
  });
  it('keeps absent answers, leading zeros, false and decimal zero distinct', async () => {
    const value = configured(); value.genericForm!.answers.a = false;
    const available = await fields(value); expect(available.find(field => field.label === 'Name')?.value).toBe('000123');
    expect(available.find(field => field.label === 'A')?.value).toBe(false);
    const blank = available.find(field => field.label === 'B')!; expect(blank.value).toBeNull();
    expect(available.some(field => field.label === 'Signature')).toBe(false);
    const changed = await patchPackageBindingTarget(value, blank.target, null, false); expect(changed.genericForm!.answers.b).toBe(false);
    const decimal: PackageBindingField = { ...available[0], kind: 'decimal' };
    expect(formatPackageFactForField(fact('0', 'decimal'), decimal)).toBe('0');
    expect(formatPackageFactForField(fact('000123', 'identifier'), available[0])).toBe('000123');
    expect(formatPackageFactForField(fact(false, 'boolean'), blank)).toBe(false);
  });
  it('targets stable repeating row IDs after reorder and reports deleted or ambiguous rows', async () => {
    const value = configured(); value.genericForm!.rows.roster = [{ id: 'first', answers: { grade: 'e1' } }, { id: 'second', answers: { grade: 'e2' } }];
    const row = (await fields(value)).find(field => field.target.kind === 'configured-form' && field.target.row?.rowId === 'first' && field.target.fieldId === 'grade')!;
    value.genericForm!.rows.roster.reverse(); const changed = await patchPackageBindingTarget(value, row.target, 'e1', 'e2');
    expect(changed.genericForm!.rows.roster.map(row => row.id)).toEqual(['second', 'first']);
    expect(changed.genericForm!.rows.roster[1].answers.grade).toBe('e2');
    value.genericForm!.rows.roster.pop(); expect((await resolvePackageBindingTarget(value, row.target)).state).toBe('missing');
    value.genericForm!.rows.roster.push({ id: 'second', answers: {} }); expect((await fields(value)).some(field => field.target.kind === 'configured-form' && field.target.row)).toBe(false);
  });
  it('distinguishes identical repeating answers by group and row while retaining exact target identities', async () => {
    const value = configured(); value.genericForm!.rows.roster = [{ id: 'first', answers: { grade: 'e1' } }, { id: 'second', answers: { grade: 'e1' } }];
    const available = await fields(value), rows = available.filter(field => field.target.kind === 'configured-form' && field.target.fieldId === 'grade');
    expect(rows.map(field => field.label)).toEqual(['Roster · row 1 · Grade', 'Roster · row 2 · Grade']);
    expect(available.find(field => field.label === 'Name')).toBeDefined();
    const candidates = (await suggestPackageFieldValues([member(value)])).filter(candidate => candidate.target.kind === 'configured-form' && candidate.target.fieldId === 'grade');
    expect(candidates.map(candidate => candidate.label)).toEqual(['Training letter: Roster · row 1 · Grade', 'Training letter: Roster · row 2 · Grade']);
    expect(candidates.map(candidate => candidate.source.kind === 'document' ? candidate.source.field.split(' [')[0] : '')).toEqual(['Roster · row 1 · Grade', 'Roster · row 2 · Grade']);
    value.genericForm!.rows.roster.reverse();
    const resolved = await resolvePackageBindingTarget(value, rows[0].target);
    expect(resolved).toMatchObject({ state: 'current', field: { target: rows[0].target, label: 'Roster · row 2 · Grade' } });
    const changed = await patchPackageBindingTarget(value, rows[0].target, 'e1', 'e2');
    expect(changed.genericForm!.rows.roster).toEqual([{ id: 'second', answers: { grade: 'e1' } }, { id: 'first', answers: { grade: 'e2' } }]);
    const reordered = (await suggestPackageFieldValues([member(value)])).find(candidate => candidate.target.kind === 'configured-form' && candidate.target.row?.rowId === 'first' && candidate.target.fieldId === 'grade')!;
    expect(reordered.target).toEqual(candidates[0].target);
    if (reordered.source.kind !== 'document' || candidates[0].source.kind !== 'document') throw new Error('Expected captured document sources.');
    expect(reordered.source.field.split(' [')[1]).toBe(candidates[0].source.field.split(' [')[1]);
  });
  it('bounds repeating field labels and keeps their row ordinal visible in sanitized source descriptions', async () => {
    const value = configured(); value.genericForm!.rows.roster = [{ id: 'first', answers: { grade: 'e1' } }, { id: 'second', answers: { grade: 'e1' } }];
    value.genericForm!.definition.rowGroups.roster.title = `\n${'G'.repeat(160)}\u0000`;
    value.genericForm!.definition.rowGroups.roster.columns.grade.label = `\t${'Field'.repeat(80)}\n`;
    const available = (await fields(value)).filter(field => field.target.kind === 'configured-form' && field.target.fieldId === 'grade');
    expect(available.every(field => field.label.length <= 240 && !Array.from(field.label).some(character => character.charCodeAt(0) < 32))).toBe(true);
    expect(available[0].label.slice(0, 80)).toContain('row 1'); expect(available[1].label.slice(0, 80)).toContain('row 2');
    const candidates = (await suggestPackageFieldValues([member(value)])).filter(candidate => candidate.target.kind === 'configured-form' && candidate.target.fieldId === 'grade');
    expect(candidates.every(candidate => candidate.source.kind === 'document' && candidate.source.field.length <= 160)).toBe(true);
  });
  it('pins definition content even if a publisher reuses the revision labels', async () => {
    const value = configured(), selected = (await fields(value))[0];
    value.genericForm!.definition.fields.name.label = 'Changed name';
    expect(await resolvePackageBindingTarget(value, selected.target)).toMatchObject({ state: 'missing', message: expect.stringMatching(/definition changed/) });
    await expect(patchPackageBindingTarget(value, selected.target, selected.value, 'Updated')).rejects.toThrow(/definition changed/);
  });
  it('rejects stale values, duplicate writes, unknown options and invalid dates without mutating input', async () => {
    const value = configured(), before = structuredClone(value), selected = (await fields(value))[0];
    await expect(patchPackageBindingTarget(value, selected.target, 'different', 'New')).rejects.toThrow(/field changed/);
    const choice = (await fields(value)).find(field => field.kind === 'singleChoice')!;
    await expect(patchPackageBindingTarget(value, choice.target, choice.value, 'not-an-option')).rejects.toThrow(/defined by this form/);
    value.genericForm!.rows.roster = [{ id: 'first', answers: {} }];
    const date = (await fields(value)).find(field => field.kind === 'date')!;
    await expect(patchPackageBindingTarget(value, date.target, null, '2027-02-29')).rejects.toThrow(/real date/);
    delete value.genericForm!.rows.roster; expect(value).toEqual(before);
  });
  it('patches multiple configured answers in one owned raw draft and increments once', async () => {
    const value = configured(), available = await fields(value);
    const name = available.find(field => field.label === 'Name')!, flag = available.find(field => field.label === 'A')!;
    const raw = { ...value, kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' };
    const before = structuredClone(raw);
    const changed = await patchPackageBindingDraftFields(raw, [{ target: name.target, expected: '000123', value: '000000' }, { target: flag.target, expected: null, value: false }]);
    expect(changed.session.genericForm!.answers).toMatchObject({ name: '000000', a: false });
    expect(changed.session.genericForm!.answerRevision).toBe(1);
    expect(raw).toEqual(before);
  });
  it('uses ISO dates in configured answers without relying on timezone conversion', async () => {
    const value = configured(); value.genericForm!.rows.roster = [{ id: 'first', answers: {} }];
    const date = (await fields(value)).find(field => field.kind === 'date')!;
    expect(formatPackageFactForField(fact('2028-02-29', 'date'), date)).toBe('2028-02-29');
    const changed = await patchPackageBindingTarget(value, date.target, null, '2028-02-29');
    expect(changed.genericForm!.rows.roster[0].answers.date).toBe('2028-02-29');
    expect(value.genericForm!.rows.roster[0].answers.date).toBeUndefined();
  });
  it('formats dates using the established abbreviated convention and rejects century loss', async () => {
    const selected = (await fields(session())).find(field => field.kind === 'date')!;
    expect(formatPackageFactForField(fact('2028-02-29', 'date'), selected)).toBe('29 Feb 28');
    expect(() => formatPackageFactForField(fact('2100-01-01', 'date'), selected)).toThrow(/2000/);
    expect(() => formatPackageFactForField(fact('1900-01-01', 'date'), selected)).toThrow(/2000/);
    expect(() => formatPackageFactForField(fact('2027-02-29', 'date'), selected)).toThrow();
    expect(() => formatPackageFactForField(fact('not a date'), selected)).toThrow(/wrong kind/);
    expect(formatPackageFactForField(fact('training'), { ...selected, kind: 'text' }, 'uppercase')).toBe('TRAINING');
    expect(() => formatPackageFactForField(fact(false, 'boolean'), selected)).toThrow(/yes\/no/);
  });
  it('patches raw drafts once while retaining original attachment bytes and unrelated anchors', async () => {
    const value = session(), page = await fixturePage();
    value.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'field', field: 'subject', docType: 'naval_letter', context: 'Training action' }, resolved: false, messages: [{ id: crypto.randomUUID(), author: 'Reviewer', text: 'Review subject', createdAt: '2026-11-13T00:00:00Z' }] }] };
    const snapshot = { ...value, endItems: [], publicationTables: {}, paragraphs: [{ id: 'body', text: 'Keep this exact paragraph and identity.', level: 0 }],
      enclosures: [{ id: 'enclosure', title: 'Original enclosure', text: 'Original enclosure', file: { name: 'original.pdf', size: page.bytes.byteLength, data: page.bytes.buffer as ArrayBuffer } }] };
    const draft = await buildDraftFileFromSnapshot(snapshot, 100), before = structuredClone(draft);
    const result = await patchPackageBindingDraftFields(draft, [{ target, expected: 'Training action', value: 'Updated subject' },
      { target: { kind: 'correspondence', docType: 'naval_letter', field: 'from' }, expected: value.formData.from!, value: 'Updated office' }]);
    const raw = result.draft;
    expect(raw.enclosures).toEqual((before as Record<string, unknown>).enclosures); expect(raw.paragraphs).toEqual(snapshot.paragraphs);
    expect(result.session.formData.subject).toBe('Updated subject'); expect(draft).toEqual(before);
    expect(result.session.reviewComments).toEqual(value.reviewComments);
    expect(describeCommentAnchor(result.session, result.session.reviewComments!.threads[0].anchor).status).toBe('changed');
    await expect(patchPackageBindingDraftFields(draft, [{ target, expected: 'Training action', value: 'A' }, { target, expected: 'Training action', value: 'B' }])).rejects.toThrow(/same field twice/);
  });
});

describe('explicit link state and bounded provenance', () => {
  it('requires both last applied and desired values before reporting synchronization', async () => {
    const value = revision(); expect((await resolvePackageFieldBinding(value, link())).state).toBe('current');
    value.information!.facts[0].value = 'Updated package'; expect((await resolvePackageFieldBinding(value, link())).state).toBe('changed');
    value.information!.facts[0].value = 'Training action'; value.members[0] = member({ ...session(), formData: { ...session().formData, subject: 'Local value' } });
    expect((await resolvePackageFieldBinding(value, link())).message).toMatch(/locally/);
    expect((await resolvePackageFieldBinding(value, preservePackageFieldOverride(link(), 'Local value'))).state).toBe('override');
    expect((await resolvePackageFieldBinding(value, reconnectPackageFieldBinding(link(), 'Local value'))).state).toBe('changed');
    expect(link().mode).toBe('linked');
  });
  it('reports missing and incompatible targets and facts even for overrides', async () => {
    const value = revision(); value.information!.facts = []; expect((await resolvePackageFieldBinding(value, preservePackageFieldOverride(link(), 'Training action'))).state).toBe('missing');
    value.members = []; expect((await packageBindingReadiness(value))[0].message).toMatch(/missing/);
    const incompatible = revision(); incompatible.information!.facts = [fact(false, 'boolean')]; expect((await resolvePackageFieldBinding(incompatible, link())).state).toBe('unsupported');
  });
  it('retains every competing suggestion with exact source identities and bounded descriptive provenance', async () => {
    const first = member(configured()); first.id = 'm'.repeat(100); first.revisionId = 'r'.repeat(100); first.label = 'L'.repeat(120);
    first.session.genericForm!.definition.fields.name.label = 'F'.repeat(160); first.session.genericForm!.answers.a = false;
    const second = member(configured()); second.id = 'second'; second.session.genericForm!.answers.name = '000999';
    const candidates = await suggestPackageFieldValues([first, second]);
    const names = candidates.filter(value => value.target.kind === 'configured-form' && value.target.fieldId === 'name');
    expect(names.map(value => value.value)).toEqual(['000123', '000999']);
    expect(names[0]).toMatchObject({ memberId: first.id, memberRevisionId: first.revisionId, source: { kind: 'document', label: first.label, sha256: first.draft.sha256 } });
    expect(names[0].source.kind === 'document' && names[0].source.field.length).toBeLessThanOrEqual(160);
    expect(candidates.some(value => value.value === false)).toBe(true);
    expect(JSON.stringify(candidates)).not.toMatch(/base64|signature|portableResources|asset-name/);
  });
  it('sanitizes captured provenance labels without losing exact source identity', async () => {
    const value = member(configured()); value.label = 'Training\nmember\u0000';
    value.session.genericForm!.definition.fields.name.label = '\nName\u0000';
    const candidates = await suggestPackageFieldValues([value]);
    expect(candidates.find(candidate => candidate.value === '000123')).toMatchObject({ memberId: value.id, memberRevisionId: value.revisionId, source: { label: 'Training member' } });
    value.label = '\n\u0000';
    expect((await suggestPackageFieldValues([value]))[0].source).toMatchObject({ label: 'Package member' });
  });
  it('does not propose unfinished answers that cannot satisfy the typed fact contract', async () => {
    const value = member(configured()); value.session.genericForm!.answers.name = '0'.repeat(201);
    expect((await suggestPackageFieldValues([value])).some(candidate => candidate.target.kind === 'configured-form' && candidate.target.fieldId === 'name')).toBe(false);
  });
  it('rejects duplicate identities, competing targets, reserved keys and oversized retained metadata', () => {
    expect(() => packageFieldBindingsSchema.parse({ version: 1, items: [link(), link()] })).toThrow(/duplicate/);
    expect(() => packageFieldBindingsSchema.parse({ version: 1, items: [link(), { ...link(), id: 'other' }] })).toThrow(/competing/);
    expect(() => packageFieldBindingsSchema.parse({ version: 1, items: [{ ...link(), id: 'prototype' }] })).toThrow(/Reserved/);
    expect(() => packageFieldBindingsSchema.parse({ version: 1, items: Array.from({ length: 30 }, (_, i) => ({ ...link(), id: `id_${i}`, memberId: `member_${i}`, expectedValue: 'x'.repeat(10000) })) })).toThrow(/256 KB/);
  });
});

describe('revision ownership and disclosure', () => {
  it('preserves links on ordinary revisions, blocks removal of bound facts and changes the input fingerprint', async () => {
    const record = await stored(), current = getPackageRevision(record);
    expect(await packageInputFingerprint(current)).not.toBe(await packageInputFingerprint({ ...current, bindings: undefined }));
    const next = await reviseActionPackage(record, current.members); expect(getPackageRevision(next).bindings).toEqual(current.bindings);
    await expect(updatePackageInformation(next, undefined)).rejects.toThrow(/Detach or repair/);
    const missing = await reviseActionPackage(next, []); expect(getPackageRevision(missing).bindings).toEqual(current.bindings);
    expect((await packageBindingReadiness(getPackageRevision(missing)))[0].message).toMatch(/missing/);
  });
  it('preserves links in portable transfer, recovery and exact review baselines', async () => {
    let record = await stored(); const bindings = getPackageRevision(record).bindings;
    const portable = await buildPortableActionPackage(record, record.currentRevisionId);
    expect(getPackageRevision((await parsePortableActionPackage(portable)).record).bindings).toEqual(bindings);
    const imported = await importPortableActionPackage(portable);
    expect(getPackageRevision(imported).bindings).toEqual(bindings);
    const assets = new Map<string, ArrayBuffer>();
    for (const asset of packageAssets(record)) assets.set(asset.id, await readPackageAsset(asset));
    const backup = await validatePackageBackup(await capturePackageBackup(), assets); await restorePackageBackup(backup);
    expect((await listActionPackages()).find(value => value.id === record.id)?.revisions.at(-1)?.bindings).toEqual(bindings);
    record = await startPackageReview(record); const round = record.reviewRounds!.at(-1)!;
    expect(round.baseline.bindings).toEqual(bindings);
    const prepared = await buildPackageReviewerCopy(record, round.id, policy);
    const reviewed = await parsePackageReviewTransfer(await packageReviewTransferFile(prepared, policy));
    expect(getPackageRevision(reviewed.record).bindings).toEqual(bindings);
  });
  it('blocks PDF readiness on stale links while allowing portable incomplete work', async () => {
    const record = await stored(); record.revisions.at(-1)!.bindings!.items[0].expectedValue = 'Earlier value';
    const pdf = await preparePackageAssembly(record, record.currentRevisionId, policy);
    expect(pdf.readiness.findings.find(value => /edited locally/.test(value.message))?.severity).toBe('error');
    const portable = await preparePackageAssembly(record, record.currentRevisionId, policy, { includeRetainedDraftText: true });
    expect(portable.readiness.findings.find(value => /edited locally/.test(value.message))?.severity).toBe('warning');
  });
  it('reviews retained expected text even when overrides point at missing members', async () => {
    const value = { version: 1 as const, items: [{ ...link(), memberId: 'missing', mode: 'override' as const, expectedValue: '123-45-6789' }] };
    expect(reviewPackageBindings(value, policy).privacy.found).toBe(true);
    const record = await stored(); record.revisions.at(-1)!.bindings = value;
    expect((await preparePackageShare(record, record.currentRevisionId, policy)).reviews.find(item => item.member === 'Package field links')?.review.privacy.found).toBe(true);
    value.items[0].expectedValue = 'SECRET';
    await expect(preparePackageShare(record, record.currentRevisionId, policy)).rejects.toThrow(/outside.*configured levels/);
  });
  it('bounds retained links across all revisions before accepting a portable package', async () => {
    const record = await stored(), current = getPackageRevision(record);
    const heavy = { version: 1 as const, items: Array.from({ length: 24 }, (_, i) => ({ ...link(), id: `link_${i}`, memberId: `missing_${i}`, expectedValue: 'x'.repeat(10000) })) };
    const revisions = Array.from({ length: 36 }, (_, i) => ({ ...current, id: `r_${i}`, parentId: i ? `r_${i - 1}` : undefined, bindings: heavy }));
    expect(() => actionPackageSchema.parse({ ...record, revisions, currentRevisionId: 'r_35' })).toThrow(/combined 8 MB/);
  });
  it('refuses bound starter capture and permits existing unbound starters', async () => {
    const record = await stored(); await expect(capturePackageTemplate(record, record.currentRevisionId, 'Unsafe starter')).rejects.toThrow(/clean starter|detach/);
    const clean = structuredClone(record); delete clean.revisions.at(-1)!.bindings;
    expect((await capturePackageTemplate(actionPackageSchema.parse(clean), clean.currentRevisionId, 'Clean starter')).name).toBe('Clean starter');
  });
});
