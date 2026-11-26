import { FORM_TYPE_LABELS, formTypeLabel } from '@/types/document';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { identifyOfficialOriginal, officialEdition, nativeSigningFormId, officialFormChoices } from '@/services/forms/nativeCatalog';
import { loadDefinition } from '@/services/forms/packages';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { captureDocumentRevision } from './capturedDocument';
import { capturePackageMember, readPackageAsset } from './actionPackageAssets';
import { copyFormExportTemplates } from './formExportTemplates';
import { listSessionFields, type PackageBindingTarget } from './packageBindingTargets';
import { uint8ArrayToBase64 } from './encoding';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { PackageMember } from './actionPackages';
import type { PackageTemplateV2 } from './packageTemplateSchema';

export const packageOfficialForms = officialFormChoices;

async function officialFormStarter(formId: string, catalogLabel?: string) {
  const edition = officialEdition(formId);
  const builtin = Object.hasOwn(FORM_TYPE_LABELS, formId);
  const label = edition?.label ?? (builtin ? formTypeLabel(formId) : catalogLabel);
  if (!label) throw new Error('This form is unavailable.');
  const session = createBlankSession(formId);
  if (edition?.format === 'acroform' || !builtin && !edition) {
    const definition = edition ? await loadDefinition(edition.directory) : await (await import('@/services/formRegistry')).configForFormType(formId);
    if (!definition || definition.formId !== formId || edition && definition.nativePdfEdition !== edition.edition)
      throw new Error('The form definition does not match the selected edition.');
    delete session.forms;
    session.genericForm = { definition, answers: {}, rows: {}, answerRevision: 0 };
  }
  const captured = captureDocumentRevision({
    documentId: crypto.randomUUID(), epoch: 0, editSequence: 0, capturedAt: session.timestamp,
  }, prepareSessionState(session));
  return { label, session, captured };
}

export async function createOfficialFormMember(formId: string, role: PackageMember['role'], catalogLabel?: string) {
  const { label, captured } = await officialFormStarter(formId, catalogLabel);
  return capturePackageMember(captured, label, role);
}

type NativeStarter = Extract<PackageTemplateV2['members'][number], { kind: 'native' }>;

/** Maintained recipes declare membership. The registry supplies the editor, edition and exact original. */
export type OfficialFormMembership = Pick<NativeStarter, 'key' | 'role' | 'required' | 'when' | 'repeatGroupId' | 'links' | 'blankPdf' | 'completion'> & { formId: string; facts?: Record<string, string> };
export async function officialFormBlueprint(input: OfficialFormMembership): Promise<NativeStarter> {
  const { formId, facts, ...membership } = input;
  const { label, session, captured } = await officialFormStarter(formId);
  const templates = await captureExportFormTemplates(captured);
  if (!templates) throw new Error('The official form templates are unavailable.');
  const pages = Object.fromEntries(Object.entries(copyFormExportTemplates(templates)).map(([file, data]) =>
    [file, { name: file, type: 'application/pdf' as const, data: uint8ArrayToBase64(data) }]));
  const draft = { ...session, kind: 'dondocs-draft', version: 2, documentKind: captured.kind, timestamp: 0 };
  return { ...membership, completion: memberCompletion(session, membership.completion), kind: 'native', label, draft, pages, links: await memberFactLinks(session, membership.links, facts) };
}

export function memberCompletion(session: Parameters<typeof listSessionFields>[0], completion: NativeStarter['completion']) {
  if (completion?.expectedForm && session.genericForm) {
    const required = new Set(completion.requiredPdfFields);
    for (const field of Object.values(session.genericForm.definition.fields)) {
      if (field.requiredAt === 'export') field.sourceIds?.forEach(name => required.add(name));
    }
    if (required.size) return { ...completion, requiredPdfFields: [...required] };
  }
  return completion;
}

export async function memberFactLinks(session: Parameters<typeof listSessionFields>[0], existing: NativeStarter['links'], facts: OfficialFormMembership['facts']) {
  const links = [...existing ?? []];
  if (facts) {
    const targets = new Map<string, PackageBindingTarget>();
    for (const { target } of await listSessionFields(session)) {
      if (target.kind === 'configured-form') {
        if (!target.row) targets.set(target.fieldId, target);
      } else targets.set(target.field, target);
    }
    for (const [fieldId, questionId] of Object.entries(facts)) {
      const target = targets.get(fieldId);
      if (!target) throw new Error('Unavailable package form field: ' + fieldId);
      links.push({ questionId, target, format: 'field' });
    }
  }
  return links;
}

export function memberSigningFormId(member: PackageMember) {
  if (member.kind === 'original') return member.officialFormId;
  if (member.kind === 'native') return nativeSigningFormId(member.session.documentCategory, member.session.formType);
}

export function packageFormSigningAction(member: PackageMember) {
  if (member.kind === 'original' && member.signedOriginal && member.officialFormId) return 'Open signed form';
  if (member.kind === 'native') {
    if (member.session.documentCategory === 'correspondence') return 'Sign correspondence';
    const edition = member.session.formType === 'navmc_118_11' ? member.session.forms?.officialPdfEdition : member.session.genericForm?.definition.nativePdfEdition;
    if (edition && officialEdition(member.session.formType ?? '', edition)) return 'Sign official form';
  }
}

export async function preparePackageFormSigning(member: PackageMember, policy: PolicyResolution, signal: AbortSignal,
  ports?: Parameters<typeof import('./packageNativeDelivery').renderPackageRecipientMember>[2]) {
  if (member.kind === 'native' && packageFormSigningAction(member)) {
    if (member.session.documentCategory === 'correspondence' && !member.session.paragraphs?.some(p => p.text?.trim()))
      throw new Error('Write the correspondence before preparing its signature revision.');
    const { renderPackageRecipientMember } = await import('./packageNativeDelivery');
    const { bytes } = await renderPackageRecipientMember(member, policy, ports, readPackageAsset, signal, undefined, 'editable');
    if (member.session.documentCategory === 'correspondence') {
      const { prepareCorrespondenceSignature } = await import('@/services/pdf/packageCorrespondenceSignature');
      return { bytes: await prepareCorrespondenceSignature(bytes), label: member.label + '.pdf', metadata: member.session.formData };
    }
    return { bytes: new Uint8Array(bytes), label: member.label + '.pdf', metadata: member.session.genericForm?.answers ?? member.session.forms };
  }
  if (member.kind === 'original' && member.signedOriginal) {
    const bytes = await readPackageAsset(member.original);
    if (member.officialFormId && await identifyOfficialOriginal(bytes) === member.officialFormId) {
      return { bytes: new Uint8Array(bytes), label: member.original.name };
    }
  }
  throw new Error('This package member has no supported native signing profile.');
}
