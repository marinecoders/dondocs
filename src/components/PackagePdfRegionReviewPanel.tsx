import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { FeedbackCategorySelect } from './FeedbackCategorySelect';
import { PackageFormFeedbackImportPanel } from './PackageFormFeedbackImportPanel';
import type { ActionPackage, PackageMember, PackageMemberReview, PackageReviewRound } from '@/lib/actionPackages';
import { addPackagePdfRegionComment, capturePackagePdfRegion, packagePdfRegionSchema, readPackagePdfReviewSource, replyPackagePdfRegion,
  type PackagePdfRegion, type PackagePdfReview } from '@/lib/packagePdfReview';
import type { FeedbackCategory } from '@/lib/reviewFeedback';
const SigningPdfPreview = lazy(() => import('./SigningPdfPreview').then(module => ({ default: module.SigningPdfPreview })));
const input = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const button = 'h-auto min-h-9 max-w-full whitespace-normal';
type Source = Awaited<ReturnType<typeof readPackagePdfReviewSource>>;
const initialBox = { left: '10', top: '10', width: '30', height: '10' };
const percentage = (value: number) => String(Math.round(value * 1000) / 10);

/** Page overlays are separate from the preserved PDF; anchors record exact bytes and displayed crop geometry. */
export function PackagePdfRegionReviewPanel({ record, round, member, child, busy, readOnly, run, signal, onSave, onApply, onDraftChange }: {
  record: ActionPackage; round: PackageReviewRound; member: PackageMember; child?: PackageMemberReview;
  busy: boolean; readOnly: boolean; run(action: () => Promise<void>): Promise<void>; signal?(): AbortSignal | undefined;
  onSave(value: PackagePdfReview): Promise<boolean>; onApply(record: ActionPackage): void; onDraftChange?(dirty: boolean): void;
}) {
  const [source, setSource] = useState<Source | null>(null), [page, setPage] = useState(1), [containerWidth, setContainerWidth] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [author, setAuthor] = useState(''), [text, setText] = useState(''), [category, setCategory] = useState<FeedbackCategory>('question');
  const [box, setBox] = useState(initialBox), [chosen, setChosen] = useState(false), [reply, setReply] = useState<string | null>(null);
  const sourceMember = useRef(member), sourceOwner = member.kind === 'original' ? `${member.id}:${member.original.id}:${member.original.sha256}` : member.id;
  useLayoutEffect(() => { sourceMember.current = member; }, [member]);
  const container = useRef<HTMLDivElement>(null), alive = useRef(false), dirtyCallback = useRef(onDraftChange);
  const drag = useRef<{ x: number; y: number; pointerId: number; previous: typeof initialBox; chosen: boolean } | null>(null);
  const dirty = !!text, locked = busy || pending || readOnly;
  useLayoutEffect(() => { dirtyCallback.current = onDraftChange; }, [onDraftChange]);
  useLayoutEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => {
    let current = true;
    void readPackagePdfReviewSource(sourceMember.current).then(value => { if (current) setSource(value); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'The captured PDF could not be opened.'); });
    return () => { current = false; };
  }, [sourceOwner]);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const resize = () => setContainerWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    resize(); if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }
    const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, []);
  const onReadiness = useCallback((value: boolean) => setReady(value), []);
  const geometry = source?.pages[page - 1], rotated = geometry?.rotation === 90 || geometry?.rotation === 270;
  const ratio = geometry ? (rotated ? geometry.height / geometry.width : geometry.width / geometry.height) : 1;
  const width = Math.max(1, Math.min(containerWidth, 760, 1200 * ratio)), height = width / ratio;
  const parsed = packagePdfRegionSchema.safeParse(Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value.trim() ? Number(value) / 100 : NaN])));
  const region = parsed.success ? parsed.data : null;
  function selectRegion(value: PackagePdfRegion) { setBox({ left: percentage(value.left), top: percentage(value.top), width: percentage(value.width), height: percentage(value.height) }); setChosen(true); }
  async function save(action: () => Promise<boolean>) {
    if (pending || busy || readOnly) return;
    setPending(true); setError('');
    try { if (await action() && alive.current) { setText(''); setReply(null); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The PDF comment could not be saved.'); }
    finally { if (alive.current) setPending(false); }
  }
  const point = (event: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const end = point(event), left = Math.floor(Math.min(drag.current.x, end.x) * 1000) / 1000, top = Math.floor(Math.min(drag.current.y, end.y) * 1000) / 1000;
    selectRegion({ left, top, width: Math.floor(Math.abs(end.x - drag.current.x) * 1000) / 1000, height: Math.floor(Math.abs(end.y - drag.current.y) * 1000) / 1000 });
  };
  return <section aria-label="Original PDF region review" className="min-w-0 space-y-3 rounded border p-2 sm:p-3">
    <h4 className="font-medium">Review original PDF regions</h4>
    <p className="text-xs text-muted-foreground">Choose a physical page, draw a region or enter its percentage bounds, then attach a comment. This overlay preserves the original file and signatures.</p>
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>}
    {!source && !error && <p role="status">Opening exact original PDF…</p>}
    {source && <label className="block text-sm">Original PDF page<select aria-label="Original PDF page for comment" className={input} value={page} disabled={busy || pending || !!reply} onChange={event => { setReady(false); setPage(Number(event.target.value)); setChosen(false); }}>
      {source.pages.map((_, index) => <option key={index} value={index + 1}>Page {index + 1} of {source.pages.length}</option>)}
    </select></label>}
    <div ref={container} className="min-w-0 max-w-full overflow-hidden">
      {source && geometry && containerWidth > 0 && <Suspense fallback={<p>Rendering captured page…</p>}>
        <SigningPdfPreview key={`${page}:${width}:${height}`} data={source.data} page={page - 1} width={width} height={height} onReadiness={onReadiness}>
          <button type="button" aria-label="Draw a region on captured PDF page" disabled={!ready || locked || !!reply} className="absolute inset-0 m-0 cursor-crosshair border-0 bg-transparent p-0" style={{ touchAction: 'none' }}
            onPointerDown={event => { if (event.button !== 0 || drag.current) return; event.preventDefault(); const start = point(event); drag.current = { ...start, pointerId: event.pointerId, previous: box, chosen }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={move} onPointerUp={event => { if (!drag.current || drag.current.pointerId !== event.pointerId) return; move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { if (drag.current) { setBox(drag.current.previous); setChosen(drag.current.chosen); drag.current = null; } }}>
            {chosen && region && <span aria-hidden="true" className="pointer-events-none absolute border-2 border-blue-600 bg-blue-500/15" style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
          </button>
        </SigningPdfPreview>
      </Suspense>}
    </div>
    {!readOnly && <fieldset disabled={locked} className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{reply ? `Reply to saved region discussion` : 'Comment region'}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">{(['left', 'top', 'width', 'height'] as const).map(key => <label key={key} className="min-w-0 text-sm capitalize">{key} %<input aria-label={`PDF region ${key} percent`} className={input} type="number" min="0" max="100" step="0.1" value={box[key]} disabled={!!reply} onChange={event => { setBox(value => ({ ...value, [key]: event.target.value })); setChosen(true); }} /></label>)}</div>
      {chosen && !region && <p className="text-xs text-destructive">Use a nonempty region fully inside the page.</p>}
      <label className="block text-sm">Reviewer name<input aria-label="PDF region reviewer name" className={input} maxLength={100} value={author} onChange={event => setAuthor(event.target.value)} /></label>
      <FeedbackCategorySelect label="PDF region comment category" value={category} onChange={setCategory} />
      <label className="block text-sm">{reply ? 'Reply' : 'Comment'}<textarea aria-label="PDF region comment" className={input} rows={3} maxLength={10000} value={text} onChange={event => setText(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button className={button} disabled={!source || !ready || !region || !chosen || !author.trim() || !text.trim()} onClick={() => void save(async () => {
        if (reply) return onSave(replyPackagePdfRegion(child!.pdfReview!, reply, author, text));
        const anchor = await capturePackagePdfRegion(member, page, region!); return onSave(addPackagePdfRegionComment(child?.pdfReview, anchor, author, text, category));
      })}>{reply ? 'Post PDF region reply' : 'Post PDF region comment'}</Button>
        <Button className={button} variant="outline" disabled={!dirty && !reply} onClick={() => { setText(''); setReply(null); }}>Cancel PDF region comment</Button></div>
    </fieldset>}
    {(child?.pdfReview?.comments ?? []).map(comment => <article key={comment.id} className="min-w-0 space-y-2 rounded border p-2 text-sm">
      <p className="font-medium">Original page {comment.anchor.page} · {comment.resolved ? 'Resolved' : 'Open'}</p>
      <p className="break-words text-xs">Region: {percentage(comment.anchor.region.left)}%, {percentage(comment.anchor.region.top)}% · {percentage(comment.anchor.region.width)}% × {percentage(comment.anchor.region.height)}%</p>
      {comment.messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words"><strong>{message.author}: </strong>{message.text}</p>)}
      <div className="flex flex-wrap gap-2"><Button className={button} variant="outline" disabled={busy || pending || dirty} onClick={() => { if (page !== comment.anchor.page) setReady(false); setPage(comment.anchor.page); selectRegion(comment.anchor.region); setReply(null); }}>View PDF region</Button>
        {!readOnly && <><Button className={button} variant="outline" disabled={locked || dirty} onClick={() => { if (page !== comment.anchor.page) setReady(false); setPage(comment.anchor.page); selectRegion(comment.anchor.region); setReply(comment.id); }}>Reply to PDF region</Button>
          <Button className={button} variant="outline" disabled={locked || dirty} onClick={() => void save(() => onSave({ ...child!.pdfReview!, comments: child!.pdfReview!.comments.map(item => item.id === comment.id ? { ...item, resolved: !item.resolved } : item) }))}>{comment.resolved ? 'Reopen PDF region comment' : 'Resolve PDF region comment'}</Button></>}
      </div>
    </article>)}
    {!readOnly && round.ownerPackageId === record.id && <PackageFormFeedbackImportPanel record={record} roundId={round.id} memberId={member.id} kind="pdf" busy={busy || pending || dirty} run={run} signal={signal} onApply={onApply} />}
  </section>;
}
