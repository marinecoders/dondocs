import dictionaryUrl from '@/data/spelling/english-us.txt?url';
import { supportsCorrespondenceProofread } from './correspondenceProofreadChecks';
import { documentOutputConfig } from './documentOutputConfig';
import { plainInlineText } from './inlineText';
import type { ProofreadFinding, ProofreadSource } from './proofread';
import { getPreparedReleaseAsset } from './releaseCache';

const operationalTerms = new Set([
  'afteraction', 'aircrew', 'airfield', 'airframes', 'billeting', 'cybersecurity', 'encl',
  'expeditionary', 'fireteam', 'fireteams', 'helo', 'hmmwv', 'interservice', 'maradmin',
  'naval', 'navmc', 'opcon', 'oporder', 'optempo', 'rearmament', 'servicemember',
  'servicemembers', 'warfighter', 'warfighters', 'warfighting', 'workcenter',
]);
const words = /(?<![\p{L}\p{N}_])\p{L}+(?:['’]\p{L}+)?(?![\p{L}\p{N}_])/gu;
const alphabet = 'abcdefghijklmnopqrstuvwxyz';
type DictionaryState =
  | { status: 'idle' | 'loading' | 'unavailable'; entries?: undefined }
  | { status: 'ready'; entries: ReadonlySet<string> };

let dictionary: DictionaryState = { status: 'idle' };
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function getSpellingDictionary() { return dictionary; }
export function subscribeToSpellingDictionary(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setDictionary(state: DictionaryState) {
  dictionary = state;
  for (const listener of listeners) listener();
}

export function loadSpellingDictionary(): Promise<void> {
  if (dictionary.status === 'ready') return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    // A freshly activated service worker may have precached the word list
    // before it takes control of the tab. The same immutable asset is usable
    // immediately when the connection has already gone offline.
    const installed = typeof caches === 'undefined' ? undefined : await (
      __RELEASE_ID__ ? getPreparedReleaseAsset(__RELEASE_ID__, dictionaryUrl)
        : caches.match(dictionaryUrl, { ignoreSearch: true })
    ).catch(() => undefined);
    const response = installed ?? await fetch(dictionaryUrl);
    if (!response.ok) throw new Error('The spelling dictionary is unavailable.');
    const entries = (await response.text()).trim().split(/\r?\n/);
    if (entries.length < 10_000) throw new Error('The spelling dictionary is incomplete.');
    setDictionary({ status: 'ready', entries: new Set(entries) });
  })().catch(() => setDictionary({ status: 'unavailable' })).finally(() => { pending = undefined; });
  setDictionary({ status: 'loading' });
  return pending;
}

/** Prefer one adjacent transposition, then an unambiguous single edit.
 * Unknown words alone do not make a finding, since they may be names or jargon. */
function correction(word: string, entries: ReadonlySet<string>): string | undefined {
  if (!/^[a-z]{3,20}$/.test(word) || entries.has(word) || operationalTerms.has(word)) return;
  const matches = new Set<string>();
  const check = (candidate: string) => {
    if (entries.has(candidate)) matches.add(candidate);
  };
  for (let i = 0; i < word.length - 1; i++) {
    check(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  if (matches.size || word.length < 6) return matches.size === 1 ? [...matches][0] : undefined;
  for (let i = 0; i <= word.length && matches.size < 2; i++) {
    const before = word.slice(0, i), after = word.slice(i + 1);
    if (i < word.length) check(before + after);
    for (const letter of alphabet) {
      if (i < word.length) check(before + letter + after);
      check(before + letter + word.slice(i));
      if (matches.size > 1) break;
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

export function supportsLocalSpelling(source: ProofreadSource): boolean {
  return supportsCorrespondenceProofread(source) && source.docType !== 'coordination_page';
}

export function spellingFindings(source: ProofreadSource, entries: ReadonlySet<string>): ProofreadFinding[] {
  if (!supportsLocalSpelling(source)) return [];
  const findings: ProofreadFinding[] = [];
  const checked = new Map<string, string | undefined>();
  const scan = (value: string | undefined, label: string, target: ProofreadFinding['target'], key: string) => {
    if (!value || findings.length >= 50 || checked.size >= 1_000) return;
    const text = plainInlineText(value).replace(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+/gi, match => ' '.repeat(match.length));
    const shown = new Set<string>();
    for (const match of text.matchAll(words)) {
      const term = match[0];
      if (!/[a-z]/.test(term) || term.includes("'") || term.includes('’') || entries.has(term)) continue;
      const word = term.toLowerCase();
      if (shown.has(word)) continue;
      if (!checked.has(word)) checked.set(word, correction(word, entries));
      const suggestion = checked.get(word);
      if (suggestion) {
        shown.add(word);
        findings.push({ id: `spelling:${key}:${match.index}`, group: 'spelling', severity: 'info',
          title: `Check spelling: ${term}`, message: `In ${label}, consider “${suggestion}”. Verify the intended spelling in context.`,
          target: { ...target, textSelection: { text: term, offset: match.index } },
          source: { chapter: 2, paragraph: '19', query: 'Proofreading' } });
      }
      if (findings.length >= 50 || checked.size >= 1_000) break;
    }
  };
  const config = documentOutputConfig(source.docType, source.documentMode);
  if (config.uiMode === 'joint') {
    scan(source.formData.jointSubject, 'the subject', { sectionId: 'joint', field: 'jointSubject' }, 'joint-subject');
  } else if (!config.skipSubject && ['business', 'standard', 'memo'].includes(config.uiMode)) {
    scan(source.formData.subject, 'the subject', { sectionId: 'addressing', field: 'subject' }, 'subject');
  }
  source.paragraphs.forEach((paragraph, index) => {
    const paragraphId = paragraph.id;
    const base = { sectionId: 'body', paragraphId };
    const id = paragraphId ?? String(index);
    const label = `paragraph ${index + 1}`;
    scan(paragraph.header, `${label} heading`, { ...base, paragraphPath: ['header'] }, `${id}:heading`);
    scan(paragraph.text, label, { ...base, paragraphPath: ['text'] }, `${id}:body`);
  });
  return findings;
}
