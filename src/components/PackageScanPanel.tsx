import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from './pdf/pdfConfig';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { preparePackageScan, openPackageScan, copyPreparedPackageScanSource, preparePackageScanCorrection, savePreparedPackageScan,
  preparePackageScanFact, packageScanIsCurrent, type PreparedPackageScan, type PreparedPackageScanCorrection } from '@/lib/packageScans';
import type { ScanProgress } from '@/lib/scannedImport';
import { applyPreparedPackageUpdate, type PreparedPackageUpdate } from '@/lib/packageUpdates';
import { getExportDeploymentPolicy } from '@/config/classification';
import { PackageChangeImpactSummary } from './PackageChangeImpactSummary';

interface Props { record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  run(action: () => Promise<void>): Promise<void>; signal(): AbortSignal | undefined; isCurrent(): boolean;
  onApply(record: ActionPackage): void; onDirtyChange?(dirty: boolean): void;
}
const input = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm', button = 'h-auto min-h-9 max-w-full whitespace-normal';
export function PackageScanPanel(props: Props) { return <PackageScanView key={`${props.record.id}:${props.record.sequence}:${props.revision.id}`} {...props} />; }
function PackageScanView({ record, revision, disabled, busy, run, signal, isCurrent, onApply, onDirtyChange }: Props) {
  const heading = useId(), [memberId, setMemberId] = useState(''), [savedId, setSavedId] = useState('');
  const [prepared, setPrepared] = useState<PreparedPackageScan | null>(null), [texts, setTexts] = useState<string[]>([]), [page, setPage] = useState(0);
  const [correction, setCorrection] = useState<PreparedPackageScanCorrection | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [factLabel, setFactLabel] = useState(''), [excerpt, setExcerpt] = useState(''), [adoption, setAdoption] = useState<PreparedPackageUpdate | null>(null), [adoptedReview, setAdoptedReview] = useState(false);
  const alive = useRef(false), running = useRef(false), generation = useRef(0), dirtyCallback = useRef(onDirtyChange);
  const editable = !disabled && !record.archived && record.currentRevisionId === revision.id && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const latest = useRef({ editable, signal, isCurrent });
  const editability = useRef(editable);
  const textDirty = !!prepared && (!prepared.saved || texts.some((text, index) => text !== prepared.scan.pages[index].text));
  const dirty = textDirty || !!factLabel || !!excerpt || !!adoption;
  const locked = busy || pending;
  useLayoutEffect(() => { latest.current = { editable, signal, isCurrent }; });
  useLayoutEffect(() => {
    if (editability.current === editable) return;
    editability.current = editable;
    if (!editable) {
      const captured = ++generation.current;
      queueMicrotask(() => { if (alive.current && generation.current === captured) { setCorrection(null); setAcknowledged(false); setAdoption(null); setAdoptedReview(false); } });
    }
  }, [editable]);
  useLayoutEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  function invalidate() { generation.current++; setCorrection(null); setAcknowledged(false); setAdoption(null); setAdoptedReview(false); setError(''); }
  async function perform(action: (current: () => boolean) => Promise<void>, writing = false) {
    if (locked || running.current || writing && !editable) return;
    const captured = generation.current;
    running.current = true; setPending(true); setError('');
    try { await run(async () => {
      const operationSignal = signal(), current = () => alive.current && captured === generation.current && latest.current.isCurrent()
        && (!writing || latest.current.editable) && latest.current.signal() === operationSignal && !operationSignal?.aborted;
      try { if (current()) await action(current); }
      catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The captured evidence could not be processed.'); }
    }); }
    catch (cause) { if (alive.current && captured === generation.current && latest.current.isCurrent()) setError(cause instanceof Error ? cause.message : 'The captured evidence could not be processed.'); }
    finally { running.current = false; if (alive.current) { setPending(false); setProgress(null); } }
  }
  const sources = revision.members.filter(member => member.kind !== 'native' && ['application/pdf', 'image/png', 'image/jpeg'].includes(member.original.type));
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded border bg-background p-2 sm:p-4">
    <h3 id={heading} className="font-medium">Recognize scanned evidence</h3>
    <p className="text-sm text-muted-foreground">Read a captured PDF or photo locally, compare the words with its exact source and save corrections. Adding recognized text to package information is a separate reviewed action.</p>
    {!editable && <p className="text-xs text-muted-foreground">This view can inspect saved extractions. Recognition and corrections use the current owning revision.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm">Captured scan source<select aria-label="Captured scan source" className={input} value={memberId} disabled={locked || dirty || !editable} onChange={event => { invalidate(); setPrepared(null); setMemberId(event.target.value); }}><option value="">Choose a saved PDF or image</option>{sources.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>
      <Button className={button} disabled={locked || dirty || !editable || !memberId} onClick={() => void perform(async current => {
        const value = await preparePackageScan(record, memberId, await getExportDeploymentPolicy(), signal(), value => { if (current()) setProgress(value); });
        if (current()) { setPrepared(value); setTexts(value.scan.pages.map(page => page.text)); setPage(0); setProgress(null); }
      }, true)}>Recognize captured source</Button></div>
    {!!revision.scans?.items.length && <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm">Saved extraction<select aria-label="Saved extraction" className={input} disabled={locked || dirty} value={savedId} onChange={event => { invalidate(); setSavedId(event.target.value); }}><option value="">Choose saved recognized text</option>{revision.scans.items.map(scan => <option key={scan.id} value={scan.id}>{scan.memberLabel} · {scan.status}{packageScanIsCurrent(scan, revision) ? '' : ' · earlier source'}</option>)}</select></label>
      <Button className={button} variant="outline" disabled={locked || dirty || !savedId} onClick={() => void perform(async current => {
        const value = await openPackageScan(record, savedId, await getExportDeploymentPolicy(), signal(), revision.id);
        if (current()) { setPrepared(value); setTexts(value.scan.pages.map(page => page.text)); setPage(0); }
      })}>Open saved extraction</Button></div>}
    {progress && <p role="status" className="text-sm">{progress.page > 0 ? `Recognizing page ${progress.page} of ${progress.total} · ${Math.round(progress.fraction * 100)}%` : 'Preparing local recognition engine…'}</p>}
    {prepared && <div className="min-w-0 space-y-3">
      <p className="break-words text-sm font-medium">{prepared.scan.source.name} · {prepared.scan.status}</p>
      {!packageScanIsCurrent(prepared.scan, revision) && <p role="status" className="text-sm">This text belongs to an earlier captured file. Its original is preserved; adopting a current package value requires the matching source member.</p>}
      {prepared.scan.pages.length > 1 && <label className="block text-sm">Source page<select aria-label="Recognized source page" className={input} value={page} disabled={locked} onChange={event => setPage(Number(event.target.value))}>{prepared.scan.pages.map((item, index) => <option key={item.page} value={index}>Page {item.page}</option>)}</select></label>}
      <div className="grid min-w-0 gap-3 md:grid-cols-2"><ScanSource prepared={prepared} page={page} /><div className="min-w-0 space-y-2">
        <label className="block text-sm">Corrected source text<textarea aria-label="Corrected source text" className={input} rows={12} readOnly={!editable} disabled={locked} maxLength={500000} value={texts[page] ?? ''} onChange={event => { invalidate(); setTexts(items => items.map((text, index) => index === page ? event.target.value : text)); }} /></label>
        <details><summary className="cursor-pointer text-xs">Original recognized words</summary><p className="whitespace-pre-wrap break-words text-xs">{prepared.scan.pages[page].recognizedText || "No text recognized on this page."}</p></details>
        <p className="text-xs text-muted-foreground">Recognizer confidence: {Math.round(prepared.scan.pages[page].confidence)}%. Compare the words with the source before using them.</p>
      </div></div>
      {textDirty && <div className="flex flex-wrap gap-2">{editable && <Button className={button} disabled={locked} onClick={() => void perform(async current => { const value = await preparePackageScanCorrection(prepared, texts, await getExportDeploymentPolicy(), signal()); if (current()) { setCorrection(value); setAcknowledged(false); } }, true)}>Review corrected extraction</Button>}
        <Button className={button} variant="outline" disabled={locked} onClick={() => { invalidate(); setPrepared(null); setTexts([]); setFactLabel(''); setExcerpt(''); }}>Discard extraction changes</Button></div>}
      {correction && <div className="min-w-0 space-y-2 rounded border p-2 text-sm">{correction.reviews.flatMap(review => [...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.value}`)]).map((notice, index) => <p key={index} className="break-words">{notice}</p>)}
        <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the exact source, all corrected pages and privacy findings.</label>
        <Button className={button} disabled={locked || !acknowledged} onClick={() => void perform(async current => { const saved = await savePreparedPackageScan(correction, await getExportDeploymentPolicy(), acknowledged, signal(), current); if (current()) { dirtyCallback.current?.(false); onApply(saved); } }, true)}>Save reviewed extraction</Button>
      </div>}
      {editable && prepared.saved && !textDirty && packageScanIsCurrent(prepared.scan, revision) && <details className="min-w-0 rounded border p-2"><summary className="cursor-pointer text-sm font-medium">Adopt a corrected excerpt as a package value</summary><div className="min-w-0 space-y-2 pt-2 text-sm">
        <label className="block">Package value label<input aria-label="Recognized package value label" className={input} maxLength={160} value={factLabel} disabled={locked} onChange={event => { invalidate(); setFactLabel(event.target.value); }} /></label>
        <label className="block">Exact corrected excerpt<textarea aria-label="Recognized package value excerpt" className={input} rows={3} maxLength={10000} value={excerpt} disabled={locked} onChange={event => { invalidate(); setExcerpt(event.target.value); }} /></label>
        <Button className={button} variant="outline" disabled={locked || !factLabel.trim() || !excerpt.trim()} onClick={() => void perform(async current => { const value = await preparePackageScanFact(record, prepared.scan.id, page + 1, factLabel, excerpt, await getExportDeploymentPolicy(), signal()); if (current()) { setAdoption(value); setAdoptedReview(false); } }, true)}>Review recognized package value</Button>
        {adoption && <div className="min-w-0 space-y-2">{adoption.impact && <PackageChangeImpactSummary impact={adoption.impact} disabled={locked} />}{adoption.reviews.flatMap(review => review.privacy.findings).map((finding, index) => <p key={index} className="break-words">{finding.type}: {finding.value}</p>)}
          <label className="flex items-start gap-2"><input type="checkbox" checked={adoptedReview} disabled={locked} onChange={event => setAdoptedReview(event.target.checked)} />I reviewed this excerpt, its source and package-value changes.</label>
          <Button className={button} disabled={locked || !adoption.ready || !adoptedReview} onClick={() => void perform(async current => { const saved = await applyPreparedPackageUpdate(adoption, await getExportDeploymentPolicy(), adoptedReview, signal(), current); if (current()) { dirtyCallback.current?.(false); onApply(saved.record); } }, true)}>Adopt reviewed package value</Button>
        </div>}
      </div></details>}
      {(factLabel || excerpt) && <Button className={button} variant="outline" disabled={locked} onClick={() => { invalidate(); setFactLabel(''); setExcerpt(''); }}>Discard package-value adoption</Button>}
    </div>}
  </section>;
}
function ScanSource({ prepared, page }: { prepared: PreparedPackageScan; page: number }) {
  const [source, setSource] = useState<{ prepared: PreparedPackageScan; url: string } | null>(null);
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(200);
  useEffect(() => { const node = container.current; if (!node) return; const observer = new ResizeObserver(entries => { const measured = entries[0]?.contentRect.width; if (measured && measured > 0) setWidth(Math.floor(measured)); }); observer.observe(node); return () => observer.disconnect(); }, []);
  useEffect(() => { let active = true; const url = URL.createObjectURL(copyPreparedPackageScanSource(prepared)); queueMicrotask(() => { if (active) setSource({ prepared, url }); }); return () => { active = false; URL.revokeObjectURL(url); }; }, [prepared]);
  const url = source?.prepared === prepared ? source.url : '';
  return <div ref={container} className="flex h-96 min-w-0 flex-col gap-2 overflow-hidden rounded border p-2"><p className="shrink-0 text-sm font-medium">Exact captured source · page {page + 1}</p>
    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block shrink-0 text-sm underline underline-offset-2">Open captured scan at full size</a>}
    <div role="region" aria-label="Captured source preview" tabIndex={0} className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {url && (prepared.scan.source.type === 'application/pdf' ? <Document file={url} options={HARDENED_PDF_OPTIONS} loading="Opening captured source…" error="The captured source preview could not be rendered."><Page pageNumber={page + 1} width={width} renderAnnotationLayer={false} renderTextLayer={false} /></Document>
        : <img src={url} alt={`Captured source: ${prepared.scan.source.name}`} className="h-full max-w-full object-contain" />)}
    </div>
  </div>;
}
