/**
 * The letter card: what a host that renders MCP Apps shows in place of the
 * render result. It reads the file back through the `dondocs://files/{out}`
 * resource, shows a PDF one page at a time inline and every page in
 * fullscreen, and offers the bytes to the host's download flow. Everything
 * it needs is in this file once built; the sandbox loads nothing from the
 * network.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import * as pdfjs from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import { base64Of, bytesOf, fileOf, fileUri, fitScale, MIME, mostVisible, nameOf, sizeOf, titleOf, type RenderedFile } from './card';

// The sandbox's policy allows no worker, so pdf.js runs on its main thread:
// with the worker module already here it creates none.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const title = el<HTMLDivElement>('title');
const meta = el<HTMLDivElement>('meta');
const icon = el<HTMLDivElement>('icon');
const status = el<HTMLDivElement>('status');
const download = el<HTMLButtonElement>('download');
const expand = el<HTMLButtonElement>('expand');
const preview = el<HTMLDivElement>('preview');
const stage = el<HTMLDivElement>('stage');
const pager = el<HTMLDivElement>('pager');
const pageno = el<HTMLSpanElement>('pageno');
const prev = el<HTMLButtonElement>('prev');
const next = el<HTMLButtonElement>('next');

/** Drawn pages kept, across both layouts; each is tens of megabytes. */
const CACHE = 30;
/**
 * The page's height on screen inline when the host does not say how tall
 * the frame may be. The desktop app sizes the frame from an early reading
 * of the document and does not follow later growth, so the inline card is
 * one page tall with its controls in the header, and never grows.
 */
const DEFAULT_PAGE_HEIGHT = 900;
/** A page's width in fullscreen, where the frame is the window. */
const FULLSCREEN_PAGE_WIDTH = 900;
/**
 * Pages the fullscreen stage draws. Each canvas is a page at device
 * resolution, some sixteen megabytes on a retina screen, so a long report
 * drawn whole would exhaust the frame; the rest are in the file itself.
 */
const STAGE_PAGES = 20;

type Mode = 'inline' | 'fullscreen';

// Declared here so the host offers only what the page can do, as the spec
// requires; the host lists what it offers back in its context.
const app = new App({ name: 'dondocs-letter', version: __APP_VERSION__ }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });

const applyTheme = (theme: string | undefined) => {
  if (theme === 'dark' || theme === 'light') { document.documentElement.dataset.theme = theme; }
  else { delete document.documentElement.dataset.theme; }
};

/** The composer overlays the bottom of the frame; keep the last page clear of it. */
const applySafeArea = (insets: { bottom?: number } | undefined) => {
  document.documentElement.style.setProperty('--safe-bottom', `${(insets?.bottom ?? 0) + 16}px`);
};

const hostOffersFullscreen = (): boolean => app.getHostContext()?.availableDisplayModes?.includes('fullscreen') ?? false;

/**
 * A turn of the event loop, so a style change and the host's own resize are
 * settled before sizes are read. Deliberately not requestAnimationFrame: a
 * browser withholds frames from a document it is not displaying, and this
 * card is often off-screen in a long conversation, which would leave the
 * switch half-done forever.
 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The page width in the fullscreen stage, never tiny even before layout settles. */
const stageWidth = (): number => Math.min(FULLSCREEN_PAGE_WIDTH, Math.max(320, stage.clientWidth - 32));

let subject: string | undefined;
let current: { file: RenderedFile; bytes: Uint8Array } | undefined;
let doc: pdfjs.PDFDocumentProxy | undefined;
let pageNo = 1;
let mode: Mode = 'inline';
let stageToken = 0;
const drawn = new Map<string, HTMLCanvasElement>();
// Where the page last scrolled the stage itself. The scroll handler
// compares against it rather than against a window of time: a reader who
// scrolls while the pages are still drawing is answered, not swallowed.
let scrolledTo: number | undefined;
// Set once the reader scrolls, so a build still drawing stops putting them
// back where it started.
let scrolledByUser = false;

app.ontoolinput = ({ arguments: args }) => {
  const s = (args as { subject?: unknown } | undefined)?.subject;
  subject = typeof s === 'string' && s.trim() ? s.trim() : undefined;
  if (subject) { title.textContent = subject; }
};

app.ontoolresult = (result) => { void show(result); };
// A change notification carries only what changed; read only what is there.
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) { applyTheme(ctx.theme); }
  if (ctx.safeAreaInsets) { applySafeArea(ctx.safeAreaInsets); }
  if (ctx.availableDisplayModes) { expand.hidden = !doc || !hostOffersFullscreen(); }
  if (ctx.displayMode) { void enterMode(ctx.displayMode); }
};

download.addEventListener('click', async () => {
  if (!current) { return; }
  download.disabled = true;
  try {
    const { file, bytes } = current;
    const { isError } = await app.downloadFile({
      contents: [{ type: 'resource', resource: { uri: `file:///${nameOf(file.out)}`, mimeType: MIME[file.format], blob: base64Of(bytes) } }],
    });
    status.textContent = isError ? 'Download cancelled.' : 'Saved.';
  } catch (err) {
    status.textContent = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    download.disabled = false;
  }
});

async function show(result: Parameters<NonNullable<App['ontoolresult']>>[0]): Promise<void> {
  const file = fileOf(result);
  if (!file) {
    title.textContent = 'The letter did not render';
    status.textContent = (result.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' ');
    return;
  }
  title.textContent = subject ?? titleOf(file.out);
  icon.dataset.ext = file.format.toUpperCase();
  meta.textContent = `${file.format.toUpperCase()} · ${sizeOf(file.bytes)}`;
  status.textContent = 'Reading the file';
  try {
    const { contents } = await app.readServerResource({ uri: fileUri(file.out) });
    const content = contents[0];
    if (!content || !('blob' in content) || typeof content.blob !== 'string') { throw new Error('the file resource carried no bytes'); }
    const bytes = bytesOf(content.blob);
    current = { file, bytes };
    download.disabled = false;
    status.textContent = '';
    if (file.format === 'pdf') { await openPdf(bytes); }
  } catch (err) {
    status.textContent = `Preview unavailable: ${err instanceof Error ? err.message : String(err)}. The file is at ${file.path}.`;
  }
}

/** The height the host allows the card inline, when it says (the desktop app says 5000). */
function heightAllowed(): number | undefined {
  const dims = app.getHostContext()?.containerDimensions as { height?: number; maxHeight?: number } | undefined;
  return dims?.height ?? dims?.maxHeight;
}

function hostFacts(): Record<string, unknown> {
  const ctx = app.getHostContext();
  return {
    displayMode: ctx?.displayMode, modes: ctx?.availableDisplayModes, container: ctx?.containerDimensions,
    safeArea: ctx?.safeAreaInsets, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight,
  };
}

async function openPdf(bytes: Uint8Array): Promise<void> {
  // pdf.js takes ownership of the buffer it is handed; copy so the download keeps its own.
  doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  meta.textContent += ` · ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}`;
  drawn.clear();
  await showPage(1);
  if (doc.numPages > 1) { pager.style.display = 'flex'; }
  expand.hidden = !hostOffersFullscreen();
  // The host keeps the page's console; this line says which build drew
  // the card and what the host told it, which nothing else records.
  console.warn(`dondocs card built ${__BUILD_TIME__}: ${doc.numPages} pages, pager ${doc.numPages > 1 ? 'on' : 'off'}, host ${JSON.stringify(hostFacts())}`);
  const wanted = app.getHostContext()?.displayMode;
  if (wanted && wanted !== 'inline') { await enterMode(wanted); }
}

/** A page's scale for the layout in use. */
async function scaleFor(n: number): Promise<{ page: pdfjs.PDFPageProxy; scale: number }> {
  const page = await doc!.getPage(n);
  const natural = page.getViewport({ scale: 1 });
  if (mode === 'fullscreen') { return { page, scale: fitScale(natural, stageWidth()) }; }
  const width = Math.max(320, Math.min(720, document.documentElement.clientWidth - 32));
  // Within the height the host allows, less the header and the margins.
  const allowed = heightAllowed();
  return { page, scale: fitScale(natural, width, allowed ? Math.max(200, allowed - 110) : DEFAULT_PAGE_HEIGHT) };
}

/** The page drawn at the layout's scale, from the cache when it is there. */
async function canvasFor(n: number): Promise<HTMLCanvasElement> {
  const { page, scale } = await scaleFor(n);
  const natural = page.getViewport({ scale: 1 });
  const key = `${n}@${Math.round(natural.width * scale)}`;
  const cached = drawn.get(key);
  if (cached) { return cached; }
  const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${Math.round(natural.width * scale)}px`;
  canvas.setAttribute('aria-label', `Page ${n} of ${doc!.numPages}`);
  // The print intent draws the same page but continues by promise, not by
  // requestAnimationFrame, which a browser withholds from a sandboxed frame
  // it has scrolled out of view; the display intent would then draw only
  // once the card was looked at.
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  drawn.set(key, canvas);
  if (drawn.size > CACHE) { drawn.delete(drawn.keys().next().value!); }
  return canvas;
}

function setPageNo(n: number): void {
  pageNo = n;
  pageno.textContent = `${n} / ${doc!.numPages}`;
  prev.disabled = n <= 1;
  next.disabled = n >= doc!.numPages;
}

/** Inline: one page in the preview. */
async function showPage(n: number): Promise<void> {
  if (!doc) { return; }
  setPageNo(n);
  if (mode === 'fullscreen') { scrollToPage(n); return; }
  status.textContent = `Drawing page ${n}`;
  const canvas = await canvasFor(n);
  // A click during the draw moved on; that page's draw will show itself.
  if (pageNo !== n || mode !== 'inline') { return; }
  status.textContent = '';
  preview.replaceChildren(canvas);
  preview.style.display = 'flex';
}

const slotOf = (n: number): HTMLElement | null => stage.querySelector(`[data-page="${n}"]`);

/**
 * Scroll the stage itself to a page. `offsetTop` (the stage is positioned)
 * is independent of the current scroll, and reading it flushes layout; the
 * scroll handler is held off while the position is set.
 */
function scrollToPage(n: number): void {
  const slot = slotOf(n) as HTMLElement | null;
  if (!slot) { return; }
  // Reading offsetTop flushes layout, so the position is the settled one.
  scrolledTo = slot.offsetTop;
  stage.scrollTop = slot.offsetTop;
  setPageNo(n);
}

/**
 * Fullscreen: every page one under another in the scroll container, drawn
 * in order and appended as each finishes. The container is a fixed height
 * (the frame the host gives), so it scrolls on its own; no page sizing
 * depends on the host following a size notification. A letter is a handful
 * of pages, so drawing them all is cheap and needs no lazy machinery.
 */
async function buildStage(): Promise<void> {
  const token = ++stageToken;
  const wanted = pageNo;
  const shown = Math.min(doc!.numPages, STAGE_PAGES);
  scrolledByUser = false;
  stage.replaceChildren();
  status.textContent = doc!.numPages > shown ? `The first ${shown} pages are shown here; the file has all ${doc!.numPages}.` : '';
  for (let n = 1; n <= shown; n++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.page = String(n);
    stage.appendChild(slot);
    slot.appendChild(await canvasFor(n));
    // A newer render or a return to inline supersedes this build.
    if (token !== stageToken || mode !== 'fullscreen') { return; }
    // Land on the page the reader was on as soon as it exists, and again
    // as the pages below extend the scroll range; but never once the
    // reader has scrolled for themselves.
    if (n >= wanted && !scrolledByUser) { scrollToPage(wanted); }
  }
}

function followScroll(): void {
  if (mode !== 'fullscreen' || !doc) { return; }
  // The page's own scroll, arriving as an event: acknowledge and ignore it.
  if (scrolledTo !== undefined && Math.abs(stage.scrollTop - scrolledTo) < 2) { scrolledTo = undefined; return; }
  scrolledTo = undefined;
  scrolledByUser = true;
  const top = stage.getBoundingClientRect().top;
  const rects = [...stage.children].map((slot) => {
    const r = slot.getBoundingClientRect();
    return { top: r.top - top, bottom: r.bottom - top };
  });
  const n = mostVisible(rects, stage.clientHeight);
  if (n !== pageNo) { setPageNo(n); }
}
stage.addEventListener('scroll', followScroll, { passive: true });

async function applyMode(wanted: string): Promise<void> {
  const target: Mode = wanted === 'fullscreen' ? 'fullscreen' : 'inline';
  if (target === mode || !doc) { return; }
  mode = target;
  if (mode === 'fullscreen') {
    document.documentElement.classList.add('fullscreen');
    // A fixed frame is filled, as the spec has it.
    document.documentElement.style.height = '100vh';
    preview.style.display = 'none';
    expand.hidden = true;
    // Let the frame settle before the stage is measured: the host resizes
    // the outer frame around the same moment, and a stage read too early
    // gives a width of nothing and a scroll range that clamps to the top.
    await settle();
    await buildStage();
  } else {
    document.documentElement.classList.remove('fullscreen');
    document.documentElement.style.height = '';
    stageToken++;
    stage.replaceChildren();
    status.textContent = '';
    expand.hidden = !hostOffersFullscreen();
    await showPage(pageNo);
  }
  console.warn(`dondocs card mode ${mode}: host ${JSON.stringify(hostFacts())}`);
}

/** Switch layout, reporting a failure rather than losing it to an unhandled rejection. */
async function enterMode(wanted: string): Promise<void> {
  try {
    await applyMode(wanted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.textContent = `Could not switch view: ${message}`;
    console.warn(`dondocs card mode ${wanted} failed: ${message}`);
  }
}

/** Ask the host; lay out from what it answers, which may not be what was asked. */
async function requestMode(wanted: Mode): Promise<void> {
  try {
    const { mode: granted } = await app.requestDisplayMode({ mode: wanted });
    await enterMode(granted);
  } catch (err) {
    status.textContent = `The host declined: ${err instanceof Error ? err.message : String(err)}`;
  }
}

expand.addEventListener('click', () => { if (hostOffersFullscreen()) { void requestMode('fullscreen'); } });
prev.addEventListener('click', () => { void showPage(pageNo - 1); });
next.addEventListener('click', () => { void showPage(pageNo + 1); });
document.addEventListener('keydown', (e) => {
  if (!doc) { return; }
  if (e.key === 'Escape' && mode === 'fullscreen') { void requestMode('inline'); return; }
  if (doc.numPages < 2) { return; }
  if (e.key === 'ArrowRight' && pageNo < doc.numPages) { void showPage(pageNo + 1); }
  if (e.key === 'ArrowLeft' && pageNo > 1) { void showPage(pageNo - 1); }
});

app.connect().then(
  () => {
    const ctx = app.getHostContext();
    applyTheme(ctx?.theme);
    applySafeArea(ctx?.safeAreaInsets);
  },
  (err: unknown) => { status.textContent = `Not connected to the host: ${err instanceof Error ? err.message : String(err)}`; },
);
