import { REFERENCE_TOKEN } from './publicationReferences';
import { validateSkillEntries } from './publicationSkills';
import { PUBLICATION_SECTIONS, publicationSection, sectionTitle, DISCREPANCY_NOTICE, MI_REPORTING, pointOfContactLead, type PublicationSection } from '@/data/techpub/sections';
import type { Paragraph, PublicationTableRow } from '@/types/document';
import { findUndefinedAcronyms } from '@/lib/acronyms';

/**
 * Rules MIL-DTL-28999D, the specification for I-Type publications, states
 * about the text itself. Each is advisory, and each says which paragraph or
 * row it means.
 */

export interface RuleFinding {
  severity: 'warning';
  message: string;
}

const warn = (message: string): RuleFinding => ({ severity: 'warning', message });

/** 3.1.1.1a: "Acronyms shall not be used in headings." */
export function validateHeadingAcronyms(paragraphs: Paragraph[]): RuleFinding[] {
  const hits = paragraphs
    .map((p) => p.header?.trim() ?? '')
    .filter(Boolean)
    .flatMap((h) => findUndefinedAcronyms(h, { strict: true }).map((a) => `${a.acronym} in "${h}"`));
  return hits.length ? [warn(`Paragraph headings use no acronyms: ${hits.join('; ')}.`)] : [];
}

/** 3.1.4.3: warnings before cautions, cautions before notes, when they run together. */
const RANK = { warning: 0, caution: 1, note: 2 } as const;
export function validateCalloutOrder(paragraphs: Paragraph[]): RuleFinding[] {
  for (let i = 1; i < paragraphs.length; i++) {
    const a = paragraphs[i - 1].callout;
    const b = paragraphs[i].callout;
    if (a && b && RANK[a] > RANK[b]) {
      return [warn(`A ${b.toUpperCase()} follows a ${a.toUpperCase()} it should precede: when callouts run together, warnings come first, then cautions, then notes.`)];
    }
  }
  return [];
}

/** 3.3.2.4: "MIs are the only I-Type that shall be marked as URGENT ... TIs, LIs, and SIs shall not be published as time-restrictive." */
export function validateUrgencyByType(publicationType: string | undefined, urgency: string | undefined): RuleFinding[] {
  const type = publicationType ?? 'MI';
  return type !== 'MI' && urgency === 'urgent'
    ? [warn(`A ${type} is not published as time-restrictive; only a Modification Instruction is marked URGENT.`)]
    : [];
}

/** 3.3.2.14b: in a TI "the use of the word 'modification' shall be avoided." */
export function validateTiWording(publicationType: string | undefined, paragraphs: Paragraph[]): RuleFinding[] {
  if (publicationType !== 'TI') return [];
  const n = paragraphs.filter((p) => /\bmodif/i.test(p.text)).length;
  return n ? [warn(`A Technical Instruction avoids the word "modification"; ${n} paragraph${n === 1 ? '' : 's'} use${n === 1 ? 's' : ''} it.`)] : [];
}

/** 3.3.2.7: nomenclature "all caps up to the first comma then first letter capitalization for each word". */
export function validateNomenclatureCase(rows: PublicationTableRow[], table: string): RuleFinding[] {
  const bad = rows
    .map((r) => (r.values.description ?? '').trim())
    .filter((d) => d && d !== 'Consisting of:')
    .filter((d) => {
      const [head, ...rest] = d.split(',');
      if (head !== head.toUpperCase()) return true;
      return rest.some((part) => part.trim().split(/\s+/).some((w) => /^[a-z]/.test(w)));
    });
  return bad.length
    ? [warn(`${table}: nomenclature is all capitals up to the first comma, then each word capitalized, as TRAILER ASSEMBLY, Generator: ${bad.join('; ')}.`)]
    : [];
}

/** 3.3.2.9.4: "numbers shall be consecutive" — 1, 2, 3, kit items included. */
export function validateItemNumbers(rows: PublicationTableRow[], table: string, required = false): RuleFinding[] {
  const entries = rows.filter((r) => Object.values(r.values).some((v) => v.trim()) && !/^(consisting of|includes):?$/i.test((r.values.description ?? '').trim()));
  const items = entries.map((r) => (r.values.item ?? '').replace(REFERENCE_TOKEN, '').trim());
  if (!required && items.every((item) => !item)) return [];
  if (items.some((item) => !item)) return [warn(`${table}: each item needs a number when the table uses item numbers.`)];
  const expected = items.map((_, i) => String(i + 1));
  return items.join(',') === expected.join(',')
    ? []
    : [warn(`${table}: item numbers run 1, 2, 3 in order, kit items included; they read ${items.join(', ')}.`)];
}

/** 3.1.3: "The reading grade level shall be at the ninth grade level." A
 *  Flesch-Kincaid estimate over the body; nomenclature inflates it, so only a
 *  clear excess is reported, with the estimate. */
export const GRADE_CEILING = 9;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function readingGrade(paragraphs: Paragraph[]): number | null {
  const text = paragraphs.filter((p) => !p.figure).map((p) => p.text).join(' ');
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  if (words.length < 40) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

export function validateReadingGrade(paragraphs: Paragraph[]): RuleFinding[] {
  const grade = readingGrade(paragraphs);
  return grade !== null && grade > GRADE_CEILING
    ? [warn(`The body reads at about grade ${Math.round(grade)}; the specification asks for the ninth grade. Shorter sentences and plainer words bring it down.`)]
    : [];
}

const SECTION_ORDER: PublicationSection[][] = [
  ['purpose'], ['administration'], ['supersedure'], ['timeCompliance'], ['information'],
  ['manuals'], ['majorItems'], ['components'],
  ['materiel', 'materielRequired', 'materielDiscarded', 'materielRetained', 'materielBulk'],
  ['tooling', 'specialTools', 'jigsFixtures'], ['specialInstructions'], ['supply'], ['skill'], ['procedures'],
];

function hasContactDetails(candidates: string[]): boolean {
  return candidates.some((candidate) => {
    // Bound a combined paragraph at the actual notice/reporting lead, rather
    // than office names such as "Operating Forces Support Desk". Keep periods
    // in titles, initials, mailboxes and phone numbers.
    const contact = candidate.split(/\b(?:Discrepancies or suggested changes for this publication may be reported|Operating Forces \(GCSS-MC users\) will not manually add)\b/i)[0];
    const tokens = contact.split(/([\s<>()[\],;:]+)/);
    const mailboxes = tokens.filter((token) => token.includes('@'));
    const mailbox = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
    if (mailboxes.some((value) => {
      const address = value.replace(/^[“"']+|[”"'.!?]+$/g, '');
      return address.length <= 254 && address.split('@')[0].length <= 64 && mailbox.test(address);
    })) return true;
    // Digits inside a malformed mailbox or a URL are not a phone number.
    const phones = tokens.map((token) => token.includes('@') ? '' : token).join('').replace(/https?:\/\/\S+/gi, '')
      .match(/(?<![\w@.+])\+?\d[\d ().-]*\d(?![\w@]|\.\d)/g) ?? [];
    return phones.some((phone) => {
      const digits = phone.replace(/\D/g, '').length;
      return digits >= 7 && digits <= 15;
    });
  });
}

export function validatePublicationStructure(paragraphs: Paragraph[], type = 'MI'): RuleFinding[] {
  const appendix = paragraphs.findIndex((p) => p.appendix);
  const body = appendix < 0 ? paragraphs : paragraphs.slice(0, appendix);
  const primary = body.filter((p) => p.level === 0 && !p.callout && !p.figure && !p.procedure);
  const findings: RuleFinding[] = [];
  let inAppendix = false;
  let inProcedure = false;
  for (const p of paragraphs) {
    if (p.appendix) inAppendix = true;
    if (p.callout || p.figure) continue;
    if (inAppendix && (p.procedure || publicationSection(p) === 'procedures')) {
      findings.push(warn('Place authored procedures in the I-Type body, not an appendix.'));
    } else if (p.procedure && (!inProcedure || p.level === 0)) {
      findings.push(warn('Place each procedural step beneath an action-specific Procedures heading.'));
    }
    if (!p.procedure && p.level === 0) inProcedure = !inAppendix && publicationSection(p) === 'procedures';
  }
  if (publicationSection(primary[0] ?? {}) !== 'purpose') findings.push(warn('The instruction must begin with the Purpose paragraph.'));
  const admin = primary.find((p) => publicationSection(p) === 'administration');
  if (!admin) findings.push(warn('Administrative Instructions is required by MIL-DTL-28999D §3.3.2.2. Add this section after Purpose with the point of contact and NAVMC 10772 notice, plus reporting instructions for an MI.'));
  let previous = -1;
  for (const p of primary) {
    const key = publicationSection(p);
    const index = SECTION_ORDER.findIndex((group) => key && group.includes(key));
    if (index < 0) {
      findings.push(warn(`Identify the publication section for "${p.header || 'Untitled paragraph'}". Select Procedures for an action-specific procedure title.`));
      continue;
    }
    if (index < previous || (index === previous && key !== 'procedures')) findings.push(warn(`"${p.header}" repeats or is out of the prescribed paragraph order.`));
    previous = index;
    if (key !== 'procedures' && sectionTitle(p.header) !== sectionTitle(PUBLICATION_SECTIONS[key!])) findings.push(warn(`Restore the heading "${PUBLICATION_SECTIONS[key!]}".`));
    if (key === 'procedures' && !p.header?.trim()) findings.push(warn('Give the procedure a title describing its action.'));
    if (key === 'timeCompliance' && type !== 'MI') findings.push(warn('Only an MI may contain a Time Compliance Period.'));
  }
  if (body.some((p) => p.procedure || publicationSection(p) === 'procedures') && !primary.some((p) => publicationSection(p) === 'skill')) findings.push(warn('Procedures require Skill and Time Required.'));
  const skill = primary.find((p) => publicationSection(p) === 'skill');
  if (skill) {
    const start = body.indexOf(skill);
    const next = body.findIndex((p, i) => i > start && p.level === 0 && !p.callout && !p.figure);
    const children = body.slice(start + 1, next < 0 ? body.length : next).filter((p) => !p.callout && !p.figure && p.text.trim());
    const entries = children.length ? children.map((p) => `${p.header ?? ''} ${p.text}`) : [skill.text];
    findings.push(...validateSkillEntries(entries).map(warn));
  }
  if (!primary[0]?.text.trim()) findings.push(warn('Enter the purpose of the instruction.'));
  if (admin) {
    const start = body.indexOf(admin);
    const next = body.findIndex((p, i) => i > start && p.level === 0 && !p.callout && !p.figure);
    // Match the visible text of the editor's bold, italic and underline marks.
    // An unpaired marker or a run of blank-line underscores stays literal.
    const normalize = (value: string) => value
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
      .replace(/_{3,}|__([^_]+?)__/g, (run, inner: string | undefined) => inner ?? run)
      .replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
    const texts = body.slice(start, next < 0 ? body.length : next)
      .filter((p) => !p.callout && !p.figure && !p.procedure)
      .map((p) => normalize(p.text));
    const text = texts.join(' ');
    if (!text.includes(normalize(DISCREPANCY_NOTICE))) findings.push(warn('Include the prescribed NAVMC 10772 notice in Administrative Instructions (MIL-DTL-28999D §3.3.2.2.2). The contact paragraph alone does not include this notice.'));
    const hasReporting = text.includes(normalize(MI_REPORTING));
    if (type === 'MI' && !hasReporting) findings.push(warn('Include the prescribed MI reporting instructions in Administrative Instructions.'));
    if (type !== 'MI' && text.toLowerCase().includes(normalize(MI_REPORTING).toLowerCase())) findings.push(warn('Remove the MI reporting instructions from this publication type.'));
    // Figure 1 uses slash wording for the same contact statement in §3.3.2.2.1.
    const lead = new RegExp(`${pointOfContactLead(type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const contacts = texts.flatMap((value) => {
      const wording = value
        .replace(/\bfor concerns\s*\/\s*issues\b/gi, 'For questions or concerns')
        .replace(/\bcontent\s*\/\s*procedures\b/gi, 'content or procedures');
      const match = lead.exec(wording);
      return match ? [wording.slice(match.index + match[0].length)] : [];
    });
    if (!contacts.length) findings.push(warn(`Use the prescribed point-of-contact sentence (MIL-DTL-28999D §3.3.2.2.1): “${pointOfContactLead(type)}” followed by a phone number or section mailbox email.`));
    // Check the contact paragraph itself. Other subparagraphs, figures and
    // notices must not supply a missing phone number or mailbox.
    const candidates = contacts.length ? contacts : texts.flatMap((value) => value.split(/\bcontact\s+/i).slice(1));
    if (!hasContactDetails(candidates)) findings.push(warn('Administrative Instructions needs a contact phone number or section mailbox email.'));
  }
  return findings;
}
