import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ManualFrontMatterSection } from '@/components/editor/ManualFrontMatterSections';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore, getSerializedSession, loadSharedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { manualPacket } from '../_helpers/manualPacket';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { manualFrontMatterFindings } from '@/lib/manualFrontMatterValidation';
import { getEditorSections } from '@/lib/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { handoffUrl } from '../../companion/handoff';
import { manualRequest } from '../_helpers/manualPacket';
import { decodeHandoff } from '@/lib/localHandoff';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ ...manualPacket(2), documentCategory: 'correspondence', paragraphs: [{ text: 'Unrelated correspondence retained.', level: 0 }] });
  useHistoryStore.getState().clearHistory();
  useDocumentsStore.setState({ currentId: 'manual-editor-test' });
  Element.prototype.scrollIntoView = vi.fn();
});

it('edits, reorders and removes stable end-item rows without touching correspondence text', async () => {
  render(<><ManualFrontMatterSection section="manual-items" /><AppAlertDialog /></>);
  const firstId = useDocumentStore.getState().formData.manualFrontMatter!.endItems[0].rowId;
  fireEvent.change(screen.getByLabelText('MODEL — end item 1'), { target: { value: 'UPDATED MODEL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move end item 1 down' }));
  expect(useDocumentStore.getState().formData.manualFrontMatter!.endItems[1]).toMatchObject({ rowId: firstId, model: 'UPDATED MODEL' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove end item 1' }));
  expect(useDocumentStore.getState().formData.manualFrontMatter!.endItems).toHaveLength(2);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Remove end item$/ })); });
  expect(useDocumentStore.getState().formData.manualFrontMatter!.endItems[0].rowId).toBe(firstId);
  fireEvent.click(screen.getByRole('button', { name: 'Add end item' }));
  expect(useDocumentStore.getState().formData.manualFrontMatter!.endItems).toHaveLength(2);
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Unrelated correspondence retained.');
});

it('uses the last working day and records contract-clause selection through real controls', () => {
  const view = render(<TooltipProvider><ManualFrontMatterSection section="manual-publication" /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('Signing date'), { target: { value: '2026-05-15' } });
  fireEvent.blur(screen.getByLabelText('Signing date'));
  fireEvent.change(screen.getByLabelText('Office closure dates (YYYY-MM-DD, separated by commas)'), { target: { value: '2026-05-29' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use last working day of signing month' }));
  expect(useDocumentStore.getState().formData.date).toBe('28 May 26');
  view.unmount();
  render(<ManualFrontMatterSection section="manual-authentication" />);
  fireEvent.change(screen.getByLabelText('DFAR clause in the acquisition contract'), { target: { value: '252.227-7015' } });
  expect(useDocumentStore.getState().formData.manualFrontMatter!.dfarClause).toBe('252.227-7015');
});

it('round-trips nested content through portable drafts, history and Companion handoff', async () => {
  const original = structuredClone(useDocumentStore.getState().formData.manualFrontMatter);
  const parsed = parseDraftFile(JSON.parse(JSON.stringify(await buildDraftFile())));
  act(() => loadSharedSession(parsed.session));
  expect(useDocumentStore.getState().formData.manualFrontMatter).toEqual(original);
  const snapshot = () => { const s = useDocumentStore.getState(); return { ...s, formData: s.formData }; };
  useHistoryStore.getState().saveSnapshot(snapshot());
  const m = useDocumentStore.getState().formData.manualFrontMatter!;
  useDocumentStore.getState().setField('manualFrontMatter', { ...m, contentContact: 'Changed' });
  useHistoryStore.getState().saveSnapshot(snapshot());
  const undo = useHistoryStore.getState().undo()!;
  expect(undo.formData.manualFrontMatter).toEqual(original);
  expect(undo.formData.manualFrontMatter).not.toBe(original);
  const url = handoffUrl(manualRequest(), {}, 'https://example.test')!;
  expect(decodeHandoff(url.split('#d=')[1])?.formData.manualFrontMatter?.endItems[0].model).toBe('MODEL-1');
  expect(getSerializedSession().docType).toBe('tm_ietm_front_matter');
});

it('provides dedicated sections and identifies the actual section for each incomplete field', () => {
  const ids = getEditorSections(DOC_TYPE_CONFIG.tm_ietm_front_matter, 'tm_ietm_front_matter').map((s) => s.id);
  expect(ids).toEqual(['manual-publication', 'manual-items', 'manual-notices', 'manual-authentication']);
  useDocumentStore.getState().setField('pcn', '');
  expect(manualFrontMatterFindings(useDocumentStore.getState())).toContainEqual(expect.objectContaining({ section: 'manual-publication', message: 'PCN is required.' }));
  expect(ids).not.toContain('body');
});

it('records authority, sponsor numbering and contract-rights determinations through the editor', async () => {
  const view = render(<ManualFrontMatterSection section="manual-authentication" />);
  fireEvent.change(screen.getByLabelText('Signing authority title'), { target: { value: 'Product Manager' } });
  fireEvent.change(screen.getByLabelText('Verified signing authority basis'), { target: { value: 'pdm_deviation' } });
  fireEvent.change(screen.getByLabelText('Delegation or approval reference'), { target: { value: 'Applicable delegation TEST-2024' } });
  expect(manualFrontMatterFindings(useDocumentStore.getState())).toEqual([]);
  view.rerender(<ManualFrontMatterSection section="manual-publication" />);
  fireEvent.change(screen.getByLabelText('Numbering system'), { target: { value: 'sponsor_assigned' } });
  fireEvent.change(screen.getByLabelText('Short title'), { target: { value: 'NAVAIR 01-1A-505-1' } });
  fireEvent.change(screen.getByLabelText('Assigning activity and approval reference'), { target: { value: 'Test activity approval TEST-4' } });
  expect(manualFrontMatterFindings(useDocumentStore.getState())).toEqual([]);
  view.rerender(<ManualFrontMatterSection section="manual-notices" />);
  fireEvent.change(screen.getByLabelText('Contract limited-rights markings'), { target: { value: 'limited_rights' } });
  expect(manualFrontMatterFindings(useDocumentStore.getState()).some((f) => f.section === 'manual-notices' && f.message.includes('Limited Rights legend'))).toBe(true);
  fireEvent.change(screen.getByLabelText('Copyright credit (if applicable)'), { target: { value: '© 2026 Test Publisher.' } });
  expect(manualFrontMatterFindings(useDocumentStore.getState()).some((f) => f.section === 'manual-notices' && f.message.includes('government rights'))).toBe(true);
  fireEvent.change(screen.getByLabelText('Government rights statement (required with copyright credit)'), { target: { value: 'Fictional test license: Government may publish, reproduce and distribute.' } });
  const m = useDocumentStore.getState().formData.manualFrontMatter!;
  expect(m).toMatchObject({ authorityBasis: 'pdm_deviation', authorityReference: 'Applicable delegation TEST-2024', shortTitleBasis: 'sponsor_assigned', shortTitleApproval: 'Test activity approval TEST-4', rightsAssessment: 'limited_rights', governmentRights: 'Fictional test license: Government may publish, reproduce and distribute.' });
  const parsed = parseDraftFile(JSON.parse(JSON.stringify(await buildDraftFile())));
  expect(parsed.session.formData.manualFrontMatter).toEqual(m);
});

it('identifies invalid text, dates and equipment fields and clears their messages as they are corrected', () => {
  useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, pcn: '123', subject: '[SUBJECT]', publicationSigningDate: '' } });
  const view = render(<ManualFrontMatterSection section="manual-publication" />);
  const pcn = screen.getByLabelText('Publication Control Number (PCN)');
  expect(pcn).toHaveAttribute('aria-invalid', 'true');
  expect(pcn).toHaveAccessibleDescription('PCN must contain eleven digits.');
  expect(screen.getByLabelText('Long title (manual type and coverage)')).toHaveAccessibleDescription('Replace the remaining template prompts before export.');
  expect(screen.getByLabelText('Signing date')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(pcn, { target: { value: '00000000000' } });
  expect(pcn).not.toHaveAttribute('aria-invalid');
  expect(pcn).not.toHaveAttribute('aria-describedby');
  view.rerender(<ManualFrontMatterSection section="manual-items" />);
  const nsn = screen.getByLabelText('NSN — end item 1');
  fireEvent.change(nsn, { target: { value: 'BAD-NSN' } });
  expect(nsn).toHaveAttribute('aria-invalid', 'true');
  expect(nsn).toHaveAccessibleDescription(/thirteen-digit NSN/);
  fireEvent.change(nsn, { target: { value: '0000-00-000-0001' } });
  expect(nsn).not.toHaveAttribute('aria-invalid');
});

it('takes an export-check link to the field that needs correction', async () => {
  useDocumentStore.getState().setField('pcn', '');
  render(<ManualFrontMatterSection section="manual-publication" />);
  const checks = screen.getByText(/Export checks/).closest('details')!;
  fireEvent.click(within(checks).getByRole('button', { name: 'PCN is required.' }));
  await waitFor(() => expect(screen.getByLabelText('Publication Control Number (PCN)')).toHaveFocus());
});

it('does not delete equipment from another document when a confirmation resolves after switching drafts', async () => {
  render(<><ManualFrontMatterSection section="manual-items" /><AppAlertDialog /></>);
  const before = structuredClone(useDocumentStore.getState().formData.manualFrontMatter!.endItems);
  fireEvent.click(screen.getByRole('button', { name: 'Remove end item 1' }));
  act(() => useDocumentsStore.setState({ currentId: 'another-manual' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Remove end item$/ })); });
  expect(useDocumentStore.getState().formData.manualFrontMatter!.endItems).toEqual(before);
});
