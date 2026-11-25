import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { ReviewedPrintableCopy } from '@/lib/packagePrintableCopy';
import type { PackageMember } from '@/lib/actionPackages';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import { assertAssemblyPagesReadable, loadAssemblyPdf } from '@/services/pdf/assemblyPdf';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { reviewPackageOriginal } from '@/lib/actionPackageDisclosure';
import { Button } from './ui/button';
import { PackagePdfCompatibility } from './PackagePdfCompatibility';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Original = Extract<PackageMember, { kind: 'original' }>;

async function originalPageCount(member: Original) {
  const pdf = await PDFDocument.load(await readPackageAsset(member.original));
  const form = pdf.catalog.lookup(PDFName.of('AcroForm'));
  if (form instanceof PDFDict && form.has(PDFName.of('XFA'))) return undefined;
  return pdf.getPageCount();
}

function Candidate({ file, member, disabled, savedPreview, onAccept, onCancel }: {
  file: File; member: Original; disabled: boolean; savedPreview(original: boolean): ReactNode; onAccept(copy: ReviewedPrintableCopy): void; onCancel(): void;
}) {
  const [result, setResult] = useState<{ url: string; count: number; original?: number; copy: ReviewedPrintableCopy }>();
  const [error, setError] = useState('');
  const [painted, setPainted] = useState(false);
  const [original, setOriginal] = useState(false);
  const onPagePaint = useCallback((success: boolean) => {
    setPainted(success);
    if (!success) setError('A printable page could not be displayed. Choose another PDF.');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let url: string | undefined;
    void (async () => {
      if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF up to 25 MB.');
      const policy = await getExportDeploymentPolicy();
      if (policy.status !== 'ready') throw new Error(policy.message);
      const bytes = await file.arrayBuffer();
      await reviewPackageOriginal(bytes, file.name, policy);
      const { pdf } = await loadAssemblyPdf(bytes, signal);
      if (!pdf.getPageCount()) throw new Error('The printable PDF has no pages.');
      await assertAssemblyPagesReadable(pdf, signal);
      const pages = await PDFDocument.create();
      for (const page of await pages.copyPages(pdf, pdf.getPageIndices())) pages.addPage(page);
      const preview = await pages.save();
      const count = await originalPageCount(member).catch(() => undefined);
      signal.throwIfAborted();
      const current = getExportDeploymentPolicySync();
      if (current.status !== 'ready' || current.policy.identity !== policy.policy.identity) throw new Error('Preview policy changed. Choose the file again.');
      url = URL.createObjectURL(new Blob([new Uint8Array(preview)], { type: 'application/pdf' }));
      setResult({ url, count: pages.getPageCount(), original: count,
        copy: { file: new File([bytes], file.name, { type: 'application/pdf' }), policyIdentity: policy.policy.identity } });
    })().catch(cause => { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not preview this PDF.'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file, member]);
  const mismatch = result?.original !== undefined && result.original !== result.count;
  const countLabel = result && result.count + (result.count === 1 ? ' page' : ' pages');
  return <section className="space-y-2" aria-label="Review printable pages">
    <p className="font-medium">{original ? 'Original PDF · ' + member.original.name : 'Pages for combined PDF · ' + file.name}</p>
    {result && <p role="status">{result.original === undefined ? 'Original page count unavailable.' : 'Original: ' + result.original + (result.original === 1 ? ' page.' : ' pages.')} Printable copy: {countLabel}.</p>}
    {error && <p role="alert">{error}</p>}
    {original ? savedPreview(true) : result ? <div className="h-[55dvh] min-h-72">
      <Suspense fallback={<p role="status">Opening PDF…</p>}><PdfViewer pdfUrl={result.url} showFullscreen={false} allowOpenInTab={false} toolbarLabel={file.name} onPagePaint={onPagePaint} /></Suspense>
    </div> : !error && <p role="status">Preparing printable pages…</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={disabled || original || !result || !painted || !!error} onClick={() => result && onAccept(result.copy)}>{mismatch ? 'Use ' + countLabel + ' anyway' : 'Use these pages'}</Button>
      <Button size="sm" variant="outline" onClick={() => { setPainted(false); setOriginal(value => !value); }}>{original ? 'View printable pages' : 'View original'}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  </section>;
}

export function PackagePrintableCopyField({ member, editable, disabled, onChange, savedPreview }: {
  member: Original; editable: boolean; disabled: boolean; onChange(copy: ReviewedPrintableCopy | null): void; savedPreview(original: boolean): ReactNode;
}) {
  const [candidate, setCandidate] = useState<{ id: number; file: File }>();
  const copy = member.printableCopy?.asset;
  return <section className="space-y-2 text-sm" aria-label="Printable PDF">
    {copy ? <p>Combined PDF uses <strong>{copy.name}</strong>. The original is {member.original.name}.</p>
      : <PackagePdfCompatibility source={member.original} />}
    {editable && <details onToggle={event => { if (!event.currentTarget.open) setCandidate(undefined); }}><summary className="cursor-pointer">{copy ? 'Manage printable copy' : 'Add printable copy'}</summary>
      <fieldset disabled={disabled} className="mt-2 space-y-2">
        <label className="block">Printable PDF for {member.original.name}
          <input data-printable-input className="mt-1 block" type="file" accept=".pdf,application/pdf" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) setCandidate(prev => ({ id: (prev?.id ?? 0) + 1, file }));
          }} />
        </label>
        {candidate && <Candidate key={candidate.id} file={candidate.file} member={member} disabled={disabled} savedPreview={savedPreview}
          onAccept={onChange} onCancel={() => setCandidate(undefined)} />}
        {!candidate && copy && <Button size="sm" variant="outline" onClick={() => onChange(null)}>Remove printable copy</Button>}
      </fieldset></details>}
    {!candidate && savedPreview(false)}
  </section>;
}
