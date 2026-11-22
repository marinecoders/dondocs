import { taggedLetterhead } from './preflight';
import { RUNTIME_BASE } from '@/lib/releasePaths';
import { prepareTaggedCorrespondence, taggedCorrespondenceIssues, type TaggedCorrespondenceSource } from './correspondence';
import { createRasterBindingSession, TAGGED_RASTER_LIMITS, type PdfRasterBinding } from './raster';
import { validateGeneratedTaggedPdf } from './validate';
import { finishTaggedPdf } from './taggedPdf';
import type { LatexCompileProfile } from '@/services/latex/renderDocument';
import type { StoredAttachment } from '@/lib/documentsDb';

export async function loadTaggedSeal(filename: string, signal: AbortSignal): Promise<Uint8Array> {
  if (!/^(?:dow|dod)-seal(?:-bw)?\.png$/.test(filename)) throw new Error('Unsupported decorative seal.');
  const response = await fetch(`${RUNTIME_BASE}attachments/${filename}`, { signal });
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > TAGGED_RASTER_LIMITS.bytes) throw new Error('The exact letterhead seal is unavailable for tagged export.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > TAGGED_RASTER_LIMITS.bytes) throw new Error('The decorative seal exceeds the tagged image limit.');
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* Preserve the read/preflight failure during cleanup. */ }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/** The caller owns the prepared model and attachment lease. No live store,
 * original PDF or signing return can enter this fresh native-rendering path. */
export async function renderTaggedCorrespondence(source: TaggedCorrespondenceSource, options: {
  referenceDate: Date;
  signal: AbortSignal;
  read(id: string): StoredAttachment;
  compile(files: Record<string, string | Uint8Array>, profile?: LatexCompileProfile): Promise<Uint8Array | null>;
  loadSeal?: typeof loadTaggedSeal;
  onCompiling?(): void;
}): Promise<Uint8Array> {
  const check = () => { if (options.signal.aborted) throw new Error('Export cancelled.'); };
  const issues = taggedCorrespondenceIssues(source);
  if (issues.length) throw new Error(issues.join('\n'));
  check();
  const session = createRasterBindingSession();
  const resources = new Map<string, { bytes: Uint8Array; binding: PdfRasterBinding }>();
  const figures: Record<number, PdfRasterBinding> = {};
  for (const [index, paragraph] of source.paragraphs.entries()) {
    const figure = paragraph.figure;
    if (!figure?.fileRef) continue;
    const type = figure.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const key = `${figure.fileRef.id}:${type}`;
    let resource = resources.get(key);
    if (!resource) {
      const data = options.read(figure.fileRef.id).data;
      check();
      if (data.byteLength > TAGGED_RASTER_LIMITS.bytes) throw new Error('Tagged images must be at most 10 MiB.');
      const bytes = new Uint8Array(data.slice(0));
      const binding = await session.prepare(bytes, type);
      check();
      resource = { bytes, binding }; resources.set(key, resource);
    }
    figures[index] = resource.binding;
  }
  let seal: PdfRasterBinding | undefined;
  let sealResource: { filename: string; bytes: Uint8Array } | undefined;
  if (taggedLetterhead(source) === 'full') {
    const filename = `${source.formData.sealType || 'dow'}-seal${source.formData.letterheadColor === 'black' ? '-bw' : ''}.png`;
    const data = await (options.loadSeal ?? loadTaggedSeal)(filename, options.signal);
    check();
    if (data.byteLength > TAGGED_RASTER_LIMITS.bytes) throw new Error('The decorative seal exceeds the tagged image limit.');
    const bytes = new Uint8Array(data);
    seal = await session.prepare(bytes, 'image/png');
    sealResource = { filename, bytes };
    check();
  }
  const prepared = prepareTaggedCorrespondence(source, undefined, options.referenceDate, { figures, seal });
  if (sealResource) prepared.files[`attachments/${sealResource.filename}`] = sealResource.bytes;
  for (const figure of prepared.generated.figures) {
    const type = figure.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const resource = resources.get(`${figure.ref.id}:${type}`);
    if (!resource) throw new Error('A retained tagged figure resource is missing.');
    prepared.files[figure.file] = resource.bytes;
  }
  check(); options.onCompiling?.(); check();
  const input = await options.compile(prepared.files, 'tagged-correspondence');
  // Await a cancelled compilation before its caller releases the resource set.
  check();
  if (!input) throw new Error('The PDF engine produced no tagged source document.');
  const result = await finishTaggedPdf(input, prepared.plan);
  check();
  await validateGeneratedTaggedPdf(result.bytes);
  check();
  return result.bytes;
}
