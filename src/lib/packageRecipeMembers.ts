import { DOC_TYPE_CONFIG } from '@/types/document';
import { createBlankSession, type SerializedSession } from '@/stores/documentStore';
import type { PackageBindingTarget } from './packageBindingTargets';
import { listSessionFields } from './packageBindingTargets';
import type { PackageTemplateV2 } from './packageTemplateSchema';
import type { PackageTemplateCondition, PackageTemplateProgram, PackageTemplateQuestion } from './packageTemplateProgram';
import { uint8ArrayToBase64 } from './encoding';
import type { MaintainedWorksheet } from './maintainedPackageWorksheets';

export type NativeBlueprint = Extract<PackageTemplateV2['members'][number], { kind: 'native' }>;
export const equals = (questionId: string, value: string | boolean): PackageTemplateCondition => ({ op: 'equals', questionId, value });
export const question = (id: string, label: string, kind: PackageTemplateQuestion['kind'] = 'text', extra: Partial<PackageTemplateQuestion> = {}): PackageTemplateQuestion => ({ id, label, kind, required: true, ...extra });

function blankSession(): SerializedSession {
  return { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter', formType: 'navmc_10274', timestamp: 0,
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} };
}
export function letter(body: string): SerializedSession {
  return { ...blankSession(), formData: { docType: 'standard_letter', fontFamily: 'times', fontSize: '12pt', pageNumbering: 'simple', classLevel: 'unclassified',
    from: '', to: '', subject: '', date: '', ssic: '', serial: '', via: '', sigFirst: '', sigMiddle: '', sigLast: '', signatureType: 'none' },
  paragraphs: [{ id: 'starter-body', text: body, level: 0 }] };
}
export function worksheetSession(value: MaintainedWorksheet): SerializedSession {
  return { ...blankSession(), documentCategory: 'forms', formType: value.definition.formId,
    genericForm: { definition: value.definition, answers: {}, rows: {}, answerRevision: 0 } };
}
export async function native(key: string, label: string, session: SerializedSession, links: Readonly<Record<string, string>>, options: {
  worksheet?: MaintainedWorksheet; when?: PackageTemplateCondition; repeatGroupId?: string; main?: boolean;
} = {}): Promise<NativeBlueprint> {
  const draft = { ...session, kind: 'dondocs-draft', version: 2, documentKind: session.genericForm ? 'configured-form' : 'correspondence' };
  const role = options.main || !session.genericForm ? 'basic-letter' : 'supporting-document';
  const qualified = Object.keys(links).length ? await listSessionFields(session) : [];
  const declared: NonNullable<NativeBlueprint['links']> = [];
  for (const [field, questionId] of Object.entries(links)) {
    const target: PackageBindingTarget | undefined = qualified.find(item => item.target.kind === 'configured-form' ? item.target.fieldId === field
      : item.target.kind === 'correspondence' && item.target.field === field)?.target;
    if (!target) throw new Error(`The maintained starter cannot qualify ${label}: ${field}.`);
    declared.push({ questionId, target, format: target.kind === 'correspondence' && target.field === 'subject' ? 'uppercase' : 'field' });
  }
  return { key, kind: 'native', label, required: true, role, draft,
    pages: options.worksheet ? { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(options.worksheet.bytes) } } : {},
    links: declared, ...(options.when ? { when: options.when } : {}), ...(options.repeatGroupId ? { repeatGroupId: options.repeatGroupId } : {}) };
}
export const headerLinks = { from: 'requester', to: 'recipient', subject: 'subject', date: 'date', ssic: 'ssic' };
export function program(questions: PackageTemplateQuestion[], extra: Partial<PackageTemplateProgram> = {}): PackageTemplateProgram {
  return { revision: '1', questions, participantGroups: [], requirements: [], ...extra };
}

export function documentSource(id: string, label: string, when?: PackageTemplateCondition) {
  return question(id, label, 'choice', { required: false, when, options: [
    { id: 'draft', label: 'Draft in DonDocs' }, { id: 'original', label: 'Attach a received PDF' },
  ] });
}

export function receivedDocument(questionId: string): PackageTemplateCondition {
  return { op: 'all', conditions: [{ op: 'answered', questionId }, equals(questionId, 'original')] };
}

export function documentSourceCondition(stage: PackageTemplateCondition, id: string, source: 'draft' | 'original'): PackageTemplateCondition {
  const received = receivedDocument(id);
  return { op: 'all', conditions: [stage, source === 'original' ? received : { op: 'not', condition: received }] };
}

export async function correspondenceMember(input: {
  key: string; label: string; docType: string; role: NativeBlueprint['role']; when?: PackageTemplateCondition;
  facts?: Record<string, string>; subject?: string; endorses?: string;
}): Promise<NativeBlueprint> {
  if (!Object.hasOwn(DOC_TYPE_CONFIG, input.docType)) throw new Error('Unknown correspondence type: ' + input.docType);
  const session = createBlankSession(undefined, input.docType);
  session.timestamp = 0;
  session.formData.signatureType = 'none';
  if (session.paragraphs.length) session.paragraphs = [{ id: 'starter-body', text: '', level: 0 }];
  session.formData.subject = input.subject ?? '';
  const member = await native(input.key, input.label, session, input.facts ?? {}, { when: input.when });
  return { ...member, role: input.role, ...(input.endorses && { endorses: input.endorses }) };
}
