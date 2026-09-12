/**
 * The link that opens a rendered letter in the web editor.
 *
 * A letter comes back as a PDF, and a PDF is a poor place to fix a field.
 * The editor is a single page that loads a letter from the URL fragment,
 * so the same fields the render used can be handed straight to it. The
 * fragment is never sent to a server: this is a handoff between two
 * programs on one machine, and it carries no password for that reason.
 *
 * The session is built here rather than in the page so nothing of the
 * letter passes through the model's context, and so the encoding has one
 * home that a test can check against the app's own decoder.
 */
import { deflateSync } from 'node:zlib';
import { toStore, type CompanionDefaults, type LetterInput } from './letterInput';

/** The fragment the app reads a local handoff from, as `#d=`. */
export const HANDOFF_HASH_PREFIX = 'd=';

/**
 * Classifications a letter may carry and still be handed over. A fragment
 * stays on the machine but lands in the browser's history, which is no
 * place for anything above controlled unclassified; a banner of the
 * caller's own says nothing about how high it goes, so it is refused too.
 */
const HANDS_OFF: readonly string[] = ['unclassified', 'cui'];

/** Whether this letter may travel in a URL at all. */
function mayHandOff(input: LetterInput): boolean {
  const { level, custom } = input.classification ?? {};
  if (custom) { return false; }
  return level === undefined || HANDS_OFF.includes(level);
}

/**
 * The app's `SerializedSession`: what `toStore` builds for the renderer,
 * plus the four fields the store keeps and the generator has no use for.
 * `loadSharedSession` fills in anything else it wants.
 */
function sessionFor(input: LetterInput, defaults: CompanionDefaults): Record<string, unknown> {
  return {
    documentMode: 'compliant',
    documentCategory: 'correspondence',
    formType: null,
    ...toStore(input, defaults),
    timestamp: Date.now(),
  };
}

/**
 * The editor's address, or undefined when there is none to use: unset, a
 * host placeholder that was never filled in, or a scheme that is not the
 * web. The value reaches us from a settings field, and the card opens
 * whatever it is given.
 */
export function editorOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /\$\{[^}]*\}/.test(trimmed)) { return undefined; }
  let url: URL;
  try { url = new URL(trimmed); } catch { return undefined; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') { return undefined; }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * The URL that opens this letter in the editor at `origin`, or undefined
 * when there is no usable origin or the letter may not travel.
 */
export function handoffUrl(input: LetterInput, defaults: CompanionDefaults, origin: string | undefined): string | undefined {
  const base = editorOrigin(origin);
  if (!base || !mayHandOff(input)) { return undefined; }
  const json = JSON.stringify(sessionFor(input, defaults));
  const payload = deflateSync(Buffer.from(json, 'utf-8')).toString('base64url');
  return `${base}/#${HANDOFF_HASH_PREFIX}${payload}`;
}
