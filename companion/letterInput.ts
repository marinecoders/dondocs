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
import { format } from 'date-fns';
import { canonicalizeUnitAddress } from '../src/lib/unitAddress';
import { DOC_TYPE_CONFIG } from '../src/types/document';

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

export interface PartyInput {
  name: string;
  from?: string;
  code?: string;
  zip?: string;
  ssic?: string;
  serial?: string;
  date?: string;
  signature?: { name: string; rank?: string; title?: string };
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
  classification?: {
    level?: string; pocEmail?: string; custom?: string;
    classifiedBy?: string; derivedFrom?: string; declassifyOn?: string; reason?: string;
    cui?: { category?: string; controlledBy?: string; dissemination?: string; distStatement?: string };
  };
  pocEmail?: string;

  /** The two sides of a joint letter, joint memorandum, MOA or MOU. */
  parties?: { senior: PartyInput; junior: PartyInput; commonLocation?: string };
  endorsement?: { ordinal: string; basicLetterId: string; includeSubject?: boolean };

  salutation?: string;
  complimentaryClose?: string;
  attnLine?: string;
  throughLine?: string;
  inReplyTo?: boolean;
  coordination?: string;
  preparedBy?: string;
  pageNumbering?: 'none' | 'simple' | 'xofy';

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

/**
 * Today, in the format the doc type's chapter prescribes: `8 Aug 26` for a
 * naval letter, `August 8, 2026` for business and executive correspondence
 * (Ch 11, Ch 12). The two patterns mirror `src/components/ui/date-picker.tsx`,
 * which the companion cannot import without dragging in React.
 */
function today(docType: string): string {
  const spelled = DOC_TYPE_CONFIG[docType]?.compliance?.dateFormat === 'spelled';
  return format(new Date(), spelled ? 'MMMM d, yyyy' : 'd MMM yy');
}

/** The store shape the generators consume. */
export type GeneratorStore = Record<string, unknown>;

/**
 * The published docType where it differs from the template the generator loads.
 *
 * `main.tex` resolves the type through `\input{\DocumentType}`, so the value has
 * to name a file in `tex/templates/`. There is no `memorandum.tex`; the app's
 * registry calls it `standard_memorandum`. The published name is unchanged, only
 * the lookup.
 */
export const TEMPLATE_FOR: Record<string, string> = {
  memorandum: 'standard_memorandum',
};

/** The template a published docType loads. Exported so a test can check the
 *  advertised list against the app's registry without restating the mapping. */
export function templateFor(docType: string): string {
  return TEMPLATE_FOR[docType] ?? docType;
}

/** Both flat families for the two parties, from the one published shape. */
function partyFields(input: LetterInput): Record<string, unknown> {
  const p = input.parties;
  if (!p) { return {}; }
  const s = p.senior, j = p.junior;
  return {
    // joint_letter / joint_memorandum
    jointSeniorName: s.name, jointSeniorFrom: s.from ?? input.from ?? '',
    jointSeniorCode: s.code ?? '', jointSeniorZip: s.zip ?? '',
    jointSeniorSigName: s.signature?.name ?? '', jointSeniorSigTitle: s.signature?.title ?? '',
    jointJuniorName: j.name, jointJuniorFrom: j.from ?? '',
    jointJuniorCode: j.code ?? '', jointJuniorZip: j.zip ?? '',
    jointJuniorSSIC: j.ssic ?? '', jointJuniorSerial: j.serial ?? '', jointJuniorDate: j.date ?? '',
    jointJuniorSigName: j.signature?.name ?? '', jointJuniorSigTitle: j.signature?.title ?? '',
    jointCommonLocation: p.commonLocation ?? '',
    // moa / mou
    seniorCommandName: s.name, juniorCommandName: j.name,
    seniorSSIC: s.ssic ?? '', seniorSerial: s.serial ?? '',
    juniorSSIC: j.ssic ?? '', juniorSerial: j.serial ?? '', juniorDate: j.date ?? '',
    seniorSigName: s.signature?.name ?? '', seniorSigRank: s.signature?.rank ?? '', seniorSigTitle: s.signature?.title ?? '',
    juniorSigName: j.signature?.name ?? '', juniorSigRank: j.signature?.rank ?? '', juniorSigTitle: j.signature?.title ?? '',
    // seniorDate is routed from the document date above; a party date overrides it.
    ...(s.date ? { seniorDate: s.date } : {}),
  };
}

/**
 * Fold request over machine defaults over built-in fallbacks.
 *
 * Precedence is request > config > fallback at every field, so a caller can
 * override the machine's unit for one letter without editing anything.
 */
export function toStore(input: LetterInput, defaults: CompanionDefaults = {}): GeneratorStore {
  const unit = { ...defaults.unit, ...input.unit };
  const sig = { ...defaults.signature, ...input.signature };
  const docType = templateFor(input.docType);
  const date = input.date ?? today(docType);

  return {
    docType,
    formData: {
      docType,

      unitName: unit.name ?? unit.line1 ?? 'UNITED STATES MARINE CORPS',
      unitLine1: unit.line1 ?? unit.name ?? 'UNITED STATES MARINE CORPS',
      unitLine2: unit.line2 ?? '',
      // Normalize tool/config addresses to the comma layout the letterhead
      // splitter expects, just as the web app does when loading an address.
      unitAddress: canonicalizeUnitAddress(unit.address
        ?? [unit.city, unit.state, unit.zip].filter(Boolean).join(' ')),
      department: unit.department ?? 'usmc',
      seal: unit.seal ?? 'dow',
      sealType: unit.seal ?? 'dow',
      letterheadColor: unit.letterheadColor ?? 'blue',

      ssic: input.ssic ?? defaults.ssic ?? '5216',
      serial: input.serial ?? '',
      date,
      originatorCode: input.originatorCode ?? defaults.originatorCode ?? '',
      officeCode: input.originatorCode ?? defaults.originatorCode ?? '',

      from: input.from ?? '',
      to: input.to ?? '',
      via: (input.via ?? []).join('\n'),
      subject: input.subject ?? '',
      // Several uiModes read the basics under their own names: executive
      // memoranda take the addressee from `memorandumFor`, joint documents take
      // from/to/subject from `joint*`, and agreements take the subject from
      // `moaSubject` and the date from `seniorDate` (generator.ts, lines
      // 112-126 and 208). Feeding every alias keeps one set of request fields
      // right for every type; a type ignores the aliases it does not read.
      memorandumFor: input.to ?? '',
      jointSeniorFrom: input.from ?? '',
      jointTo: input.to ?? '',
      jointSubject: input.subject ?? '',
      moaSubject: input.subject ?? '',
      seniorDate: date,

      sigFirst: sig.first ?? '',
      sigMiddle: sig.middle ?? '',
      sigLast: sig.last ?? '',
      sigRank: sig.rank ?? '',
      sigTitle: sig.title ?? '',
      byDirection: sig.byDirection ?? false,
      byDirectionAuthority: sig.byDirectionAuthority ?? '',

      classLevel: input.classification?.level ?? 'unclassified',
      pocEmail: input.pocEmail ?? input.classification?.pocEmail ?? '',
      customClassification: input.classification?.custom ?? '',
      classifiedBy: input.classification?.classifiedBy ?? '',
      derivedFrom: input.classification?.derivedFrom ?? '',
      declassifyOn: input.classification?.declassifyOn ?? '',
      classReason: input.classification?.reason ?? '',
      classifiedPocEmail: input.classification?.pocEmail ?? '',
      cuiCategory: input.classification?.cui?.category ?? '',
      cuiControlledBy: input.classification?.cui?.controlledBy ?? '',
      cuiDissemination: input.classification?.cui?.dissemination ?? '',
      cuiDistStatement: input.classification?.cui?.distStatement ?? '',

      salutation: input.salutation ?? 'Dear Sir or Madam:',
      complimentaryClose: input.complimentaryClose ?? 'Sincerely,',
      attnLine: input.attnLine ?? '',
      throughLine: input.throughLine ?? '',
      inReplyTo: input.inReplyTo ?? false,
      coordination: input.coordination ?? '',
      preparedBy: input.preparedBy ?? '',
      pageNumbering: input.pageNumbering ?? 'none',

      // Endorsements: the generator can also parse these out of a subject like
      // "FIRST ENDORSEMENT on ...", so these are the explicit form.
      endorsementOrdinal: input.endorsement?.ordinal ?? '',
      basicLetterId: input.endorsement?.basicLetterId ?? '',
      includeEndorsementSubject: input.endorsement?.includeSubject ?? false,

      // The two parties, fed to BOTH flat families the app keeps. Joint
      // documents read joint*; agreements read senior*/junior*. Each type
      // ignores the family it does not use, so populating both from one shape
      // costs nothing and needs no branching on uiMode. Where a party carries a
      // from line it overrides the plain one routed above.
      ...partyFields(input),

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
