import { openSavedPackage, expandDetails } from "../helpers/packageWorkspace";
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { listPackageTemplates } from '@/lib/packageTemplateLibrary';
import { useUIStore } from '@/stores/uiStore';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async importOriginal => ({ ...(await importOriginal<typeof import('@/config/classification')>()),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
beforeEach(() => { localStorage.clear(); useUIStore.setState({ actionPackagesOpen: true, isMobile: false, actionPackageSelectionId: null }); });
async function setup() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); const bytes = await pdf.save();
  const session = createBlankSession(); session.formData.subject = 'Action {{NAME}}';
  session.paragraphs = [{ id: crypto.randomUUID(), text: 'Approve {{NAME}}.', level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), 'Starter letter', 'basic-letter');
  const original = await captureOriginalPackageMember({ name: 'old.pdf', data: new Uint8Array(bytes).buffer }, 'enclosure', true);
  const record = await reviseActionPackage(await createActionPackage(`Source ${crypto.randomUUID()}`), [member, original]);
  const user = userEvent.setup();
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole('dialog', { name: 'Action packages' });
  await openSavedPackage(dialog, record, user); await expandDetails(dialog, user);
  const panel = await within(dialog).findByRole('region', { name: 'Reusable package templates' });
  await waitFor(() => expect(within(panel).getByLabelText('Template name', { exact: true })).toBeEnabled());
  await user.type(within(panel).getByLabelText('Template name', { exact: true }), `Starter ${crypto.randomUUID()}`);
  return { record, user, panel, dialog, bytes };
}
it('saves a reviewed starter and creates a fresh action through the actual workspace controls', async () => {
  const { record, user, panel, bytes } = await setup();
  const save = within(panel).getByRole('button', { name: 'Save package template' });
  expect(save).toBeDisabled();
  await user.click(within(panel).getByRole('checkbox', { name: /I reviewed the source starter text/ }));
  await user.click(save);
  await within(panel).findByText('Package template saved.');
  const create = within(panel).getByRole('button', { name: 'Create package from template' });
  expect(create).toBeDisabled();
  await user.clear(within(panel).getByLabelText('New action name', { exact: true }));
  await user.type(within(panel).getByLabelText('New action name', { exact: true }), 'Fresh action from template');
  await user.type(within(panel).getByLabelText('Template value NAME', { exact: true }), 'NEW MARINE');
  await user.click(within(panel).getByRole('checkbox', { name: /I reviewed the retained starter contents/ }));
  expect(create).toBeDisabled();
  await user.upload(within(panel).getByLabelText('Fresh PDF for old.pdf', { exact: true }), new File([new Uint8Array(bytes)], 'fresh.pdf', { type: 'application/pdf' }));
  await within(panel).findByText('fresh.pdf');
  expect(within(panel).getByRole('checkbox', { name: /This uploaded PDF is a signed original/ })).not.toBeChecked();
  await user.click(within(panel).getByRole('checkbox', { name: /I reviewed the retained starter contents/ }));
  await user.click(create);
  await within(panel).findByText(/Fresh package created/);
  const created = (await listActionPackages()).find(value => value.name === 'Fresh action from template')!;
  expect(created.id).not.toBe(record.id);
  const members = getPackageRevision(created).members;
  expect(members[0].kind === 'native' && members[0].session.formData.subject).toBe('Action NEW MARINE');
  expect(members[1]).toMatchObject({ kind: 'original', signedOriginal: false });
  expect(members[0].id).not.toBe(getPackageRevision(record).members[0].id);
});
it('requires explicit review for template import and reports malformed files without saving them', async () => {
  const { user, panel, dialog } = await setup();
  const before = await listPackageTemplates();
  await user.upload(within(panel).getByLabelText('Import package template', { exact: true }), new File(['{"kind":"wrong"}'], 'bad.json', { type: 'application/json' }));
  await within(dialog).findByRole('alert');
  expect(await listPackageTemplates()).toEqual(before);
});

it('reviews versioned declarations on import and leaves creation to conditional intake', async () => {
  const { user, panel, dialog } = await setup();
  const template = { kind: 'dondocs-package-template', version: 2, id: 'conditional', name: 'Declared starter', createdAt: 0,
    program: { revision: '1', participantGroups: [], questions: [{ id: 'route', label: 'Route', kind: 'text', required: false }], requirements: [] as unknown[] },
    members: [{ key: 'main', kind: 'attachment', label: 'Main document', role: 'basic-letter', required: true }] };
  const before = await listPackageTemplates();
  await user.upload(within(panel).getByLabelText('Import package template', { exact: true }), new File([JSON.stringify(template)], 'conditional.json', { type: 'application/json' }));
  const approve = await within(panel).findByRole('button', { name: 'Import reviewed package template' });
  expect(approve).toBeDisabled();expect(await listPackageTemplates()).toEqual(before);
  await user.click(within(panel).getByRole('checkbox', { name: /I reviewed this template's retained text/ }));await user.click(approve);
  await within(panel).findByText('Package template imported.');
  expect(within(panel).getByText(/requires the conditional intake workflow/)).toBeVisible();
  expect(within(panel).queryByRole('button', { name: 'Create package from template' })).toBeNull();
  expect(within(panel).queryByLabelText('New action name', { exact: true })).toBeNull();
  const stored = await listPackageTemplates();expect(stored.find(value => value.name === template.name)?.version).toBe(2);
  template.program.requirements = [{ id: 'secret_branch', label: 'Evidence', kind: 'document', operations: ['portable'], when: { op: 'equals', questionId: 'route', value: 'SECRET' } }];
  await user.upload(within(panel).getByLabelText('Import package template', { exact: true }), new File([JSON.stringify(template)], 'restricted.json', { type: 'application/json' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/outside.*configured levels/));
  expect(await listPackageTemplates()).toEqual(stored);
});

it('inspects PDF background text from inactive versioned branches before template transfer', async () => {
  const { user, panel, dialog } = await setup();
  const { fixtureInstance } = await import('../_helpers/formFixture');
  const { portableResourceDigest } = await import('@/lib/portableResources');
  const { uint8ArrayToBase64 } = await import('@/lib/encoding');
  const { extractPdfText } = await import('@/lib/pdfText');
  const pdf = await PDFDocument.create();pdf.addPage([612, 792]).drawText('SECRET');const bytes = await pdf.save();
  const form = fixtureInstance();form.answers = {};form.definition.pages[0].sha256 = await portableResourceDigest(new Uint8Array(bytes).buffer);
  const session = { documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: form.definition.formId, genericForm: form,
    timestamp: 0, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' };
  const template = { kind: 'dondocs-package-template', version: 2, id: 'inactive_background', name: 'Background review', createdAt: 0,
    program: { revision: '1', participantGroups: [], questions: [{ id: 'include', label: 'Include worksheet', kind: 'boolean', required: false }], requirements: [] },
    members: [{ key: 'main', kind: 'attachment', label: 'Main document', role: 'basic-letter', required: true },
      { key: 'unused', kind: 'native', label: 'Inactive worksheet', role: 'supporting-document', required: false, when: { op: 'equals', questionId: 'include', value: true },
        draft: session, pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(bytes) } } }] };
  const before = await listPackageTemplates();vi.mocked(extractPdfText).mockResolvedValueOnce('SECRET');
  await user.upload(within(panel).getByLabelText('Import package template', { exact: true }), new File([JSON.stringify(template)], 'background.json', { type: 'application/json' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Template background: page1.pdf.*outside.*configured levels/));
  expect(await listPackageTemplates()).toEqual(before);
  expect(within(panel).queryByRole('button', { name: 'Import reviewed package template' })).toBeNull();
});
