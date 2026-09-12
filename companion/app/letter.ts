/**
 * The letter card: what a host that renders MCP Apps shows in place of the
 * render result. It reads the file back through the `dondocs://files/{out}`
 * resource, draws the first page of a PDF, and offers the bytes to the
 * host's download flow. Everything it needs is in this file once built; the
 * sandbox loads nothing from the network.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import * as pdfjs from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import { base64Of, bytesOf, fileOf, fileUri, MIME, nameOf, sizeOf, titleOf, type RenderedFile } from './card';

// The sandbox's policy allows no worker, so pdf.js runs on its main thread:
// with the worker module already here it creates none.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const title = el<HTMLDivElement>('title');
const meta = el<HTMLDivElement>('meta');
const icon = el<HTMLDivElement>('icon');
const status = el<HTMLDivElement>('status');
const download = el<HTMLButtonElement>('download');
const preview = el<HTMLDivElement>('preview');
const canvas = el<HTMLCanvasElement>('page');

const app = new App({ name: 'dondocs-letter', version: __APP_VERSION__ }, {}, { autoResize: true });

const applyTheme = (theme: string | undefined) => {
  if (theme === 'dark' || theme === 'light') { document.documentElement.dataset.theme = theme; }
  else { delete document.documentElement.dataset.theme; }
};

let subject: string | undefined;
let current: { file: RenderedFile; bytes: Uint8Array } | undefined;

app.ontoolinput = ({ arguments: args }) => {
  const s = (args as { subject?: unknown } | undefined)?.subject;
  subject = typeof s === 'string' && s.trim() ? s.trim() : undefined;
  if (subject) { title.textContent = subject; }
};

app.ontoolresult = (result) => { void show(result); };
// A change notification carries only what changed; a resize says nothing about the theme.
app.onhostcontextchanged = (ctx) => { if (ctx.theme) { applyTheme(ctx.theme); } };

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
    if (file.format === 'pdf') { await drawFirstPage(bytes); }
  } catch (err) {
    status.textContent = `Preview unavailable: ${err instanceof Error ? err.message : String(err)}. The file is at ${file.path}.`;
  }
}

async function drawFirstPage(bytes: Uint8Array): Promise<void> {
  // pdf.js takes ownership of the buffer it is handed; copy so the download keeps its own.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const width = Math.max(320, Math.min(720, document.documentElement.clientWidth - 32));
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${width}px`;
  // The print intent draws the same page but continues by promise, not by
  // requestAnimationFrame, which a browser withholds from a sandboxed frame
  // it has scrolled out of view; the display intent would then draw only
  // once the card was looked at.
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  preview.style.display = 'flex';
  meta.textContent += ` · ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}`;
}

app.connect().then(
  () => applyTheme(app.getHostContext()?.theme),
  (err: unknown) => { status.textContent = `Not connected to the host: ${err instanceof Error ? err.message : String(err)}`; },
);
