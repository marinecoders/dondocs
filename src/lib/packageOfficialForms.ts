import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { identifyOfficialOriginal, officialEdition, officialFormChoices } from '@/services/forms/nativeCatalog';
import { loadDefinition } from '@/services/forms/packages';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { captureDocumentRevision } from './capturedDocument';
import { capturePackageMember, readPackageAsset } from './actionPackageAssets';
import { copyFormExportTemplates } from './formExportTemplates';
import { uint8ArrayToBase64 } from './encoding';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { PackageMember } from './actionPackages';
import type { PackageTemplateV2 } from './packageTemplateSchema';

export const packageOfficialForms = officialFormChoices;

async function officialFormStarter(formId: string) {
  const form = officialEdition(formId);
  if (!form) throw new Error('This official form is unavailable.');
  const session = createBlankSession(formId);
  if (form.format === 'acroform') {
    const definition = await loadDefinition(form.directory);
    if (definition.formId !== formId || definition.nativePdfEdition !== form.edition)
      throw new Error('The form definition does not match the selected edition.');
    delete session.forms;
    session.genericForm = { definition, answers: {}, rows: {}, answerRevision: 0 };
  }
  const captured = captureDocumentRevision({
    documentId: crypto.randomUUID(), epoch: 0, editSequence: 0, capturedAt: session.timestamp,
  }, prepareSessionState(session));
  return { form, session, captured };
}

export async function createOfficialFormMember(formId: string, role: PackageMember['role']) {
  const { form, captured } = await officialFormStarter(formId);
  return capturePackageMember(captured, form.label, role);
}

type NativeStarter = Extract<PackageTemplateV2['members'][number], { kind: 'native' }>;

/** Maintained recipes declare membership. The registry supplies the editor, edition and exact original. */
export type OfficialFormMembership = Pick<NativeStarter, 'key' | 'role' | 'required' | 'when' | 'repeatGroupId' | 'links' | 'blankPdf' | 'completion'> & { formId: string };
export async function officialFormBlueprint(input: OfficialFormMembership): Promise<NativeStarter> {
  const { formId, ...membership } = input;
  const { form, session, captured } = await officialFormStarter(formId);
  const templates = await captureExportFormTemplates(captured);
  if (!templates) throw new Error('The official form templates are unavailable.');
  const pages = Object.fromEntries(Object.entries(copyFormExportTemplates(templates)).map(([file, data]) =>
    [file, { name: file, type: 'application/pdf' as const, data: uint8ArrayToBase64(data) }]));
  const draft = { ...session, kind: 'dondocs-draft', version: 2, documentKind: captured.kind, timestamp: 0 };
  return { ...membership, kind: 'native', label: form.label, draft, pages };
}

export function packageFormSigningAction(member: PackageMember) {
  if (member.kind === 'original' && member.signedOriginal && member.officialFormId) return 'Open signed form';
  if (member.kind === 'native') {
    const edition = member.session.formType === 'navmc_118_11' ? member.session.forms?.officialPdfEdition : member.session.genericForm?.definition.nativePdfEdition;
    if (edition && officialEdition(member.session.formType ?? '', edition)) return 'Sign official form';
  }
}

export async function preparePackageFormSigning(member: PackageMember, policy: PolicyResolution, signal: AbortSignal) {
  if (member.kind === 'native' && packageFormSigningAction(member)) {
    const { renderPackageRecipientMember } = await import('./packageNativeDelivery');
    const { bytes } = await renderPackageRecipientMember(member, policy, undefined, readPackageAsset, signal, undefined, 'editable');
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
