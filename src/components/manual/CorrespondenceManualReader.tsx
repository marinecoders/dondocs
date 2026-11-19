import { ManualViewBoundary } from './ManualViewBoundary';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CORRESPONDENCE_MANUAL as source, findManualMatch, findManualParagraphMatch, loadManualResource, locateManualPage, parseCorrespondenceManual, searchCorrespondenceManual, type CorrespondenceManual, type ManualLocation, type ManualMatch } from '@/lib/correspondenceManual';
import { useCorrespondenceManualStore } from '@/stores/correspondenceManualStore';
import { triggerDownload } from '@/lib/encoding';

const SourcePage = lazy(() => import('./ManualSourcePage'));

function scrollToMatch(region: HTMLDivElement | null): void {
  const match = region?.querySelector('mark');
  if (region && match) {
    region.scrollTop += match.getBoundingClientRect().top - region.getBoundingClientRect().top - region.clientHeight / 3;
    // Narrow screens can clip the reading region inside the guide's own scroll area.
    match.scrollIntoView?.({ block: 'nearest' });
  }
}

function Highlight({ text, query, paragraphMatch }: { text: string; query: string; paragraphMatch?: ManualMatch }) {
  const match = findManualMatch(text, query) ?? paragraphMatch;
  return !match ? text : <>{text.slice(0, match.start)}<mark className="rounded bg-primary/15 text-foreground">{text.slice(match.start, match.end)}</mark>{text.slice(match.end)}</>;
}

export default function CorrespondenceManualReader() {
  const request = useCorrespondenceManualStore(state => state.request);
  const location = useCorrespondenceManualStore(state => state.location);
  const [manual, setManual] = useState<CorrespondenceManual>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    loadManualResource('text', controller.signal).then(result => {
      const parsed = parseCorrespondenceManual(result.bytes);
      controller.signal.throwIfAborted();setManual(parsed);setCached(result.cached);setError('');
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The manual could not be loaded.'); });
    return () => controller.abort();
  }, [retry]);
  if (!manual) return <div className="p-4">{error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => { setError('');setRetry(value => value + 1); }}>Retry manual</Button></> : <p role="status" className="text-sm text-muted-foreground">Loading correspondence manual…</p>}</div>;
  return <ManualContent key={request} manual={manual} cached={cached} location={location} />;
}

function ManualContent({ manual, cached, location }: { manual: CorrespondenceManual; cached: boolean; location: ManualLocation }) {
  const [pageNumber, setPageNumber] = useState(() => locateManualPage(manual, location).page);
  const [query, setQuery] = useState(location.query?.slice(0, 160) ?? '');
  const [searched, setSearched] = useState(location.query?.slice(0, 160) ?? '');
  const [showResults, setShowResults] = useState(false);
  const [locatorMissing, setLocatorMissing] = useState(() => !locateManualPage(manual, location).foundParagraph);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdf, setPdf] = useState<Uint8Array>();
  const [pdfError, setPdfError] = useState('');
  const [pdfCached, setPdfCached] = useState(false);
  const pdfAbort = useRef<AbortController | null>(null);
  const reading = useRef<HTMLHeadingElement>(null);
  const readingRegion = useRef<HTMLDivElement>(null);

  useEffect(() => () => pdfAbort.current?.abort(), []);
  useEffect(() => {
    if (!location.query && !location.paragraph) return;
    scrollToMatch(readingRegion.current);
  }, [location]);
  const result = useMemo(() => searchCorrespondenceManual(manual, searched), [manual, searched]);
  const page = manual.pages[pageNumber - 1];
  const section = manual.sections.find(section => section.id === page?.section);
  const sourcePage = locateManualPage(manual, location);
  const paragraphMatch = !searched && location.paragraph && sourcePage.foundParagraph && sourcePage.page === pageNumber
    ? findManualParagraphMatch(page.text, location.paragraph) : undefined;
  const focusReading = (showMatch: boolean) => {
    const origin = document.activeElement;
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused !== origin && focused !== document.body && focused !== reading.current) return;
      if (readingRegion.current) readingRegion.current.scrollTop = 0;
      if (showMatch) scrollToMatch(readingRegion.current);
      reading.current?.focus({ preventScroll: true });
    });
  };
  const moveToPage = (number: number, showMatch = false) => {
    setPageNumber(number);
    setShowResults(false);
    setLocatorMissing(false);
    focusReading(showMatch);
  };
  const closePdf = () => {
    pdfAbort.current?.abort();
    setPdfOpen(false);
    setPdfError('');
    focusReading(true);
  };
  const openPdf = async () => {
    setPdfOpen(true);setPdfError('');
    if (pdf) return;
    pdfAbort.current?.abort();const controller = new AbortController();pdfAbort.current = controller;
    try {
      const resource = await loadManualResource('pdf', controller.signal);
      if (!controller.signal.aborted) { setPdf(resource.bytes);setPdfCached(resource.cached); }
    } catch (error) { if (!controller.signal.aborted) setPdfError(error instanceof Error ? error.message : 'The original PDF could not be loaded.'); }
  };

  return <section aria-label="Correspondence manual" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">{source.shortTitle}</h2>
        <p className="text-xs text-muted-foreground">{source.edition}. Bundled reference edition; currentness has not been established.</p>
        <p className="mt-1 text-xs text-muted-foreground">{cached ? 'Reference text saved for offline reading in this browser.' : 'Reference text is available in this session; persistent offline storage is unavailable.'}</p>
      </div>
      {pdfOpen ? <>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={closePdf}>Back to reference text</Button>
          {pdf && <Button size="sm" variant="outline" onClick={() => triggerDownload(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'SECNAV-M-5216.5-CH1.pdf')}>Download original PDF</Button>}
        </div>
        {pdfError ? <p role="alert" className="text-sm text-destructive">{pdfError}</p> : pdf ? <>
          <p className="text-xs text-muted-foreground">{pdfCached ? 'Original PDF saved in this browser.' : 'Original PDF is available in this session only.'}</p>
          <ManualViewBoundary fallback={<p role="alert" className="text-sm">The source viewer could not load. Use the reference text or download the original PDF.</p>}>
            <Suspense fallback={<p role="status" className="text-sm">Opening source viewer…</p>}><SourcePage bytes={pdf} page={pageNumber} onPage={setPageNumber} /></Suspense>
          </ManualViewBoundary>
        </> : <p role="status" className="text-sm">Loading original PDF…</p>}
      </> : <>
        <form onSubmit={event => { event.preventDefault();setSearched(query.trim());setShowResults(true); }} className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">Search manual
            <Input className="mt-1" type="search" value={query} maxLength={160} onChange={event => setQuery(event.target.value)} placeholder="For example, enclosure markings" />
          </label>
          <Button type="submit" variant="outline" disabled={query.trim().length < 2}>Search</Button>
        </form>
        <label className="block text-sm">Chapter or appendix
          <select className="mt-1 w-full min-w-0 rounded-md border bg-background px-2 py-2 text-sm" value={page?.section} onChange={event => { const target = manual.sections.find(section => section.id === event.target.value);if (target) moveToPage(target.firstPage); }}>
            {manual.sections.map(section => <option key={section.id} value={section.id}>{section.id === 'front' ? section.title : /^\d+$/.test(section.id) ? `Chapter ${section.id} — ${section.title}` : `Appendix ${section.id} — ${section.title}`}</option>)}
          </select>
        </label>
        {showResults ? <div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm">{result.total} matching page{result.total === 1 ? '' : 's'}{result.total > 50 ? '; showing the first 50. Refine your search.' : '.'}</p><Button size="sm" variant="ghost" onClick={() => moveToPage(pageNumber)}>Return to reading</Button></div>
          <ul className="mt-2 divide-y" aria-label="Manual search results">{result.results.map(result => <li key={result.page}><button className="w-full rounded-sm px-1 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => moveToPage(result.page, true)}>
            <span className="block text-sm font-medium">Page {result.label} · PDF page {result.page}</span>
            <span className="mt-1 block break-words text-xs text-muted-foreground"><Highlight text={result.excerpt} query={searched} /></span>
          </button></li>)}</ul>
        </div> : page && <>
          {locatorMissing && <p role="status" className="text-sm text-muted-foreground">The requested paragraph locator was not found. The chapter is open for inspection.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 ref={reading} tabIndex={-1} className="text-sm font-semibold outline-none">{section?.title} · Page {page.label}</h3>
            <Button variant="outline" size="sm" onClick={() => void openPdf()}>View original PDF page {page.number}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Extracted source text, PDF page {page.number} of {source.pages}. Inspect the original page for figures, tables and exact layout.</p>
          <div ref={readingRegion} role="region" aria-label={`Manual text page ${page.label}`} tabIndex={0} className="max-h-[45dvh] overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Highlight text={page.text} query={searched} paragraphMatch={paragraphMatch} /></div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" size="sm" disabled={page.number <= 1} onClick={() => moveToPage(page.number - 1)}>Previous page</Button>
            <Button variant="outline" size="sm" disabled={page.number >= source.pages} onClick={() => moveToPage(page.number + 1)}>Next page</Button>
          </div>
        </>}
      </>}
      <p className="border-t pt-3 text-xs text-muted-foreground"><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Issuing-site source PDF</a> · Search reads text extracted from this unchanged PDF.</p>
    </div>
  </section>;
}
