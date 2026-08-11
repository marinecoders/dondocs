/**
 * What a caller can ask for, and how it becomes a generator store.
 *
 * `DocumentData` carries ~100 fields, most of them specific to one document
 * type. Exposing all of them would make the contract unreadable for an agent
 * and would break every time the app adds a field. So this names the fields a
 * naval letter actually needs, and keeps `formData` as an escape hatch for
 * anything else rather than blocking a caller on choices made here.
 *
 * Defaults come from a config file so an agent does not restate its own unit on
 * every call — the unit is a property of the machine, not of the request.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ParagraphInput {
  text: string;
  /** 0 = "1.", 1 = "a.", 2 = "(1)" … up to Figure 7-8's eight levels. */
  level?: number;
  /** Bold run-in heading before the text. */
  header?: string;
}

export interface ReferenceInput {
  /** (a), (b) … assigned in order when omitted, which is what a caller expects. */
  letter?: string;
  title: string;
  url?: string;
}

export interface EnclosureInput {
  title: string;
}

export interface UnitInput {
  name?: string;
  line1?: string;
  line2?: string;
  /**
   * The mailing address as one string, e.g.
   * "PSC BOX 20004, CAMP LEJEUNE NC 28542-0004".
   * `splitAddressForLetterhead` breaks it into the two letterhead lines, so it
   * must arrive whole rather than as separate city/state/zip fields — an
   * earlier version invented those and the address silently never rendered.
   */
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** usmc | navy — drives the letterhead wording. */
  department?: string;
  /** dow | dod — which seal is drawn. */
  seal?: string;
  letterheadColor?: string;
}

export interface SignatureInput {
  first?: string;
  middle?: string;
  last?: string;
  rank?: string;
  title?: string;
  byDirection?: boolean;
  byDirectionAuthority?: string;
}

export interface LetterInput {
  docType: string;
  format?: 'pdf' | 'docx';
  out?: string;

  unit?: UnitInput;
  ssic?: string;
  serial?: string;
  date?: string;
  /**
   * Maps to the app's `officeCode`. The app collects and stores it but no
   * template emits it, so it will not appear on the page today; it is accepted
   * so a caller's data survives rather than being silently dropped.
   */
  originatorCode?: string;

  from?: string;
  to?: string;
  /** Each via is its own numbered line; the generator formats them. */
  via?: string[];
  subject?: string;

  paragraphs?: ParagraphInput[];
  references?: ReferenceInput[];
  enclosures?: EnclosureInput[];
  copyTo?: string[];
  distribution?: string[];

  signature?: SignatureInput;
  classification?: { level?: string; pocEmail?: string };
  pocEmail?: string;

  /**
   * Anything this interface does not name. Merged last, so a caller can reach a
   * field the companion has not learned about yet without waiting for a release.
   */
  formData?: Record<string, unknown>;
}

/** Defaults for the machine — unit, signer, department. */
export interface CompanionDefaults {
  unit?: UnitInput;
  signature?: SignatureInput;
  ssic?: string;
  originatorCode?: string;
}

const CONFIG_PATH = process.env.DONDOCS_CONFIG ?? join(homedir(), '.dondocs', 'companion.config.json');

/**
 * Read machine defaults. A missing file is normal, not an error — the built-in
 * fallbacks below keep a fresh install working before anyone configures it.
 */
export async function loadDefaults(): Promise<CompanionDefaults> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) as CompanionDefaults;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return {}; }
    throw new Error(`${CONFIG_PATH} is not readable JSON: ${(err as Error).message}`, { cause: err });
  }
}

/** `a`, `b` … `z`, then `aa`. Matches how the app letters references. */
function referenceLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Today, formatted the way a naval letter dates itself: `8 Aug 26`. */
function today(): string {
  const d = new Date();
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${d.getDate()} ${month} ${String(d.getFullYear()).slice(2)}`;
}

/** The store shape the generators consume. */
export type GeneratorStore = Record<string, unknown>;

/**
 * Fold request over machine defaults over built-in fallbacks.
 *
 * Precedence is request > config > fallback at every field, so a caller can
 * override the machine's unit for one letter without editing anything.
 */
export function toStore(input: LetterInput, defaults: CompanionDefaults = {}): GeneratorStore {
  const unit = { ...defaults.unit, ...input.unit };
  const sig = { ...defaults.signature, ...input.signature };

  return {
    docType: input.docType,
    formData: {
      docType: input.docType,

      unitName: unit.name ?? unit.line1 ?? 'UNITED STATES MARINE CORPS',
      unitLine1: unit.line1 ?? unit.name ?? 'UNITED STATES MARINE CORPS',
      unitLine2: unit.line2 ?? '',
      // Accept either the whole address or the parts, and compose the parts the
      // way a letterhead reads: "CITY ST ZIP".
      unitAddress: unit.address
        ?? [unit.city, unit.state, unit.zip].filter(Boolean).join(' ')
        ?? '',
      department: unit.department ?? 'usmc',
      seal: unit.seal ?? 'dow',
      sealType: unit.seal ?? 'dow',
      letterheadColor: unit.letterheadColor ?? 'blue',

      ssic: input.ssic ?? defaults.ssic ?? '5216',
      serial: input.serial ?? '',
      date: input.date ?? today(),
      originatorCode: input.originatorCode ?? defaults.originatorCode ?? '',
      officeCode: input.originatorCode ?? defaults.originatorCode ?? '',

      from: input.from ?? '',
      to: input.to ?? '',
      via: (input.via ?? []).join('\n'),
      subject: input.subject ?? '',

      sigFirst: sig.first ?? '',
      sigMiddle: sig.middle ?? '',
      sigLast: sig.last ?? '',
      sigRank: sig.rank ?? '',
      sigTitle: sig.title ?? '',
      byDirection: sig.byDirection ?? false,
      byDirectionAuthority: sig.byDirectionAuthority ?? '',

      classLevel: input.classification?.level ?? 'unclassified',
      pocEmail: input.pocEmail ?? input.classification?.pocEmail ?? '',

      fontFamily: 'times',
      fontSize: '12pt',
      includeHyperlinks: false,
      showSubjectOnContinuation: true,

      // Last, deliberately: the escape hatch outranks everything above it.
      ...(input.formData ?? {}),
    },

    paragraphs: (input.paragraphs?.length ? input.paragraphs : [{ text: '', level: 0 }])
      .map((p) => ({ text: p.text, level: p.level ?? 0, ...(p.header ? { header: p.header } : {}) })),

    references: (input.references ?? []).map((r, i) => ({
      letter: r.letter ?? referenceLetter(i),
      title: r.title,
      ...(r.url ? { url: r.url } : {}),
    })),
    enclosures: (input.enclosures ?? []).map((e) => ({ title: e.title })),
    copyTos: (input.copyTo ?? []).map((text) => ({ text })),
    distributions: (input.distribution ?? []).map((text) => ({ text })),
  };
}
