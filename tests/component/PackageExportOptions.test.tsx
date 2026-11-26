import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PackageExportOptions } from '@/components/PackageExportOptions';
import { type ActionPackage, getPackageRevision } from '@/lib/actionPackages';

import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { PDFDocument } from 'pdf-lib';
import * as requirements from '@/lib/packageRequirements';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['pdf', 'editable'] as const)('allows an unfinished package to transfer as %s', format => {
  const record: ActionPackage = { kind: 'dondocs-action-package-record', version: 1, id: 'package_fixture', name: 'Unfinished draft',
    sequence: 0, archived: false, currentRevisionId: 'revision_fixture', revisions: [{ id: 'revision_fixture', createdAt: 1, members: [], outputs: [] }] };
  render(<PackageExportOptions active={false} canSign={false} onNavigate={vi.fn()} revision={getPackageRevision(record)} format={format} disabled={false} pdfDisabled={false}
    onFormat={vi.fn()} onPrepare={vi.fn()} onOpenDocument={vi.fn()} />);
  const prepare = screen.getByRole('button', { name: format === 'pdf' ? 'Prepare PDF' : 'Prepare editable package' });
  if (format === 'pdf') expect(prepare).toBeDisabled();
  else expect(prepare).toBeEnabled();
});

it('routes document and package findings for the selected saved revision only', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const member = await captureOriginalPackageMember({ name: 'Evidence.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'enclosure', false);
  const revision = { id: 'saved', createdAt: 1, members: [member], outputs: [] };
  const findings: requirements.PackageRequirementFinding[] = [
    { id: 'record', memberId: member.id, kind: 'document', label: member.label, state: 'missing', message: 'Check the record.', documentIssues: ['Confirm this record.', 'Complete the date.'] },
    { id: 'approval', kind: 'document', label: 'Approval', state: 'missing', message: 'Add the approval.' },
  ];
  vi.spyOn(requirements, 'assertDeliveryRequirements').mockRejectedValueOnce(new requirements.PackageDeliveryBlocked(findings)).mockResolvedValue(undefined);
  const props = { active: true, canSign: false, onNavigate: vi.fn(), revision, format: 'pdf' as const, disabled: false,
    pdfDisabled: false, onFormat: vi.fn(), onPrepare: vi.fn(), onOpenDocument: vi.fn() };
  const view = render(<PackageExportOptions {...props} />);
  const summary = await screen.findByText('2 items to resolve');
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
  expect(props.onNavigate).toHaveBeenCalledWith({ revisionId: 'saved', memberId: member.id });
  fireEvent.click(within(screen.getByRole('region', { name: 'Package requirements' })).getByRole('button'));
  expect(props.onNavigate).toHaveBeenCalledWith({ revisionId: 'saved', panel: 'requirements', requirementId: 'approval' });
  view.rerender(<PackageExportOptions {...props} format="draft" />);
  expect(screen.queryByText('2 items to resolve')).toBeNull();
  view.rerender(<PackageExportOptions {...props} revision={{ ...revision, id: 'new' }} />);
  expect(screen.queryByText('Confirm this record.')).toBeNull();
  expect(await screen.findByText(member.label)).toBeVisible();
});

it('opens the exact missing signature and keeps read-only corrections on the saved document', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const original = await captureOriginalPackageMember({ name: 'Training.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'enclosure', false);
  if (original.kind !== 'original') throw new Error('Expected original PDF');
  const member = { ...original, officialFormId: 'navmc_118_11', signedOriginal: true };
  const revision = { id: 'reviewed', createdAt: 1, members: [member], outputs: [] };
  const field = 'page[0].SignatureField1[0]';
  const finding: requirements.PackageRequirementFinding = { id: 'signed', memberId: member.id, kind: 'document',
    state: 'missing', label: 'Required signature', message: 'Awaiting signature', signatureFields: [field], signatureLabels: { [field]: 'Certifying official' } };
  vi.spyOn(requirements, 'assertDeliveryRequirements').mockRejectedValue(new requirements.PackageDeliveryBlocked([finding]));
  const action = { id: 'requirement-signed', kind: 'evidence' as const, blocking: true, label: finding.label, message: finding.message,
    destination: { panel: 'requirements' as const, memberId: member.id } };
  const result = { operation: 'pdf' as const, readyForOperation: false, computedBlockers: 1, pendingTasks: 0, actions: [action] };
  const props = { revision, active: true, format: 'pdf' as const, canSign: true, disabled: false, pdfDisabled: false,
    checks: { result, error: undefined }, onFormat: vi.fn(), onPrepare: vi.fn(), onOpenDocument: vi.fn(), onNavigate: vi.fn() };
  const view = render(<PackageExportOptions {...props} />);
  const next = within(screen.getByRole('group', { name: 'Next delivery action' }));
  fireEvent.click(await next.findByRole('button', { name: 'Review Certifying official' }));
  expect(props.onNavigate).toHaveBeenLastCalledWith({ revisionId: revision.id, memberId: member.id, signatureField: field });
  view.rerender(<PackageExportOptions {...props} canSign={false} checks={{ ...props.checks, result: { ...result, actions: [
    { ...action, destination: { memberId: member.id, correction: { kind: 'replace', label: 'Replace PDF' } } },
  ] } }} />);
  fireEvent.click(next.getByRole('button', { name: 'Open document' }));
  expect(props.onNavigate).toHaveBeenLastCalledWith({ revisionId: revision.id, memberId: member.id, section: 'documents' });
});
