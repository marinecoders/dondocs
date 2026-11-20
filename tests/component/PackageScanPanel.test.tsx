import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { PackageScanPanel } from '@/components/PackageScanPanel';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { recognizeScannedFile } from '@/lib/scannedImport';
import { preparePackageScan, preparePackageScanCorrection, savePreparedPackageScan } from '@/lib/packageScans';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/lib/scannedImport', () => ({ recognizeScannedFile: vi.fn() }));
vi.mock('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: ({ children }: { children: React.ReactNode }) => <div aria-label="Captured PDF renderer">{children}</div>, Page: () => <div>Captured page</div> }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => {
  vi.restoreAllMocks(); useUIStore.setState({ storageHealth: 'ok' });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.mocked(recognizeScannedFile).mockReset().mockResolvedValue([{ page: 1, text: 'Synthetic recognized text', confidence: 95, preview: new Blob(['preview']) }]);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-preview'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fixture() { const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); return reviseActionPackage(await createActionPackage(`Scanned UI ${crypto.randomUUID()}`), [await captureOriginalPackageMember({ name: 'Synthetic paper.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false)]); }
it('scrolls the captured source with keyboard controls without taking editor or browser shortcuts', async () => {
  const record = await fixture(), user = userEvent.setup();
  render(<PackageScanPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false}
    run={async action => action()} signal={() => undefined} isCurrent={() => true} onApply={vi.fn()} />);
  await user.selectOptions(screen.getByLabelText('Captured scan source'), getPackageRevision(record).members[0].id);
  await user.click(screen.getByRole('button', { name: 'Recognize captured source' }));
  const preview = await screen.findByRole('region', { name: 'Captured source preview' });
  Object.defineProperties(preview, {
    clientHeight: { configurable: true, value: 310 },
    scrollHeight: { configurable: true, value: 701 },
  });
  const press = (target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    fireEvent(target, event);
    return event.defaultPrevented;
  };
  preview.focus();
  for (const [key, expected, modifiers] of [
    ['ArrowDown', 80, {}], ['PageDown', 359, {}], ['End', 391, {}], ['ArrowDown', 391, {}],
    ['ArrowUp', 311, {}], ['PageUp', 32, {}], ['Home', 0, {}], ['ArrowUp', 0, {}],
    [' ', 279, {}], [' ', 0, { shiftKey: true }],
  ] as const) {
    expect(press(preview, key, modifiers)).toBe(true);
    expect(preview.scrollTop).toBeCloseTo(expected);
  }
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
    expect(press(preview, 'ArrowDown', modifiers)).toBe(false);
    expect(preview.scrollTop).toBe(0);
  }
  expect(press(preview, 'Tab')).toBe(false);
  expect(press(preview, 'Escape')).toBe(false);
  expect(press(screen.getByLabelText('Corrected source text'), 'ArrowDown')).toBe(false);
  expect(preview.scrollTop).toBe(0);
  Object.defineProperty(preview, 'scrollHeight', { configurable: true, value: 250 });
  expect(press(preview, 'ArrowDown')).toBe(false);
});

it('reviews corrections, preserves their source, and adopts only a separately acknowledged excerpt', async () => {
  const initial = await fixture(), applied = vi.fn(), dirty = vi.fn(), user = userEvent.setup();
  function Harness() { const [record, setRecord] = useState(initial); return <PackageScanPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} signal={() => undefined} isCurrent={() => true} onDirtyChange={dirty} onApply={next => { applied(next); setRecord(next); }} />; }
  render(<Harness />);
  await user.selectOptions(screen.getByLabelText('Captured scan source'), getPackageRevision(initial).members[0].id);
  await user.click(screen.getByRole('button', { name: 'Recognize captured source' }));
  const text = await screen.findByLabelText('Corrected source text'); expect(text).toHaveValue('Synthetic recognized text'); expect(dirty).toHaveBeenLastCalledWith(true);
  await user.clear(text); await user.type(text, 'User corrected training evidence');
  await user.click(screen.getByRole('button', { name: 'Review corrected extraction' }));
  const save = await screen.findByRole('button', { name: 'Save reviewed extraction' }); expect(save).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the exact source, all corrected pages/ })); await user.click(save);
  await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  const saved = applied.mock.calls[0][0], scan = getPackageRevision(saved).scans!.items[0];
  expect(scan.pages[0].recognizedText).toBe('Synthetic recognized text'); expect(getPackageRevision(saved).information?.facts ?? []).toEqual([]);
  await user.selectOptions(screen.getByLabelText('Saved extraction'), scan.id); await user.click(screen.getByRole('button', { name: 'Open saved extraction' }));
  await user.click(await screen.findByText('Adopt a corrected excerpt as a package value', { selector: 'summary' }));
  await user.type(screen.getByLabelText('Recognized package value label'), 'Training note'); await user.type(screen.getByLabelText('Recognized package value excerpt'), 'training evidence');
  await user.click(screen.getByRole('button', { name: 'Review recognized package value' }));
  const adopt = await screen.findByRole('button', { name: 'Adopt reviewed package value' }); expect(adopt).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed this excerpt/ })); await user.click(adopt);
  await waitFor(() => expect(applied).toHaveBeenCalledTimes(2));
  expect(getPackageRevision(applied.mock.calls[1][0]).information!.facts[0]).toMatchObject({ label: 'Training note', value: 'training evidence' });
});
it('discards unfinished text and reports parent operation failures without committing', async () => {
  const record = await fixture(), user = userEvent.setup(), onApply = vi.fn();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true, onApply };
  const view = render(<PackageScanPanel {...props} />);
  await user.selectOptions(screen.getByLabelText('Captured scan source'), getPackageRevision(record).members[0].id); await user.click(screen.getByRole('button', { name: 'Recognize captured source' }));
  await user.click(await screen.findByRole('button', { name: 'Discard extraction changes' })); expect(screen.queryByLabelText('Corrected source text')).toBeNull();
  view.rerender(<PackageScanPanel {...props} run={async () => { throw new Error('Operation unavailable'); }} />);
  await user.click(screen.getByRole('button', { name: 'Recognize captured source' })); expect(await screen.findByRole('alert')).toHaveTextContent('Operation unavailable'); expect(onApply).not.toHaveBeenCalled();
  view.rerender(<PackageScanPanel {...props} disabled />); expect(screen.getByRole('button', { name: 'Recognize captured source' })).toBeDisabled();
});

it('cancels extraction publication when the parent becomes read-only during save', async () => {
  const record = await fixture(), user = userEvent.setup(), onApply = vi.fn();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true, onApply };
  const view = render(<PackageScanPanel {...props} />);
  await user.selectOptions(screen.getByLabelText('Captured scan source'), getPackageRevision(record).members[0].id);
  await user.click(screen.getByRole('button', { name: 'Recognize captured source' }));
  await user.click(await screen.findByRole('button', { name: 'Review corrected extraction' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed the exact source, all corrected pages/ }));
  let finish!: (value: typeof policy) => void;
  vi.mocked(classification.getExportDeploymentPolicy).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await user.click(screen.getByRole('button', { name: 'Save reviewed extraction' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<PackageScanPanel {...props} disabled />); finish(policy);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Recognize scanned evidence' })).toHaveAttribute('aria-busy', 'false'));
  expect(onApply).not.toHaveBeenCalled();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
  view.rerender(<PackageScanPanel {...props} />);
  expect(screen.queryByRole('button', { name: 'Save reviewed extraction' })).toBeNull();
});


it('lets a read-only view discard an unfinished package-value adoption without changing saved content', async () => {
  const initial = await fixture(), scan = await preparePackageScan(initial, getPackageRevision(initial).members[0].id, policy);
  const record = await savePreparedPackageScan(await preparePackageScanCorrection(scan, scan.scan.pages.map(page => page.text), policy), policy, true);
  const user = userEvent.setup(), dirty = vi.fn(), onApply = vi.fn();
  const props = { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(),
    signal: () => undefined, isCurrent: () => true, onApply, onDirtyChange: dirty };
  const view = render(<PackageScanPanel {...props} />);
  await user.selectOptions(screen.getByLabelText('Saved extraction'), getPackageRevision(record).scans!.items[0].id);
  await user.click(screen.getByRole('button', { name: 'Open saved extraction' }));
  await user.click(await screen.findByText('Adopt a corrected excerpt as a package value', { selector: 'summary' }));
  await user.type(screen.getByLabelText('Recognized package value label'), 'Synthetic local label');
  await user.type(screen.getByLabelText('Recognized package value excerpt'), 'Synthetic recognized text');
  expect(dirty).toHaveBeenLastCalledWith(true);
  view.rerender(<PackageScanPanel {...props} disabled />);
  const discard = screen.getByRole('button', { name: 'Discard package-value adoption' });
  expect(discard).toBeEnabled(); await user.click(discard);
  expect(dirty).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText('Saved extraction')).toBeEnabled();
  expect(onApply).not.toHaveBeenCalled(); expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
  view.rerender(<PackageScanPanel {...props} />);
  await user.click(screen.getByText('Adopt a corrected excerpt as a package value', { selector: 'summary' }));
  expect(screen.getByLabelText('Recognized package value label')).toHaveValue('');
  expect(screen.getByLabelText('Recognized package value excerpt')).toHaveValue('');
});
