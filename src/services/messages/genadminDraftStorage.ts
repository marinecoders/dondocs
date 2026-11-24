import { EMPTY_GENADMIN_DRAFT, GENADMIN_LIMITS, splitLegacyGenadminContact, type GenadminDraft } from './genadmin';

const STORAGE_KEY = 'dondocs.genadminDraft';
const STORAGE_VERSION = 2;
const fields = Object.keys(EMPTY_GENADMIN_DRAFT) as (keyof GenadminDraft)[];
const listFields: ReadonlySet<keyof GenadminDraft> = new Set(['to', 'info', 'passTo', 'references']);

interface StoredGenadminDraft {
  raw: string | null;
  draft: GenadminDraft;
}

export function genadminDraftFieldLimit(field: keyof GenadminDraft): number {
  if (field === 'remarks') return GENADMIN_LIMITS.remarks;
  return listFields.has(field) ? GENADMIN_LIMITS.list : GENADMIN_LIMITS.line;
}

export function readGenadminDraft(): StoredGenadminDraft {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const record = JSON.parse(raw);
      if ((record?.version === 1 || record?.version === STORAGE_VERSION) && record.draft && typeof record.draft === 'object') {
        const legacy = record.version === 1;
        const draft = { ...EMPTY_GENADMIN_DRAFT };
        for (const field of fields) {
          const value: unknown = record.draft[field];
          if (legacy && (field === 'contactDsn' || field === 'contactEmail') && value === undefined) continue;
          if (typeof value !== 'string' || value.length > genadminDraftFieldLimit(field)) {
            return { raw, draft: EMPTY_GENADMIN_DRAFT };
          }
          draft[field] = value;
        }
        const legacyContact = legacy && !Object.hasOwn(record.draft, 'contactDsn') && !Object.hasOwn(record.draft, 'contactEmail');
        return { raw, draft: legacyContact ? { ...draft, ...splitLegacyGenadminContact(draft.contactDetails) } : draft };
      }
    }
  } catch {
    // An unavailable or malformed saved draft does not prevent composing a new one.
  }
  return { raw, draft: EMPTY_GENADMIN_DRAFT };
}

export async function writeGenadminDraft(previous: StoredGenadminDraft, draft: GenadminDraft | null): Promise<StoredGenadminDraft> {
  const write = (): StoredGenadminDraft => {
    if (localStorage.getItem(STORAGE_KEY) !== previous.raw) {
      throw new Error('The saved draft changed in another tab. Copy any edits you want to keep, then reopen the message.');
    }
    if (!draft) {
      localStorage.removeItem(STORAGE_KEY);
      return { raw: null, draft: EMPTY_GENADMIN_DRAFT };
    }
    if (previous.raw !== null && previous.draft === EMPTY_GENADMIN_DRAFT) {
      throw new Error('The saved draft could not be read. Discard the saved copy before saving your new draft.');
    }
    const raw = JSON.stringify({ version: STORAGE_VERSION, draft });
    localStorage.setItem(STORAGE_KEY, raw);
    return { raw, draft };
  };
  // Serialize the read-check-write across tabs where Web Locks is available.
  return typeof navigator.locks?.request === 'function' ? navigator.locks.request(STORAGE_KEY, write) : write();
}
